// ═══════════════════════════════════════════════════════════════════════
// LeetSync — Background Service Worker
// Handles: fetch proxy, daily challenge alarms, badge updates, notifications
// ═══════════════════════════════════════════════════════════════════════

// ── Fetch Proxy ─────────────────────────────────────────────────────────
// Content scripts can't fetch cross-origin due to CSP. Proxy via background.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchProxy") {
    (async () => {
      try {
        // Reconstruct fetch options explicitly to avoid serialization issues
        const opts = {};
        const src = request.options || {};
        if (src.method) opts.method = src.method;
        if (src.headers) opts.headers = src.headers;
        if (src.body) opts.body = typeof src.body === "string" ? src.body : JSON.stringify(src.body);
        if (request.url.includes("leetcode.com")) {
          opts.credentials = "include";
        }

        const response = await fetch(request.url, opts);
        const headers = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });

        let body;
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          body = await response.json();
        } else {
          body = await response.text();
        }

        sendResponse({
          ok: response.ok,
          status: response.status,
          headers,
          body,
        });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true; // Keep message channel open for async response
  }

  // ── Submission History ────────────────────────────────────────────────
  if (request.action === "recordSubmission") {
    recordSubmission(request.data).then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.action === "getSubmissionHistory") {
    getSubmissionHistory().then((history) => sendResponse({ history }));
    return true;
  }
});

// ── Submission History Storage ──────────────────────────────────────────
async function recordSubmission(data) {
  const result = await chrome.storage.local.get(["submissionHistory"]);
  const history = result.submissionHistory || [];

  history.push({
    problemNum: data.problemNum,
    problemName: data.problemName,
    difficulty: data.difficulty || "Unknown",
    language: data.language,
    timestamp: Date.now(),
    date: new Date().toISOString().split("T")[0], // YYYY-MM-DD
    runtime: data.runtime || "",
    memory: data.memory || "",
  });

  // Keep last 500 submissions
  if (history.length > 500) {
    history.splice(0, history.length - 500);
  }

  await chrome.storage.local.set({ submissionHistory: history });
}

async function getSubmissionHistory() {
  const result = await chrome.storage.local.get(["submissionHistory"]);
  return result.submissionHistory || [];
}

// ── Daily Challenge Alarm ───────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "dailyChallengeReminder") {
    await checkDailyChallenge();
  }
});

// Set up alarm on install/startup
chrome.runtime.onInstalled.addListener(() => {
  setupDailyAlarm();
  chrome.action.setBadgeBackgroundColor({ color: "#ffa116" });
});

chrome.runtime.onStartup.addListener(() => {
  setupDailyAlarm();
});

async function setupDailyAlarm() {
  const { notificationsEnabled, reminderTime } = await chrome.storage.local.get([
    "notificationsEnabled",
    "reminderTime",
  ]);

  // Clear any existing alarm
  await chrome.alarms.clear("dailyChallengeReminder");

  if (notificationsEnabled) {
    const hour = parseInt(reminderTime || "9", 10);

    // Calculate next alarm time
    const now = new Date();
    let alarmTime = new Date();
    alarmTime.setHours(hour, 0, 0, 0);

    // If the time has already passed today, schedule for tomorrow
    if (alarmTime <= now) {
      alarmTime.setDate(alarmTime.getDate() + 1);
    }

    chrome.alarms.create("dailyChallengeReminder", {
      when: alarmTime.getTime(),
      periodInMinutes: 24 * 60, // Every 24 hours
    });
  }
}

// Also check periodically (every 4 hours) for badge update
chrome.alarms.create("badgeUpdate", { periodInMinutes: 240 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "badgeUpdate") {
    await updateBadge();
  }
});

async function checkDailyChallenge() {
  try {
    const response = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query questionOfToday { activeDailyCodingChallengeQuestion { date link question { title difficulty frontendQuestionId: questionFrontendId } } }`,
      }),
    });

    if (!response.ok) return;

    const data = await response.json();
    const daily = data?.data?.activeDailyCodingChallengeQuestion;

    if (daily) {
      const { notificationsEnabled } = await chrome.storage.local.get(["notificationsEnabled"]);
      if (notificationsEnabled) {
        chrome.notifications.create("dailyChallenge", {
          type: "basic",
          iconUrl: "images/icon-128.png",
          title: "🔥 LeetCode Daily Challenge",
          message: `${daily.question.frontendQuestionId}. ${daily.question.title} (${daily.question.difficulty})`,
          priority: 2,
        });
      }

      // Update badge
      await updateBadge();
    }
  } catch (e) {
    // Silently fail — network may be unavailable
  }
}

async function updateBadge() {
  try {
    // Check if today's daily has been solved by looking at submission history
    const today = new Date().toISOString().split("T")[0];
    const result = await chrome.storage.local.get(["submissionHistory"]);
    const history = result.submissionHistory || [];

    const solvedToday = history.some((s) => s.date === today);

    if (solvedToday) {
      chrome.action.setBadgeText({ text: "✓" });
      chrome.action.setBadgeBackgroundColor({ color: "#2cbb5d" });
    } else {
      chrome.action.setBadgeText({ text: "1" });
      chrome.action.setBadgeBackgroundColor({ color: "#ffa116" });
    }
  } catch (e) {
    // Silently fail
  }
}

// Handle notification clicks — open LeetCode daily problem
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === "dailyChallenge") {
    chrome.tabs.create({ url: "https://leetcode.com/problemset/" });
  }
});

// Listen for settings changes to reconfigure alarms
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local") {
    if (changes.notificationsEnabled || changes.reminderTime) {
      setupDailyAlarm();
    }
  }
});
