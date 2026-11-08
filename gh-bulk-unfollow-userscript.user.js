// ==UserScript==
// @name         GitHub Bulk Unfollow
// @namespace    https://github.com/chirag127
// @version      1.0.0
// @description  Review everyone you follow on GitHub in a dry-run queue, then bulk-unfollow with a hard cap, whitelist and 3 parallel POSTs using the page's authenticity_token.
// @author       chirag127
// @license      MIT
// @match        https://github.com/*
// @icon         https://github.com/favicon.ico
// @homepageURL  https://github.com/chirag127/gh-bulk-unfollow-userscript
// @supportURL   https://github.com/chirag127/gh-bulk-unfollow-userscript/issues
// @downloadURL  https://github.com/chirag127/gh-bulk-unfollow-userscript/raw/main/gh-bulk-unfollow-userscript.user.js
// @updateURL    https://github.com/chirag127/gh-bulk-unfollow-userscript/raw/main/gh-bulk-unfollow-userscript.user.js
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const SET_KEY = "ghbu.settings.v1";
  const HARD_CAP = 500;
  const MAX_PAGES = 80;

  const defaults = { cap: 50, concurrency: 3, whitelist: "", skipMutual: false };
  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) { return {}; } };
  const settings = Object.assign({}, defaults, readJSON(SET_KEY));
  const saveSettings = () => localStorage.setItem(SET_KEY, JSON.stringify(settings));

  const me = () => {
    const meta = document.querySelector('meta[name="user-login"]');
    const login = meta && meta.content;
    if (!login) throw new Error("not signed in to GitHub");
    return login;
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = () => sleep(150 + Math.random() * 250);
  const h = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const isTyping = () => {
    const a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
  };
  const abs = (p) => (p.startsWith("http") ? p : "https://github.com" + p);

  async function getHtml(url) {
    const r = await fetch(url, { credentials: "include", headers: { accept: "text/html" } });
    if (r.status === 429) throw new Error("rate limited (429)");
    if (!r.ok) throw new Error("GET " + url.replace("https://github.com", "") + " -> " + r.status);
    return r.text();
  }

  /** Parse one following page into {login, name, token} rows. */
  function parseFollowing(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = new Map();
    const globalToken = (doc.querySelector('input[name="authenticity_token"]') || {}).value || "";

    doc.querySelectorAll("form[action$='/unfollow']").forEach((form) => {
      const m = (form.getAttribute("action") || "").match(/^\/users\/([^/]+)\/unfollow/);
      if (!m) return;
      const login = decodeURIComponent(m[1]);
      const token = (form.querySelector('input[name="authenticity_token"]') || {}).value || globalToken;
      const box = form.closest(".follow-list-item, li, .d-flex") || form.parentElement;
      const link = box && box.querySelector('a[data-hovercard-type="user"], a[href^="/"]');
      const nameEl = box && box.querySelector(".follow-list-item-fullname, .f4, strong");
      rows.set(login.toLowerCase(), {
        login: login,
        name: (nameEl && nameEl.textContent.trim()) || "",
        token: token,
      });
      if (link) rows.get(login.toLowerCase()).href = link.getAttribute("href");
    });

    if (!rows.size) {
      doc.querySelectorAll('a[data-hovercard-type="user"]').forEach((a) => {
        const login = (a.getAttribute("href") || "").replace(/^\//, "").split(/[/?#]/)[0];
        if (!login || login === "orgs") return;
        rows.set(login.toLowerCase(), { login: login, name: "", token: globalToken, href: a.getAttribute("href") });
      });
    }
    return { rows: [...rows.values()], token: globalToken };
  }

  async function listFollowing(onPage) {
    const user = me();
    const out = new Map();
    let token = "";
    for (let page = 1; page <= MAX_PAGES; page++) {
      const html = await getHtml("https://github.com/" + user + "?page=" + page + "&tab=following");
      const parsed = parseFollowing(html);
      token = token || parsed.token;
      let added = 0;
      for (const row of parsed.rows) {
        if (out.has(row.login.toLowerCase())) continue;
        out.set(row.login.toLowerCase(), row);
        added++;
      }
      onPage && onPage(out.size);
      if (!added || !parsed.rows.length) break;
      await jitter();
    }
    return { list: [...out.values()], token: token };
  }

  async function unfollow(item) {
    const body = new URLSearchParams({ authenticity_token: item.token });
    const post = () => fetch("https://github.com/users/" + encodeURIComponent(item.login) + "/unfollow", {
      method: "POST",
      credentials: "include",
      redirect: "follow",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-requested-with": "XMLHttpRequest",
        accept: "text/html, */*",
      },
      body: body.toString(),
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await post();
        if (r.status === 429 || r.status >= 500) {
          if (attempt === 0) { await sleep(2200); continue; }
          throw new Error("HTTP " + r.status);
        }
        if (!r.ok) throw new Error("HTTP " + r.status);
        if (/\/login/.test(r.url) && !/\/login/.test(location.href)) throw new Error("session lost");
        return true;
      } catch (e) {
        if (attempt === 1) throw e;
        await sleep(900);
      }
    }
    return false;
  }

  // ---------- UI ----------
  const CSS = [
    ".gh{position:fixed;z-index:2147483000;top:70px;right:20px;width:520px;height:520px;background:#181818;color:#e8e8e8;",
    "border:1px solid #303030;border-radius:10px;box-shadow:0 14px 44px rgba(0,0,0,.65);display:flex;flex-direction:column;",
    "font:13px/1.45 Roboto,'Segoe UI',system-ui,sans-serif;overflow:hidden;resize:both;min-width:360px;min-height:280px}",
    ".gh *{box-sizing:border-box}",
    ".gh-head{display:flex;align-items:center;gap:8px;padding:9px 11px;background:#202020;border-bottom:1px solid #303030;cursor:move;user-select:none}",
    ".gh-title{font-weight:600;font-size:13px;letter-spacing:.2px;flex:1}",
    ".gh-badge{font-size:10px;color:#9a9a9a;border:1px solid #3a3a3a;border-radius:4px;padding:1px 5px}",
    ".gh-btn{background:#2a2a2a;color:#e8e8e8;border:1px solid #3a3a3a;border-radius:6px;padding:5px 10px;font:inherit;cursor:pointer}",
    ".gh-btn:hover{background:#333}.gh-btn:disabled{opacity:.45;cursor:default}",
    ".gh-btn.primary{background:#065fd4;border-color:#065fd4}.gh-btn.primary:hover{background:#0a72f5}",
    ".gh-btn.danger{background:#5c1d1d;border-color:#7a2a2a}.gh-btn.danger:hover{background:#7a2a2a}",
    ".gh-x{background:none;border:0;color:#9a9a9a;font-size:16px;line-height:1;cursor:pointer;padding:0 2px}",
    ".gh-body{flex:1;display:flex;flex-direction:column;min-height:0}",
    ".gh-bar{display:flex;gap:6px;padding:8px 11px;border-bottom:1px solid #262626;flex-wrap:wrap}",
    ".gh-stat{font-size:11px;color:#9a9a9a;padding:0 11px 6px}",
    ".gh-prog{height:4px;background:#262626}.gh-prog>i{display:block;height:100%;width:0;background:#065fd4;transition:width .18s}",
    ".gh-wrap{flex:1;overflow:auto;min-height:60px;border-bottom:1px solid #262626}",
    ".gh-table{width:100%;border-collapse:collapse;font-size:12px}",
    ".gh-table th{position:sticky;top:0;background:#202020;color:#9a9a9a;font-weight:500;text-align:left;padding:5px 8px;border-bottom:1px solid #303030}",
    ".gh-table td{padding:4px 8px;border-bottom:1px solid #242424;vertical-align:top}",
    ".gh-table tr.off td{opacity:.42}",
    ".gh-ava{width:32px;height:32px;border-radius:50%;background:#262626;display:block}",
    ".gh-login{font-weight:600}.gh-name{color:#9a9a9a;font-size:11px}",
    ".gh-st{font-size:11px;color:#9a9a9a}.gh-st.ok{color:#4caf7d}.gh-st.err{color:#e06c6c}",
    ".gh-log{height:100px;overflow:auto;font:11px/1.5 ui-monospace,Consolas,monospace;padding:6px 11px;background:#141414;color:#9a9a9a;white-space:pre-wrap;word-break:break-word}",
    ".gh-set{padding:0 11px 9px;font-size:11px;color:#bdbdbd}.gh-set summary{cursor:pointer;padding:5px 0;color:#9a9a9a}",
    ".gh-field{display:flex;align-items:center;gap:6px;margin:5px 0}",
    ".gh-field input[type=number]{background:#101010;color:#e8e8e8;border:1px solid #3a3a3a;border-radius:5px;padding:3px 6px;font:inherit;width:74px}",
    ".gh-field textarea{background:#101010;color:#e8e8e8;border:1px solid #3a3a3a;border-radius:5px;padding:4px 6px;font:inherit;width:100%;height:44px;resize:vertical}",
    ".gh-chip{position:fixed;z-index:2147483000;right:20px;bottom:20px;background:#065fd4;color:#fff;border:0;border-radius:18px;padding:7px 14px;font:600 12px Roboto,system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.5);display:none}",
    ".gh-hide{display:none!important}",
  ].join("");

  function makeUI() {
    const style = h("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    const panel = h("div", "gh gh-panel");
    const head = h("div", "gh-head");
    const title = h("div", "gh-title", "GitHub Bulk Unfollow");
    const badge = h("span", "gh-badge", "v1.0.0");
    const collapse = h("button", "gh-x", "\u2013");
    const close = h("button", "gh-x", "\u00d7");
    head.append(title, badge, collapse, close);

    const bar = h("div", "gh-bar");
    const btnScan = h("button", "gh-btn primary", "Scan following");
    const btnRun = h("button", "gh-btn", "Unfollow 0");
    const btnPause = h("button", "gh-btn", "Pause");
    const btnStop = h("button", "gh-btn danger", "Stop");
    const btnAll = h("button", "gh-btn", "All");
    const btnNone = h("button", "gh-btn", "None");
    btnRun.disabled = btnPause.disabled = btnStop.disabled = btnAll.disabled = btnNone.disabled = true;
    bar.append(btnScan, btnRun, btnPause, btnStop, btnAll, btnNone);

    const stat = h("div", "gh-stat", "Idle. Scan your following list, review, then confirm.");
    const prog = h("div", "gh-prog");
    const progFill = h("i");
    prog.appendChild(progFill);

    const wrap = h("div", "gh-wrap");
    const table = h("table", "gh-table");
    const thead = h("thead");
    const hr = h("tr");
    ["", "Account", "Status"].forEach((label, i) => {
      const th = h("th", null, label);
      if (i === 0) th.style.width = "26px";
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    const tbody = h("tbody");
    table.append(thead, tbody);
    wrap.appendChild(table);

    const logBox = h("div", "gh-log");
    const setBox = h("details", "gh-set");
    setBox.appendChild(h("summary", null, "Settings"));
    const capField = h("label", "gh-field");
    capField.append(h("span", null, "Max unfollows per run"), (() => {
      const n = h("input");
      n.type = "number";
      n.min = "1";
      n.max = String(HARD_CAP);
      n.value = String(settings.cap);
      capField._in = n;
      return n;
    })());
    const conField = h("label", "gh-field");
    conField.append(h("span", null, "Parallel workers"), (() => {
      const n = h("input");
      n.type = "number";
      n.min = "1";
      n.max = "5";
      n.value = String(settings.concurrency);
      conField._in = n;
      return n;
    })());
    const wlField = h("label", "gh-field");
    wlField.style.display = "block";
    wlField.append(h("span", null, "Whitelist - logins, comma or newline separated"));
    const wlIn = h("textarea");
    wlIn.value = settings.whitelist;
    wlField.appendChild(wlIn);
    setBox.append(capField, conField, wlField);

    const body = h("div", "gh-body");
    body.append(bar, stat, prog, wrap, setBox, logBox);
    panel.append(head, body);
    const chip = h("button", "gh-chip", "\u2191 Bulk Unfollow");
    document.body.append(panel, chip);

    head.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest("button")) return;
      const r = panel.getBoundingClientRect();
      const dx = ev.clientX - r.left;
      const dy = ev.clientY - r.top;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = r.left + "px";
      panel.style.top = r.top + "px";
      const move = (e) => {
        panel.style.left = Math.max(0, e.clientX - dx) + "px";
        panel.style.top = Math.max(0, e.clientY - dy) + "px";
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    collapse.addEventListener("click", () => {
      panel.classList.add("gh-hide");
      chip.style.display = "block";
    });
    chip.addEventListener("click", () => {
      chip.style.display = "none";
      panel.classList.remove("gh-hide");
    });
    close.addEventListener("click", () => {
      panel.remove();
      chip.remove();
    });

    const sync = () => {
      settings.cap = Math.max(1, Math.min(HARD_CAP, Number(capField._in.value) || 50));
      settings.concurrency = Math.max(1, Math.min(5, Number(conField._in.value) || 3));
      settings.whitelist = wlIn.value;
      saveSettings();
    };
    [capField._in, conField._in, wlIn].forEach((n) => n.addEventListener("change", sync));

    const ui = {
      panel: panel,
      chip: chip,
      btnScan: btnScan,
      btnRun: btnRun,
      btnPause: btnPause,
      btnStop: btnStop,
      btnAll: btnAll,
      btnNone: btnNone,
      progFill: progFill,
      tbody: tbody,
      log: (msg, cls) => {
        const line = h("div", cls || null, "[" + new Date().toLocaleTimeString() + "] " + msg);
        logBox.appendChild(line);
        while (logBox.childElementCount > 300) logBox.firstChild.remove();
        logBox.scrollTop = logBox.scrollHeight;
      },
      stat: (t) => { stat.textContent = t; },
      progress: (done, total) => { progFill.style.width = (total ? (done / total) * 100 : 0) + "%"; },
      clearRows: () => { tbody.textContent = ""; },
      row: (item) => {
        const tr = h("tr");
        const td0 = h("td");
        const cb = h("input");
        cb.type = "checkbox";
        cb.checked = !!item.sel;
        td0.appendChild(cb);
        const td1 = h("td");
        const box = h("div");
        box.style.display = "flex";
        box.style.gap = "8px";
        box.style.alignItems = "center";
        const img = h("img", "gh-ava");
        img.src = "https://github.com/" + encodeURIComponent(item.login) + ".png?size=48";
        img.loading = "lazy";
        img.alt = "";
        const names = h("div");
        const a = h("a", "gh-login", item.login);
        a.href = abs(item.href || "/" + item.login);
        a.target = "_blank";
        a.rel = "noreferrer";
        names.appendChild(a);
        if (item.name) names.appendChild(h("div", "gh-name", item.name));
        box.append(img, names);
        td1.appendChild(box);
        const td2 = h("td");
        const st = h("span", "gh-st", "queued");
        td2.appendChild(st);
        tr.append(td0, td1, td2);
        tbody.appendChild(tr);
        item.cb = cb;
        item.tr = tr;
        item.st = st;
        cb.addEventListener("change", () => {
          item.sel = cb.checked;
          tr.classList.toggle("off", !cb.checked);
          ui.onSelChange && ui.onSelChange();
        });
        tr.classList.toggle("off", !item.sel);
        return item;
      },
      setStatus: (item, text, cls) => {
        item.st.textContent = text;
        item.st.className = "gh-st" + (cls ? " " + cls : "");
      },
    };
    return ui;
  }

  // ---------- state ----------
  let ui = null;
  let items = [];
  let phase = "idle";
  const run = { stop: false, paused: false, done: 0, ok: 0, fail: 0 };
  const selected = () => items.filter((i) => i.sel);
  const whitelist = () => new Set(settings.whitelist.split(/[\s,]+/).map((s) => s.trim().replace(/^@/, "").toLowerCase()).filter(Boolean));

  function refresh() {
    if (!ui) return;
    const n = selected().length;
    ui.btnRun.textContent = phase === "running" ? "Running…" : "Unfollow " + n;
    ui.btnRun.disabled = phase !== "ready" || n === 0;
    ui.stat(
      phase === "running"
        ? run.done + " / " + items.length + " processed - " + run.ok + " unfollowed, " + run.fail + " failed"
        : n + " of " + items.length + " selected. Cap " + settings.cap + "."
    );
  }

  async function scan() {
    phase = "idle";
    ui.clearRows();
    items = [];
    ui.btnScan.disabled = true;
    ui.btnRun.disabled = true;
    ui.btnAll.disabled = ui.btnNone.disabled = true;
    ui.log("Reading your following pages…");
    try {
      const { list, token } = await listFollowing((n) => ui.stat("Loaded " + n + " accounts…"));
      if (!token) ui.log("No authenticity_token found - unfollow POSTs may fail; reload the page.", "gh-st err");
      const white = whitelist();
      for (const row of list) {
        row.token = row.token || token;
        row.sel = !white.has(row.login.toLowerCase());
        if (!row.sel) row.why = "whitelist";
        items.push(row);
      }
      let kept = 0;
      for (const it of items) {
        if (!it.sel) continue;
        if (kept >= settings.cap) { it.sel = false; it.why = "over cap"; } else kept++;
      }
      items.forEach((it) => ui.row(it));
      ui.log("Found " + items.length + " following, " + kept + " selected, " + (items.length - kept) + " held back.");
      phase = "ready";
      ui.btnAll.disabled = ui.btnNone.disabled = false;
    } catch (e) {
      ui.log("Scan failed: " + e.message, "gh-st err");
      ui.stat("Scan failed - see log.");
    } finally {
      ui.btnScan.disabled = false;
      refresh();
    }
  }

  async function runQueue(queue) {
    let i = 0;
    const workers = Array.from({ length: Math.min(settings.concurrency, queue.length) }, async () => {
      while (i < queue.length) {
        if (run.stop) return;
        while (run.paused) await sleep(120);
        const item = queue[i++];
        if (!item) return;
        ui.setStatus(item, "working…");
        try {
          await unfollow(item);
          run.ok++;
          ui.setStatus(item, "unfollowed", "ok");
          ui.log("unfollowed " + item.login);
        } catch (e) {
          run.fail++;
          ui.setStatus(item, "failed: " + e.message, "err");
          ui.log("FAILED " + item.login + " - " + e.message, "gh-st err");
        }
        run.done++;
        ui.progress(run.done, queue.length);
        refresh();
        if (!run.stop) await jitter();
      }
    });
    await Promise.all(workers);
  }

  async function start() {
    if (phase !== "ready") return;
    const queue = selected();
    if (!queue.length) return;
    phase = "running";
    run.stop = false;
    run.paused = false;
    run.done = run.ok = run.fail = 0;
    ui.btnScan.disabled = true;
    ui.btnPause.disabled = ui.btnStop.disabled = false;
    ui.btnPause.textContent = "Pause";
    ui.progress(0, queue.length);
    ui.log("Starting " + queue.length + " unfollows, " + settings.concurrency + " workers.");
    await runQueue(queue);
    phase = "done";
    ui.btnScan.disabled = false;
    ui.btnPause.disabled = ui.btnStop.disabled = true;
    ui.btnRun.disabled = true;
    refresh();
    ui.log((run.stop ? "Stopped. " : "Finished. ") + run.ok + " unfollowed, " + run.fail + " failed.", run.fail ? "gh-st err" : "gh-st ok");
    ui.stat("Done. Reload the following page to confirm.");
  }

  function toggleAll(on) {
    if (phase === "running") return;
    let kept = 0;
    for (const it of items) {
      if (on) {
        if (kept >= settings.cap) { it.sel = false; it.why = "over cap"; }
        else { it.sel = true; it.why = ""; kept++; }
      } else it.sel = false;
      it.cb.checked = it.sel;
      it.tr.classList.toggle("off", !it.sel);
    }
    refresh();
  }

  function mount() {
    if (document.querySelector(".gh-panel") || !document.body) return;
    ui = makeUI();
    ui.onSelChange = refresh;
    ui.btnScan.addEventListener("click", scan);
    ui.btnRun.addEventListener("click", start);
    ui.btnPause.addEventListener("click", () => {
      run.paused = !run.paused;
      ui.btnPause.textContent = run.paused ? "Resume" : "Pause";
      ui.log(run.paused ? "Paused." : "Resumed.");
    });
    ui.btnStop.addEventListener("click", () => { run.stop = true; run.paused = false; ui.log("Stop requested."); });
    ui.btnAll.addEventListener("click", () => toggleAll(true));
    ui.btnNone.addEventListener("click", () => toggleAll(false));
    ui.log("Ready. Scan builds the queue; nothing is posted until you confirm.");
  }

  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    if (!document.querySelector(".gh-panel")) mount();
  }, 800);

  document.addEventListener("keydown", (e) => {
    if (!e.altKey || !e.shiftKey || e.key.toLowerCase() !== "f" || isTyping()) return;
    e.preventDefault();
    if (!ui) return mount();
    if (ui.panel.classList.contains("gh-hide")) ui.chip.click(); else ui.panel.classList.toggle("gh-hide");
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
