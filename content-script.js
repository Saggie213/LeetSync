;(() => {
  // ═══════════════════════════════════════════════════════════════════════
  // LeetSync — Content Script
  // Runs on leetcode.com/problems/* pages
  // Detects accepted submissions, extracts code, pushes to GitHub
  // ═══════════════════════════════════════════════════════════════════════

  // ── Constants ──────────────────────────────────────────────────────────
  const GITHUB_API = "https://api.github.com/repos";

  const FILE_EXTENSIONS = {
    C: ".c", "C++": ".cpp", "C#": ".cs", Dart: ".dart", Elixir: ".ex",
    Erlang: ".erl", Go: ".go", Java: ".java", JavaScript: ".js",
    Kotlin: ".kt", PHP: ".php", Python: ".py", Python3: ".py",
    Racket: ".rkt", Ruby: ".rb", Rust: ".rs", Scala: ".scala",
    Swift: ".swift", TypeScript: ".ts", MySQL: ".sql",
    PostgreSQL: ".sql", Oracle: ".sql", "MS SQL Server": ".tsql", Pandas: ".py",
  };

  const LANG_KEYS = {
    C: "c", "C++": "cpp", "C#": "csharp", Dart: "dart", Elixir: "elixir",
    Erlang: "erlang", Go: "golang", Java: "java", JavaScript: "javascript",
    Kotlin: "kotlin", PHP: "php", Python: "python", Python3: "python3",
    Racket: "racket", Ruby: "ruby", Rust: "rust", Scala: "scala",
    Swift: "swift", TypeScript: "typescript", MySQL: "mysql",
    Oracle: "oraclesql", PostgreSQL: "postgresql", "MS SQL Server": "mssql",
    Pandas: "pythondata",
  };

  // DSA topic → folder mapping (ordered for neat categorization)
  const TOPIC_FOLDERS = {
    "Array": "01-Arrays-and-Hashing", "Hash Table": "01-Arrays-and-Hashing",
    "Two Pointers": "02-Two-Pointers", "Sliding Window": "03-Sliding-Window",
    "Stack": "04-Stack", "Monotonic Stack": "04-Stack",
    "Binary Search": "05-Binary-Search",
    "Linked List": "06-Linked-List",
    "Tree": "07-Trees", "Binary Tree": "07-Trees",
    "Binary Search Tree": "07-Trees",
    "Heap (Priority Queue)": "08-Heap-Priority-Queue",
    "Backtracking": "09-Backtracking", "Recursion": "09-Backtracking",
    "Graph": "10-Graphs", "Breadth-First Search": "10-Graphs",
    "Depth-First Search": "10-Graphs", "Topological Sort": "10-Graphs",
    "Union Find": "10-Graphs",
    "Dynamic Programming": "11-Dynamic-Programming",
    "Greedy": "12-Greedy",
    "Bit Manipulation": "13-Bit-Manipulation",
    "Math": "14-Math",
    "String": "15-Strings",
    "Trie": "16-Trie",
    "Sorting": "17-Sorting",
    "Design": "18-Design",
    "Simulation": "19-Simulation",
    "Database": "20-Database",
  };

  const DB_LANGS = ["MySQL", "Oracle", "PostgreSQL", "MS SQL Server", "Pandas"];
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  // ── State ──────────────────────────────────────────────────────────────
  let currentProblem = null;
  let KEYBOARD_SHORTCUT = isMac
    ? { key: "p", modifier: "meta" }
    : { key: "p", modifier: "ctrl" };
  let SHORTCUT_DISPLAY = getShortcutText(KEYBOARD_SHORTCUT);

  // ── Storage Helpers ────────────────────────────────────────────────────
  const storageGet = (keys) =>
    new Promise((r) => chrome.storage.local.get(keys, r));
  const storageSet = (items) =>
    new Promise((r) => chrome.storage.local.set(items, r));
  const storageRemove = (keys) =>
    new Promise((r) => chrome.storage.local.remove(keys, r));

  // ── Fetch Proxy (bypass CSP via background) ────────────────────────────
  function fetchProxy(url, options = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "fetchProxy", url, options },
        (response) => {
          if (chrome.runtime.lastError)
            return reject(new Error(chrome.runtime.lastError.message));
          if (response?.error) return reject(new Error(response.error));
          resolve({
            ok: response.ok,
            status: response.status,
            headers: {
              get: (n) =>
                response.headers[n] || response.headers[n.toLowerCase()],
            },
            json: async () => {
              if (typeof response.body === "string") {
                try { return JSON.parse(response.body); } catch { return response.body; }
              }
              return response.body;
            },
            text: async () =>
              typeof response.body === "string"
                ? response.body
                : JSON.stringify(response.body),
          });
        }
      );
    });
  }

  // ── Shortcut Helpers ───────────────────────────────────────────────────
  function getShortcutText(s) {
    const mod =
      s.modifier === "meta" ? "⌘" :
      s.modifier === "alt" ? "⌥" :
      s.modifier === "shift" ? "⇧" :
      s.modifier === "ctrl" ? "Ctrl+" : "";
    return `${mod}${s.key.toUpperCase()}`;
  }

  // Load saved shortcut
  chrome.storage.local.get(["keyboard-shortcut"], (res) => {
    if (res["keyboard-shortcut"]) {
      try {
        KEYBOARD_SHORTCUT = JSON.parse(res["keyboard-shortcut"]);
        SHORTCUT_DISPLAY = getShortcutText(KEYBOARD_SHORTCUT);
      } catch {}
    }
  });

  // ── Init ───────────────────────────────────────────────────────────────
  function runInit() {
    initLeetSyncPro();
    initPreferences();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runInit);
  } else {
    runInit();
  }

  // Watch for SPA navigation (LeetCode is a Next.js SPA)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(runInit, 1500);
    }
  }).observe(document, { subtree: true, childList: true });

  // ── Preferences (hide premium icons) ──────────────────────────────────
  async function initPreferences() {
    const { "hide-premium-icons": hide } = await storageGet(["hide-premium-icons"]);
    applyPreferences(!!hide);
  }

  function applyPreferences(hideIcons) {
    const id = "leetsync-preferences-style";
    let el = document.getElementById(id);
    if (hideIcons) {
      if (!el) {
        el = document.createElement("style");
        el.id = id;
        el.textContent = `
          a[href*="/subscribe"], div:has(> a[href*="/subscribe"]),
          .lc-lg\\:inline-block:has(a[href*="/subscribe"]),
          div:has(> a > span > span.text-brand-orange) {
            display: none !important; width: 0 !important; height: 0 !important;
          }
          svg.text-brand-orange, .text-brand-orange { display: none !important; }
          div.cursor-pointer:has(svg.text-brand-orange),
          button[aria-label*="debugger" i],
          div:has(> button[aria-label*="debugger" i]) {
            display: none !important; width: 0 !important; height: 0 !important;
          }
        `;
        document.head.appendChild(el);
      }
    } else if (el) {
      el.remove();
    }
  }

  chrome.storage.onChanged.addListener((changes, ns) => {
    if (ns === "local" && changes["hide-premium-icons"] !== undefined) {
      applyPreferences(changes["hide-premium-icons"].newValue);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // MAIN INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════
  async function initLeetSyncPro() {
    if (!isSubmissionPage() || !hasAcceptedSolution()) return;

    const config = await getGithubConfig();
    const configured = isConfigComplete(config);
    injectButtons(configured);
    currentProblem = await extractProblemInfo();
    registerKeyboardShortcut();
  }

  function isSubmissionPage() {
    return window.location.href.includes("submissions");
  }

  function hasAcceptedSolution() {
    const el = document.querySelector("[data-e2e-locator='submission-result']");
    if (el?.textContent?.includes("Accepted")) return true;

    for (const node of document.querySelectorAll("span, div")) {
      if (
        node.textContent === "Accepted" &&
        (node.className.includes("text-green") ||
          node.className.includes("success"))
      ) return true;
    }
    return false;
  }

  // ── Config ─────────────────────────────────────────────────────────────
  async function getGithubConfig() {
    return storageGet(["github-token", "github-repo", "gemini-key"]);
  }

  function isConfigComplete(cfg) {
    return !!(cfg["github-token"] && cfg["github-repo"]);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PROBLEM INFO EXTRACTION (3-Tier: GraphQL -> Monaco -> DOM)
  // ═══════════════════════════════════════════════════════════════════════
  async function extractProblemInfo() {
    // 1. Try page title: "1. Two Sum - LeetCode"
    let name = "";
    const titleMatch = document.title.match(/^(\d+)\.\s*(.+?)\s*-/);
    if (titleMatch) name = `${titleMatch[1]}. ${titleMatch[2]}`;

    // 2. Fuzzy text node search
    if (!name) {
      for (const el of document.querySelectorAll("a, div, span, h1, h2, h3")) {
        const t = el.textContent?.trim() || "";
        if (
          t.length > 3 && t.length < 100 &&
          t.match(/^\d+\.\s+[A-Za-z0-9]/) &&
          (el.children.length === 0 || el.tagName === "A")
        ) { name = t; break; }
      }
    }

    // 3. __NEXT_DATA__
    if (!name) {
      const nd = document.getElementById("__NEXT_DATA__");
      if (nd) {
        const src = nd.textContent;
        const idM = src.match(/"questionFrontendId":"(\d+)"/);
        const ttM = src.match(/"title":"([^"]+)"/);
        if (idM && ttM) name = `${idM[1]}. ${ttM[1]}`;
      }
    }

    // 4. URL slug fallback
    if (!name) {
      const slug = window.location.pathname.split("/")[2];
      if (slug) {
        const formatted = slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        name = `0000. ${formatted}`;
      }
    }

    if (!name) return null;

    const probNum = name.split(".")[0]?.trim() || "";
    const rawName = name.replace(/^\d+\./, "").trim();
    const probName = rawName.replaceAll(" ", "-");
    const titleSlug = window.location.pathname.split("/")[2] || probName.toLowerCase();

    // --- Tier 1: Try LeetCode GraphQL API ---
    const gqlData = await getSubmissionFromGraphQL(titleSlug);

    // --- Tier 2: Try Monaco Editor in Main World ---
    let code = gqlData?.code || "";
    if (!code || !code.trim()) {
      code = await getCodeFromMainWorld();
    }

    // --- Tier 3: Try DOM Fallback ---
    if (!code || !code.trim()) {
      code = getCodeFromDOM();
    }

    // Language
    let lang = gqlData?.lang || "";
    if (!lang) {
      const langBtn = document.querySelector("button.rounded.items-center.whitespace-nowrap");
      if (langBtn) {
        const t = langBtn.textContent?.trim() || "";
        if (FILE_EXTENSIONS[t]) lang = t;
      }
    }
    if (!lang) {
      for (const key of Object.keys(FILE_EXTENSIONS)) {
        const el = document.querySelector(`[data-value="${LANG_KEYS[key]}"]`);
        if (el) { lang = key; break; }
      }
    }
    if (!lang) lang = "Python3"; // Safe default

    // Performance metrics
    let runtime = gqlData?.runtime || "";
    let memory = gqlData?.memory || "";
    if (!runtime || !memory) {
      const metrics = document.querySelectorAll(".font-semibold, [class*='runtime'], [class*='memory']");
      for (const m of metrics) {
        const txt = m.textContent?.trim() || "";
        if (!runtime && (txt.includes("ms") || txt.includes("s"))) runtime = txt;
        else if (!memory && (txt.includes("MB") || txt.includes("KB"))) memory = txt;
      }
    }

    return {
      probNum, probName, rawName, titleSlug, lang, code: (code || "").trim(), runtime, memory,
    };
  }

  async function getSubmissionFromGraphQL(titleSlug) {
    try {
      let subId = null;
      // Try to get submission ID from URL (e.g. /submissions/detail/123456/)
      const urlMatch = window.location.pathname.match(/\/(?:submissions|detail)\/(?:detail\/)?(\d+)/) ||
                       window.location.href.match(/detail\/(\d+)/) ||
                       window.location.pathname.match(/(\d{7,})/);
      if (urlMatch && urlMatch[1]) {
        subId = parseInt(urlMatch[1], 10);
      }

      // If no ID in URL, fetch latest accepted submission for this problem
      if (!subId) {
        const listResp = await fetchProxy("https://leetcode.com/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `query questionSubmissionList($offset: Int!, $limit: Int!, $lastKey: String, $questionSlug: String!, $lang: Int, $status: Int) {
              questionSubmissionList(offset: $offset, limit: $limit, lastKey: $lastKey, questionSlug: $questionSlug, lang: $lang, status: $status) {
                submissions { id statusDisplay lang runtime memory }
              }
            }`,
            variables: { offset: 0, limit: 5, questionSlug: titleSlug },
          }),
        });
        if (listResp.ok) {
          const listData = await listResp.json();
          const subs = listData?.data?.questionSubmissionList?.submissions || [];
          const accepted = subs.find(s => s.statusDisplay === "Accepted" || s.statusDisplay === "10") || subs[0];
          if (accepted && accepted.id) {
            subId = parseInt(accepted.id, 10);
          }
        }
      }

      if (subId) {
        const detailResp = await fetchProxy("https://leetcode.com/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `query submissionDetails($submissionId: Int!) {
              submissionDetails(submissionId: $submissionId) {
                code
                runtimeDisplay
                memoryDisplay
                lang { name verboseName }
              }
            }`,
            variables: { submissionId: subId },
          }),
        });
        if (detailResp.ok) {
          const detailData = await detailResp.json();
          const details = detailData?.data?.submissionDetails;
          if (details && details.code) {
            return {
              code: details.code,
              runtime: details.runtimeDisplay || "",
              memory: details.memoryDisplay || "",
              lang: details.lang?.verboseName || details.lang?.name || "",
            };
          }
        }
      }
    } catch (e) {
      console.warn("LeetSync: GraphQL submission fetch failed", e);
    }
    return null;
  }

  function getCodeFromMainWorld() {
    return new Promise((resolve) => {
      const evtName = "leetsync_code_" + Date.now();
      const handler = (e) => {
        window.removeEventListener(evtName, handler);
        resolve(e.detail || "");
      };
      window.addEventListener(evtName, handler);

      const script = document.createElement("script");
      script.textContent = `
        (() => {
          let code = "";
          try {
            if (window.monaco && window.monaco.editor) {
              const models = window.monaco.editor.getModels();
              for (const m of models) {
                const val = m.getValue();
                if (val && val.trim().length > 0 && !m.uri.toString().includes("inmemory://")) {
                  code = val;
                  break;
                }
              }
              if (!code && models.length > 0) code = models[0].getValue();
            }
          } catch(e) {}
          window.dispatchEvent(new CustomEvent("${evtName}", { detail: code }));
        })();
      `;
      document.documentElement.appendChild(script);
      script.remove();
      setTimeout(() => {
        window.removeEventListener(evtName, handler);
        resolve("");
      }, 1000);
    });
  }

  function getCodeFromDOM() {
    let code = "";
    // 1. Monaco view lines
    const codeLines = document.querySelectorAll(".view-lines .view-line");
    if (codeLines.length > 0) {
      code = Array.from(codeLines).map(l => l.textContent).join("\n");
    }
    // 2. CodeMirror
    if (!code || !code.trim()) {
      const cmLines = document.querySelectorAll(".cm-content .cm-line, .CodeMirror-line");
      if (cmLines.length > 0) {
        code = Array.from(cmLines).map(l => l.textContent).join("\n");
      }
    }
    // 3. Pre > code or code
    if (!code || !code.trim()) {
      const preCode = document.querySelector("pre > code, code[class*='language-'], div[class*='source-code'] code");
      if (preCode) code = preCode.textContent || "";
    }
    // 4. Any textarea or pre
    if (!code || !code.trim()) {
      const pre = document.querySelector("pre");
      if (pre) code = pre.textContent || "";
    }
    return code.trim() ? code : "";
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BUTTON INJECTION
  // ═══════════════════════════════════════════════════════════════════════
  function injectButtons(configured) {
    const selectors = [
      "div.flex.justify-between.py-1.pl-3.pr-1 > div.relative.flex.overflow-hidden > div.flex-none.flex > div:nth-child(2)",
      "div.flex.justify-between.py-1.pl-3.pr-1",
      "#ide-top-btns > div:nth-child(1) > div > div > div:nth-child(2) > div > div:nth-child(2) > div > div:last-child",
    ];

    for (const sel of selectors) {
      const parent = document.querySelector(sel);
      if (parent && !parent.querySelector(".leetsync-btn")) {
        injectButton(parent, configured);
        break;
      }
    }
  }

  function injectButton(parent, configured) {
    if (parent.querySelector(".leetsync-btn")) return;

    const wrap = document.createElement("div");
    wrap.className = "leetsync-btn-wrap";

    // Settings button (gear icon)
    const settingsBtn = document.createElement("button");
    settingsBtn.className = "leetsync-btn leetsync-settings-btn";
    settingsBtn.title = "LeetSync Settings";
    settingsBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
    settingsBtn.addEventListener("click", async () => {
      await storageRemove(["github-token", "github-repo"]);
      showToast("Settings cleared — click Push to reconfigure", "info");
    });

    if (!configured) settingsBtn.style.display = "none";

    // Push button
    const pushBtn = document.createElement("button");
    pushBtn.className = "leetsync-btn leetsync-push-btn";
    pushBtn.title = configured ? `Push to GitHub (${SHORTCUT_DISPLAY})` : "Configure GitHub";
    pushBtn.innerHTML = configured
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg><span>Push</span>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg><span>Configure</span>`;
    pushBtn.addEventListener("click", handlePushClick);

    wrap.appendChild(settingsBtn);
    wrap.appendChild(pushBtn);
    parent.appendChild(wrap);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PUSH FLOW
  // ═══════════════════════════════════════════════════════════════════════
  async function handlePushClick() {
    const config = await getGithubConfig();

    // Not configured? Show config modal
    if (!isConfigComplete(config)) {
      showConfigModal();
      return;
    }

    const pushBtn = document.querySelector(".leetsync-push-btn");
    if (pushBtn) {
      pushBtn.disabled = true;
      pushBtn.innerHTML = `<span class="leetsync-spinner"></span><span>Extracting Code…</span>`;
    }

    // Always re-extract right before pushing to guarantee latest code and metrics from LeetCode API
    currentProblem = await extractProblemInfo();
    if (!currentProblem || !currentProblem.code || currentProblem.code === "# Solution code not found") {
      showToast("Could not extract solution code. Make sure you are on an Accepted submission page.", "error");
      if (pushBtn) {
        pushBtn.disabled = false;
        pushBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg><span>Push</span>`;
      }
      return;
    }

    if (pushBtn) {
      pushBtn.innerHTML = `<span class="leetsync-spinner"></span><span>Pushing…</span>`;
    }

    try {
      const token = config["github-token"];
      const repo = config["github-repo"];
      const geminiKey = config["gemini-key"];

      // Fetch problem details (description, difficulty, topic tags, folder)
      const details = await fetchProblemDetails(currentProblem.titleSlug);
      const folder = details.folder;
      const basePath = `${folder}/${currentProblem.probNum}-${currentProblem.probName}`;
      const ext = FILE_EXTENSIONS[currentProblem.lang] || ".txt";
      const langKey = LANG_KEYS[currentProblem.lang] || currentProblem.lang.toLowerCase();

      // File name
      const codeFileName = DB_LANGS.includes(currentProblem.lang)
        ? `solution${ext}`
        : `solution${ext}`;

      // Generate README (with solution explanation, problem description & complexity)
      let readmeContent = generateBasicReadme(currentProblem, details);
      if (geminiKey) {
        try {
          const aiReadme = await generateAIReadme(geminiKey, currentProblem, details);
          if (aiReadme) readmeContent = aiReadme;
        } catch (e) {
          console.warn("LeetSync: AI README generation failed, using basic template", e);
        }
      }

      // Commit message with performance metrics
      let commitMsg = `Add: ${currentProblem.probNum}. ${currentProblem.rawName} (${currentProblem.lang})`;
      if (currentProblem.runtime || currentProblem.memory) {
        const parts = [];
        if (currentProblem.runtime) parts.push(`Runtime: ${currentProblem.runtime}`);
        if (currentProblem.memory) parts.push(`Memory: ${currentProblem.memory}`);
        commitMsg += ` [${parts.join(", ")}]`;
      }

      // Push code file
      await pushToGitHub(token, repo, `${basePath}/${codeFileName}`, currentProblem.code, commitMsg);

      // Push README
      await pushToGitHub(token, repo, `${basePath}/README.md`, readmeContent, commitMsg);

      // Record submission to history
      chrome.runtime.sendMessage({
        action: "recordSubmission",
        data: {
          problemNum: currentProblem.probNum,
          problemName: currentProblem.rawName,
          difficulty: details.difficulty || "Unknown",
          language: currentProblem.lang,
          runtime: currentProblem.runtime,
          memory: currentProblem.memory,
        },
      });

      showToast(`✓ Pushed to ${repo}/${basePath}`, "success");

      // Solution comparison toast (NEW FEATURE)
      setTimeout(() => {
        showToast(
          `💡 Compare your solution: leetcode.com/problems/${currentProblem.titleSlug}/solutions/`,
          "info",
          8000
        );
      }, 3000);

      if (pushBtn) {
        pushBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg><span>Pushed!</span>`;
        pushBtn.classList.add("leetsync-success");
        setTimeout(() => {
          pushBtn.disabled = false;
          pushBtn.classList.remove("leetsync-success");
          pushBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg><span>Push</span>`;
        }, 3000);
      }
    } catch (err) {
      console.error("LeetSync push error:", err);
      showToast(`✗ Push failed: ${err.message}`, "error");
      if (pushBtn) {
        pushBtn.disabled = false;
        pushBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg><span>Push</span>`;
      }
    }
  }

  // ── Fetch Problem Details (Description, Difficulty, Tags, Folder) ──────
  async function fetchProblemDetails(titleSlug) {
    const defaultRes = {
      folder: "00-Uncategorized",
      difficulty: "Unknown",
      description: "",
      tags: [],
    };
    try {
      const resp = await fetchProxy("https://leetcode.com/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query getQuestionDetail($titleSlug: String!) {
            question(titleSlug: $titleSlug) {
              content
              difficulty
              topicTags { name }
            }
          }`,
          variables: { titleSlug },
        }),
      });

      if (!resp.ok) return defaultRes;

      const data = await resp.json();
      const q = data?.data?.question;
      if (!q) return defaultRes;

      const tags = (q.topicTags || []).map((t) => t.name);
      let folder = "00-Uncategorized";
      for (const tag of tags) {
        if (TOPIC_FOLDERS[tag]) {
          folder = TOPIC_FOLDERS[tag];
          break;
        }
      }

      return {
        folder,
        difficulty: q.difficulty || "Unknown",
        description: htmlToMarkdown(q.content || ""),
        tags,
      };
    } catch {
      return defaultRes;
    }
  }

  function htmlToMarkdown(html) {
    if (!html) return "";
    let md = html
      .replace(/<pre[^>]*>/gi, "\n```\n")
      .replace(/<\/pre>/gi, "\n```\n")
      .replace(/<code[^>]*>/gi, "`")
      .replace(/<\/code>/gi, "`")
      .replace(/<strong[^>]*>/gi, "**")
      .replace(/<\/strong>/gi, "**")
      .replace(/<b[^>]*>/gi, "**")
      .replace(/<\/b>/gi, "**")
      .replace(/<em[^>]*>/gi, "*")
      .replace(/<\/em>/gi, "*")
      .replace(/<i[^>]*>/gi, "*")
      .replace(/<\/i>/gi, "*")
      .replace(/<ul[^>]*>/gi, "\n")
      .replace(/<\/ul>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/li>/gi, "")
      .replace(/<p[^>]*>/gi, "\n\n")
      .replace(/<\/p>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, ""); // strip remaining tags

    return md.replace(/\n{3,}/g, "\n\n").trim();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GITHUB API
  // ═══════════════════════════════════════════════════════════════════════
  async function pushToGitHub(token, repo, path, content, message) {
    const url = `${GITHUB_API}/${repo}/contents/${path}`;

    // Check if file exists (to get SHA for updates)
    let sha = null;
    try {
      const existing = await fetchProxy(url, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });
      if (existing.ok) {
        const data = await existing.json();
        sha = data.sha;
      }
    } catch {}

    const body = {
      message,
      content: btoa(unescape(encodeURIComponent(content))),
    };
    if (sha) body.sha = sha;

    const resp = await fetchProxy(url, {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.message || `GitHub API error (${resp.status})`);
    }

    return resp.json();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // AI README GENERATION (Gemini API)
  // ═══════════════════════════════════════════════════════════════════════
  async function generateAIReadme(apiKey, problem, details = {}) {
    const langKey = LANG_KEYS[problem.lang] || problem.lang.toLowerCase();
    const tagsStr = (details.tags || []).map((t) => '`' + t + '`').join(" ");
    const prompt = `You are an expert software engineer and technical author. Write a comprehensive, professional Markdown README explaining the solution to this LeetCode problem.

Problem: ${problem.probNum}. ${problem.rawName}
Difficulty: ${details.difficulty || "Unknown"}
Topic Tags: ${(details.tags || []).join(", ")}
Language: ${problem.lang}

Problem Statement:
${details.description || "N/A"}

User's Accepted Code:
\`\`\`${langKey}
${problem.code}
\`\`\`

Generate a clean, beautifully formatted GitHub Markdown README with the following exact structure:
# 🚀 ${problem.probNum}. ${problem.rawName}

**Difficulty:** ${details.difficulty || "Unknown"} | **Tags:** ${tagsStr || "None"}

---

## 📝 Problem Description
(Cleanly present or summarize the problem statement and key constraints)

---

## 💡 Intuition
(What is the core insight or first thought to solve this problem? Why does this approach work?)

---

## 🛠️ Approach
(Provide a clear, step-by-step explanation of the algorithm and data structures used in the code)

---

## ⏳ Complexity Analysis
- **Time Complexity:** $O(...)$ — (Explain why)
- **Space Complexity:** $O(...)$ — (Explain why)

---

## 💻 Solution Code (${problem.lang})
\`\`\`${langKey}
${problem.code}
\`\`\`

---

## 📊 Performance Metrics
${problem.runtime ? `- **Runtime:** ${problem.runtime}` : "- **Runtime:** N/A"}
${problem.memory ? `- **Memory:** ${problem.memory}` : "- **Memory:** N/A"}

---
*Auto-generated by [LeetSync](https://github.com/) — Seamlessly syncing LeetCode to GitHub with AI.*`;

    const resp = await fetchProxy(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        }),
      }
    );

    if (!resp.ok) throw new Error("Gemini API request failed");

    const data = await resp.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  }

  function generateBasicReadme(p, details = {}) {
    const langKey = LANG_KEYS[p.lang] || p.lang.toLowerCase();
    const tagsStr = (details.tags || []).map((t) => '`' + t + '`').join(" ");
    return `# 🚀 ${p.probNum}. ${p.rawName}

**Difficulty:** ${details.difficulty || "Unknown"} | **Tags:** ${tagsStr || "None"}

---

## 📝 Problem Description

${details.description || "Problem description not available."}

---

## 💡 Solution (${p.lang})

\`\`\`${langKey}
${p.code}
\`\`\`

---

## 📊 Performance Metrics

${p.runtime ? `- **Runtime:** ${p.runtime}` : "- **Runtime:** N/A"}
${p.memory ? `- **Memory:** ${p.memory}` : "- **Memory:** N/A"}

---

> [!TIP]
> **Want AI-powered algorithm explanations?** Add your free Google Gemini API Key in the LeetSync extension settings to automatically generate step-by-step **Intuition**, **Approach**, and **Complexity Analysis** for every submission!

---
*Auto-generated by [LeetSync](https://github.com/) — Seamlessly syncing LeetCode to GitHub.*
`;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CONFIG MODAL
  // ═══════════════════════════════════════════════════════════════════════
  function showConfigModal() {
    if (document.getElementById("leetsync-config-modal")) return;

    const overlay = document.createElement("div");
    overlay.id = "leetsync-config-modal";
    overlay.className = "leetsync-modal-overlay";

    overlay.innerHTML = `
      <div class="leetsync-modal">
        <div class="leetsync-modal-header">
          <div class="leetsync-modal-logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffa116" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
            <h2>LeetSync</h2>
          </div>
          <button class="leetsync-modal-close" id="leetsync-modal-close">&times;</button>
        </div>
        <form id="leetsync-config-form" class="leetsync-modal-body">
          <div class="leetsync-field">
            <label for="leetsync-token">GitHub Personal Access Token</label>
            <input type="password" id="leetsync-token" placeholder="ghp_xxxxxxxxxxxx" autocomplete="off" required />
            <span class="leetsync-field-hint">Needs <code>repo</code> scope. <a href="https://github.com/settings/tokens/new?scopes=repo" target="_blank">Create one →</a></span>
          </div>
          <div class="leetsync-field">
            <label for="leetsync-repo">Target Repository</label>
            <input type="text" id="leetsync-repo" placeholder="username/leetcode-solutions" required />
            <span class="leetsync-field-hint">Format: <code>owner/repo-name</code></span>
          </div>
          <div class="leetsync-field">
            <label for="leetsync-gemini">Gemini API Key <span class="leetsync-optional">(optional)</span></label>
            <input type="password" id="leetsync-gemini" placeholder="AIzaSy..." autocomplete="off" />
            <span class="leetsync-field-hint">For AI-generated explanations. <a href="https://aistudio.google.com/app/apikey" target="_blank">Get key →</a></span>
          </div>
          <button type="submit" class="leetsync-save-btn">Save & Push</button>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close handlers
    document.getElementById("leetsync-modal-close").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    // Form submit
    document.getElementById("leetsync-config-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const token = document.getElementById("leetsync-token").value.trim();
      const repo = document.getElementById("leetsync-repo").value.trim();
      const gemini = document.getElementById("leetsync-gemini").value.trim();

      if (!token || !repo) {
        showToast("Token and repo are required", "error");
        return;
      }

      await storageSet({
        "github-token": token,
        "github-repo": repo,
        ...(gemini && { "gemini-key": gemini }),
      });

      overlay.remove();
      showToast("Configuration saved!", "success");

      // Re-inject buttons and trigger push
      const allBtns = document.querySelectorAll(".leetsync-btn-wrap");
      allBtns.forEach((b) => b.remove());
      injectButtons(true);

      setTimeout(() => handlePushClick(), 500);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // KEYBOARD SHORTCUT
  // ═══════════════════════════════════════════════════════════════════════
  let shortcutRegistered = false;
  function registerKeyboardShortcut() {
    if (shortcutRegistered) return;
    shortcutRegistered = true;

    document.addEventListener("keydown", (e) => {
      const modMatch =
        (KEYBOARD_SHORTCUT.modifier === "meta" && e.metaKey) ||
        (KEYBOARD_SHORTCUT.modifier === "alt" && e.altKey) ||
        (KEYBOARD_SHORTCUT.modifier === "shift" && e.shiftKey) ||
        (KEYBOARD_SHORTCUT.modifier === "ctrl" && e.ctrlKey);

      if (modMatch && e.key.toLowerCase() === KEYBOARD_SHORTCUT.key.toLowerCase()) {
        e.preventDefault();
        handlePushClick();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TOAST NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════════════
  function showToast(message, type = "info", duration = 4000) {
    // Remove existing toasts
    const existing = document.querySelectorAll(".leetsync-toast");
    existing.forEach((t, i) => {
      t.style.transform = `translateY(-${(existing.length - i) * 60}px)`;
    });

    const toast = document.createElement("div");
    toast.className = `leetsync-toast leetsync-toast-${type}`;
    toast.innerHTML = `
      <span class="leetsync-toast-text">${message}</span>
      <button class="leetsync-toast-close">&times;</button>
    `;

    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.add("leetsync-toast-visible");
    });

    // Close button
    toast.querySelector(".leetsync-toast-close").addEventListener("click", () => {
      toast.classList.remove("leetsync-toast-visible");
      setTimeout(() => toast.remove(), 300);
    });

    // Auto dismiss
    setTimeout(() => {
      toast.classList.remove("leetsync-toast-visible");
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
})();
