// ═══════════════════════════════════════════════════════════════════════
// LeetSync — Popup Script
// Dashboard (heatmap, charts, streak) + Settings management
// ═══════════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {
  // ── Tab Navigation ──────────────────────────────────────────────────
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".tab-content");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add("active");
    });
  });

  // ── Init ────────────────────────────────────────────────────────────
  loadSettings();
  loadDashboard();
  checkConnection();

  // ═══════════════════════════════════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════════════════════════════════

  async function loadSettings() {
    const data = await chromeStorageGet([
      "github-token",
      "github-repo",
      "gemini-key",
      "notificationsEnabled",
      "reminderTime",
      "hide-premium-icons",
    ]);

    if (data["github-token"]) document.getElementById("s-token").value = data["github-token"];
    if (data["github-repo"]) document.getElementById("s-repo").value = data["github-repo"];
    if (data["gemini-key"]) document.getElementById("s-gemini").value = data["gemini-key"];

    document.getElementById("notifications-toggle").checked = !!data.notificationsEnabled;
    document.getElementById("hide-premium-toggle").checked = !!data["hide-premium-icons"];

    if (data.reminderTime) {
      document.getElementById("reminder-time").value = data.reminderTime;
    }

    updateReminderVisibility(!!data.notificationsEnabled);
  }

  // Save settings
  document.getElementById("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("save-btn");

    const token = document.getElementById("s-token").value.trim();
    const repo = document.getElementById("s-repo").value.trim();
    const gemini = document.getElementById("s-gemini").value.trim();

    await chromeStorageSet({
      "github-token": token,
      "github-repo": repo,
      "gemini-key": gemini,
    });

    btn.classList.add("saved");
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Saved!`;

    setTimeout(() => {
      btn.classList.remove("saved");
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Save Configuration`;
    }, 2000);

    checkConnection();
  });

  // Toggle password visibility
  document.getElementById("toggle-token").addEventListener("click", () => {
    const input = document.getElementById("s-token");
    input.type = input.type === "password" ? "text" : "password";
  });

  // Notification toggle
  document.getElementById("notifications-toggle").addEventListener("change", async (e) => {
    const enabled = e.target.checked;
    await chromeStorageSet({ notificationsEnabled: enabled });
    updateReminderVisibility(enabled);
  });

  // Reminder time
  document.getElementById("reminder-time").addEventListener("change", async (e) => {
    await chromeStorageSet({ reminderTime: e.target.value });
  });

  // Hide premium toggle
  document.getElementById("hide-premium-toggle").addEventListener("change", async (e) => {
    await chromeStorageSet({ "hide-premium-icons": e.target.checked });
  });

  function updateReminderVisibility(show) {
    document.getElementById("reminder-time-wrap").style.display = show ? "flex" : "none";
  }

  // Export history
  document.getElementById("export-btn").addEventListener("click", async () => {
    const data = await chromeStorageGet(["submissionHistory"]);
    const history = data.submissionHistory || [];
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leetsync-pro-history-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Clear history
  document.getElementById("clear-btn").addEventListener("click", async () => {
    if (confirm("Clear all submission history? This cannot be undone.")) {
      await chromeStorageSet({ submissionHistory: [] });
      loadDashboard();
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // CONNECTION CHECK
  // ═══════════════════════════════════════════════════════════════════

  async function checkConnection() {
    const dot = document.querySelector(".status-dot");
    const text = document.querySelector(".status-text");

    const data = await chromeStorageGet(["github-token", "github-repo"]);
    if (!data["github-token"] || !data["github-repo"]) {
      dot.className = "status-dot error";
      text.textContent = "Not configured";
      return;
    }

    try {
      const response = await fetch(`https://api.github.com/repos/${data["github-repo"]}`, {
        headers: {
          Authorization: `token ${data["github-token"]}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (response.ok) {
        dot.className = "status-dot connected";
        text.textContent = "Connected";
      } else {
        dot.className = "status-dot error";
        text.textContent = response.status === 401 ? "Bad token" : "Repo not found";
      }
    } catch {
      dot.className = "status-dot error";
      text.textContent = "Offline";
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════════════════

  async function loadDashboard() {
    const data = await chromeStorageGet(["submissionHistory"]);
    const history = data.submissionHistory || [];

    renderStreak(history);
    renderHeatmap(history);
    renderDifficulty(history);
    renderLanguages(history);
    renderRecent(history);
  }

  // ── Streak Calculation ──────────────────────────────────────────────
  function renderStreak(history) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get unique dates
    const dates = [...new Set(history.map((h) => h.date))].sort().reverse();

    let streak = 0;
    const checkDate = new Date(today);

    for (let i = 0; i < 365; i++) {
      const dateStr = checkDate.toISOString().split("T")[0];
      if (dates.includes(dateStr)) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else if (i === 0) {
        // Today not solved yet, check if yesterday started the streak
        checkDate.setDate(checkDate.getDate() - 1);
        continue;
      } else {
        break;
      }
    }

    document.getElementById("streak-count").textContent = streak;

    // Flames based on streak
    const flames = document.getElementById("streak-flames");
    if (streak >= 30) flames.textContent = "🔥🔥🔥";
    else if (streak >= 7) flames.textContent = "🔥🔥";
    else if (streak >= 1) flames.textContent = "🔥";
    else flames.textContent = "❄️";

    // Stats
    document.getElementById("total-solved").textContent = history.length;

    const todayStr = today.toISOString().split("T")[0];
    const todayCount = history.filter((h) => h.date === todayStr).length;
    document.getElementById("today-count").textContent = todayCount;

    // This week
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekStr = weekAgo.toISOString().split("T")[0];
    const weekCount = history.filter((h) => h.date >= weekStr).length;
    document.getElementById("this-week").textContent = weekCount;
  }

  // ── Heatmap (Canvas) ───────────────────────────────────────────────
  function renderHeatmap(history) {
    const canvas = document.getElementById("heatmap-canvas");
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    // Size
    const displayW = canvas.parentElement.offsetWidth;
    const displayH = 76;
    canvas.style.width = displayW + "px";
    canvas.style.height = displayH + "px";
    canvas.width = displayW * dpr;
    canvas.height = displayH * dpr;
    ctx.scale(dpr, dpr);

    // Calculate grid dimensions
    const cellSize = 9;
    const gap = 2;
    const weeks = 20; // Show last 20 weeks
    const rows = 7; // Sun-Sat

    // Count submissions per day
    const countByDate = {};
    history.forEach((h) => {
      countByDate[h.date] = (countByDate[h.date] || 0) + 1;
    });

    // Find max for color scale
    const maxCount = Math.max(1, ...Object.values(countByDate));

    // Start from today, go backwards
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Date range label
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - weeks * 7);
    document.getElementById("heatmap-range").textContent =
      `${formatMonth(startDate)} – ${formatMonth(today)}`;

    // Offset to align to grid
    const startX = (displayW - weeks * (cellSize + gap)) / 2;
    const startY = 4;

    for (let week = 0; week < weeks; week++) {
      for (let day = 0; day < rows; day++) {
        const idx = week * 7 + day;
        const date = new Date(today);
        date.setDate(date.getDate() - (weeks * 7 - 1 - idx));
        const dateStr = date.toISOString().split("T")[0];

        if (date > today) continue;

        const count = countByDate[dateStr] || 0;
        const intensity = count === 0 ? 0 : Math.min(1, count / maxCount);

        const x = startX + week * (cellSize + gap);
        const y = startY + day * (cellSize + gap);

        // Color
        if (count === 0) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
        } else {
          const alpha = 0.15 + intensity * 0.85;
          ctx.fillStyle = `rgba(255, 161, 22, ${alpha})`;
        }

        roundRect(ctx, x, y, cellSize, cellSize, 2);
      }
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.fill();
  }

  function formatMonth(d) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // ── Difficulty Breakdown ────────────────────────────────────────────
  function renderDifficulty(history) {
    const counts = { Easy: 0, Medium: 0, Hard: 0 };
    history.forEach((h) => {
      if (counts[h.difficulty] !== undefined) counts[h.difficulty]++;
    });

    const total = Math.max(1, counts.Easy + counts.Medium + counts.Hard);

    document.getElementById("count-easy").textContent = counts.Easy;
    document.getElementById("count-medium").textContent = counts.Medium;
    document.getElementById("count-hard").textContent = counts.Hard;

    // Animate bars
    requestAnimationFrame(() => {
      document.getElementById("bar-easy").style.width = `${(counts.Easy / total) * 100}%`;
      document.getElementById("bar-medium").style.width = `${(counts.Medium / total) * 100}%`;
      document.getElementById("bar-hard").style.width = `${(counts.Hard / total) * 100}%`;
    });
  }

  // ── Language Stats ──────────────────────────────────────────────────
  function renderLanguages(history) {
    const langCounts = {};
    history.forEach((h) => {
      langCounts[h.language] = (langCounts[h.language] || 0) + 1;
    });

    const container = document.getElementById("language-list");

    if (Object.keys(langCounts).length === 0) {
      container.innerHTML = `<div class="empty-state">No submissions yet. Push a solution to get started!</div>`;
      return;
    }

    const sorted = Object.entries(langCounts).sort((a, b) => b[1] - a[1]);
    container.innerHTML = sorted
      .map(
        ([lang, count]) => `
      <div class="lang-tag">
        ${lang}
        <span class="lang-count">×${count}</span>
      </div>
    `
      )
      .join("");
  }

  // ── Recent Submissions ──────────────────────────────────────────────
  function renderRecent(history) {
    const container = document.getElementById("recent-list");

    if (history.length === 0) {
      container.innerHTML = `<div class="empty-state">Your recent pushes will appear here.</div>`;
      return;
    }

    const recent = history.slice(-8).reverse();
    container.innerHTML = recent
      .map((h) => {
        const date = new Date(h.timestamp);
        const timeStr = formatRelativeTime(date);
        return `
        <div class="recent-item">
          <span class="recent-num">#${h.problemNum}</span>
          <span class="recent-name">${h.problemName}</span>
          <span class="recent-diff ${h.difficulty}">${h.difficulty}</span>
          <span class="recent-time">${timeStr}</span>
        </div>
      `;
      })
      .join("");
  }

  function formatRelativeTime(date) {
    const now = Date.now();
    const diff = now - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHROME STORAGE HELPERS
  // ═══════════════════════════════════════════════════════════════════

  function chromeStorageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function chromeStorageSet(items) {
    return new Promise((resolve) => chrome.storage.local.set(items, resolve));
  }
});
