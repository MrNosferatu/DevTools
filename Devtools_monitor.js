// ==UserScript==
// @name         DevTools Sidebar — Network Monitor Plugin
// @namespace    http://tampermonkey.net/
// @version      3.6.12
// @description  Network Monitor plugin for DevTools Sidebar — a simple persistent network log with regex/search filtering and literal cURL export.
// @author       MrNosferatu
// ==/UserScript==

// Registers a factory rather than running immediately — see Devtools_plugins.js.
DT_registerPlugin(function createMonitorPlugin(ctx) {
  const { Store, state, $, escHtml, schemaBlock, tip, ALL_METHODS, METHOD_COLORS } = ctx;

  // ─── Network Monitor panel HTML ───────────────────────────────────────────────
  function buildMonitorPanel() {
    return `
      <div class="dt-section">
        <div class="dt-slabel">Network Monitor</div>
        <div class="dt-row-sub" style="margin-bottom:14px;color:var(--mu);font-size:11px">A simple, persistent network log — like your browser's DevTools Network tab, but simpler. Captures method, status, headers, and body for every matching request, and keeps the log across page reloads.</div>
        <div class="dt-row" style="margin-bottom:0">
          <div class="dt-row-label">Monitor requests</div>
          <label class="dt-toggle"><input type="checkbox" id="dt-mon-enabled"><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
        </div>
      </div>

      <div class="dt-section">
        <div class="dt-slabel">Methods</div>
        <div class="dt-method-grid">${ALL_METHODS.map(m=>`<input type="checkbox" class="dt-method-check" id="dt-mon-m-${m}" data-m="${m}"><label class="dt-method-pill" for="dt-mon-m-${m}">${m}</label>`).join('')}</div>
      </div>

      <div class="dt-section">
        <div class="dt-slabel">Filter ${tip('Both apply live to the log below and combine together. Filter matches the URL; Search also looks inside headers and bodies.')}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <input class="dt-baseurl-entry-url" id="dt-mon-regex" placeholder="Filter URL by regex…" spellcheck="false" autocomplete="off" style="width:100%;box-sizing:border-box;margin:0">
          <input class="dt-baseurl-entry-url" id="dt-mon-search" placeholder="Search method, url, headers, body…" spellcheck="false" autocomplete="off" style="width:100%;box-sizing:border-box;margin:0">
        </div>
      </div>

      <div class="dt-section" id="dt-mon-log-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div class="dt-slabel" id="dt-mon-count-label" style="margin-bottom:0">Log (0)</div>
          <button class="dt-bench-copy-btn" id="dt-mon-clear">Clear</button>
        </div>
        <div class="dt-mon-loglist" id="dt-mon-list">
          <div class="dt-bench-capture-empty" id="dt-mon-empty">Enable monitoring to start logging matching requests.</div>
        </div>
      </div>
    `;
  }

  // ─── Network Monitor ────────────────────────────────────────────────────────
  // A simple, persistent network log — like the browser's DevTools Network tab,
  // but deliberately simpler: one on/off toggle, a regex filter, a free-text
  // search, and "Copy as cURL" with the REAL captured values. (Contrast with the
  // API Recorder plugin, which stores data TYPES instead of real values, grouped
  // by endpoint, for documentation — this is a flat, literal request log.)

  const MON_MAX_ENTRIES = 300;
  const MON_MAX_BODY_CHARS = 20000;

  function shouldMonitor(url, method) {
    if (!state.monitor.enabled) return false;
    return state.monitor.methods.includes((method || 'GET').toUpperCase());
  }

  function truncateBody(s) {
    if (!s) return s;
    return s.length > MON_MAX_BODY_CHARS ? s.slice(0, MON_MAX_BODY_CHARS) + `\n…[truncated — ${s.length.toLocaleString()} chars total]` : s;
  }

  function monitorCapture(url, method, reqHeaders, reqBody, status, statusText, resHeaders, resBody, duration) {
    if (!shouldMonitor(url, method)) return;
    const entry = {
      id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      method: (method || 'GET').toUpperCase(), url, status: status || 0, statusText: statusText || '',
      reqHeaders: reqHeaders || {}, reqBody: truncateBody(reqBody || ''),
      resHeaders: resHeaders || {}, resBody: truncateBody(resBody || ''),
      time: Date.now(), duration: duration || 0,
    };
    state.monitor.entries.unshift(entry);
    if (state.monitor.entries.length > MON_MAX_ENTRIES) state.monitor.entries.length = MON_MAX_ENTRIES;
    scheduleMonitorPersist();
    scheduleRenderMonitorList();
  }

  // Capture can fire multiple times a second on a busy site. Persisting meant
  // re-serializing up to 300 entries (each with up to 20k-char bodies) into GM
  // storage per request, and rendering tore down the whole log DOM each time —
  // collapsing any row the user had just expanded. Debounce both.
  let _monPersistTimer = null;
  function scheduleMonitorPersist() {
    clearTimeout(_monPersistTimer);
    _monPersistTimer = setTimeout(() => { _monPersistTimer = null; Store.set('mon.entries', state.monitor.entries); }, 600);
  }
  let _monRenderTimer = null;
  function scheduleRenderMonitorList() {
    if (_monRenderTimer) return;
    _monRenderTimer = setTimeout(() => { _monRenderTimer = null; renderMonitorList(); }, 350);
  }

  function monStatusColor(status) {
    if (!status) return 'var(--mu)';
    if (status >= 200 && status < 300) return 'var(--gn)';
    if (status >= 300 && status < 400) return 'var(--ac)';
    if (status >= 400 && status < 500) return 'var(--am)';
    if (status >= 500) return 'var(--rd)';
    return 'var(--mu)';
  }
  function monRelTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 1000) return 'just now';
    if (diff < 60000) return Math.floor(diff / 1000) + 's ago';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
  }

  function filterMonitorEntries() {
    let entries = state.monitor.entries;
    const regexStr = (state.monitor.regex || '').trim();
    if (regexStr) {
      try {
        const re = new RegExp(regexStr, 'i');
        entries = entries.filter(e => re.test(e.url));
      } catch {
        // Invalid/incomplete regex (e.g. mid-typing) — fall back to a plain
        // substring match so the list doesn't just go blank while typing.
        const needle = regexStr.toLowerCase();
        entries = entries.filter(e => e.url.toLowerCase().includes(needle));
      }
    }
    const search = (state.monitor.search || '').trim().toLowerCase();
    if (search) {
      entries = entries.filter(e =>
        e.url.toLowerCase().includes(search) ||
        e.method.toLowerCase().includes(search) ||
        String(e.status).includes(search) ||
        JSON.stringify(e.reqHeaders).toLowerCase().includes(search) ||
        JSON.stringify(e.resHeaders).toLowerCase().includes(search) ||
        (e.reqBody || '').toLowerCase().includes(search) ||
        (e.resBody || '').toLowerCase().includes(search)
      );
    }
    return entries;
  }

  // Real, literal cURL reproduction (unlike the Recorder's typed/placeholder
  // version) — this is meant to be pasted into a terminal and actually run.
  function buildRealCurl(entry) {
    const SKIP = new Set(['content-length','connection','host']);
    let curl = `curl '${entry.url.replace(/'/g, "'\"'\"'")}'`;
    if (entry.method !== 'GET') curl += ` \\\n  -X ${entry.method}`;
    Object.entries(entry.reqHeaders || {}).forEach(([k,v]) => {
      if (SKIP.has(k.toLowerCase())) return;
      curl += ` \\\n  -H '${k}: ${String(v).replace(/'/g, "'\"'\"'")}'`;
    });
    if (entry.reqBody && entry.method !== 'GET') {
      curl += ` \\\n  -d '${entry.reqBody.replace(/'/g, "'\"'\"'")}'`;
    }
    curl += ` \\\n  --compressed`;
    return curl;
  }

  function prettyBody(s) {
    if (!s) return '';
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
  }

  function renderMonitorList() {
    const list = $('dt-mon-list');
    const emptyMsg = $('dt-mon-empty');
    const countLabel = $('dt-mon-count-label');
    if (!list) return;
    // Remember which rows the user had expanded so a background re-render
    // (new capture landing) doesn't collapse them mid-read.
    const openIds = new Set([...list.querySelectorAll('.dt-mon-row.open')].map(el => el.dataset.id));
    [...list.querySelectorAll('.dt-mon-row')].forEach(el => el.remove());
    const all = state.monitor.entries;
    const filtered = filterMonitorEntries();
    if (countLabel) countLabel.textContent = `Log (${filtered.length}${filtered.length !== all.length ? ` of ${all.length}` : ''})`;
    if (!filtered.length) {
      if (emptyMsg) {
        emptyMsg.style.display = '';
        emptyMsg.textContent = all.length ? 'No requests match the current filter.' : (state.monitor.enabled ? 'Listening — matching requests will appear here.' : 'Enable monitoring to start logging matching requests.');
      }
      return;
    }
    if (emptyMsg) emptyMsg.style.display = 'none';
    filtered.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'dt-mon-row';
      row.dataset.id = entry.id;
      row.innerHTML = `
        <div class="dt-mon-row-head">
          <span class="dt-mon-method" style="background:${METHOD_COLORS[entry.method] || '#555'}">${entry.method}</span>
          <span class="dt-mon-status" style="color:${monStatusColor(entry.status)}">${entry.status || '—'}</span>
          <span class="dt-mon-url">${escHtml(entry.url)}</span>
          <span class="dt-mon-time">${monRelTime(entry.time)}</span>
        </div>
        <div class="dt-mon-detail"></div>
      `;
      const head = row.querySelector('.dt-mon-row-head');
      const detail = row.querySelector('.dt-mon-detail');
      head.addEventListener('click', () => {
        row.classList.toggle('open');
        if (row.classList.contains('open') && !detail._rendered) { renderMonitorDetail(detail, entry); detail._rendered = true; }
      });
      if (openIds.has(entry.id)) {
        row.classList.add('open');
        renderMonitorDetail(detail, entry);
        detail._rendered = true;
      }
      list.appendChild(row);
    });
  }

  function renderMonitorDetail(container, entry) {
    const reqHeadersStr = Object.entries(entry.reqHeaders || {}).map(([k,v]) => `${k}: ${v}`).join('\n') || '—';
    const resHeadersStr = Object.entries(entry.resHeaders || {}).map(([k,v]) => `${k}: ${v}`).join('\n') || '—';
    let html = '';
    html += `<div class="dt-mon-meta">${entry.statusText ? escHtml(entry.statusText) + ' · ' : ''}${entry.duration}ms · ${new Date(entry.time).toLocaleTimeString()}</div>`;
    html += schemaBlock('Request Headers', escHtml(reqHeadersStr));
    if (entry.reqBody) html += schemaBlock('Request Body', escHtml(prettyBody(entry.reqBody)));
    html += schemaBlock('Response Headers', escHtml(resHeadersStr));
    if (entry.resBody) html += schemaBlock('Response Body', escHtml(prettyBody(entry.resBody)));
    html += `<div class="dt-rec-endpoint-actions"><button class="dt-bench-copy-btn dt-mon-copy-curl">Copy as cURL</button></div>`;
    container.innerHTML = html;
    container.querySelector('.dt-mon-copy-curl').addEventListener('click', e => {
      const curl = buildRealCurl(entry);
      navigator.clipboard.writeText(curl).then(() => {
        const btn = e.currentTarget, orig = btn.textContent;
        btn.textContent = 'Copied! ✓'; setTimeout(() => btn.textContent = orig, 1800);
      });
    });
  }

  function initMonitorPanel() {
    const enabledChk = $('dt-mon-enabled');
    if (!enabledChk) return;
    enabledChk.checked = state.monitor.enabled;
    enabledChk.addEventListener('change', e => {
      state.monitor.enabled = e.target.checked;
      Store.set('mon.enabled', state.monitor.enabled);
      renderMonitorList();
    });

    ALL_METHODS.forEach(m => {
      const el = $(`dt-mon-m-${m}`); if (!el) return;
      el.checked = state.monitor.methods.includes(m);
      el.addEventListener('change', () => {
        state.monitor.methods = ALL_METHODS.filter(x => $(`dt-mon-m-${x}`).checked);
        Store.set('mon.methods', state.monitor.methods);
      });
    });

    const regexInput = $('dt-mon-regex');
    regexInput.value = state.monitor.regex;
    regexInput.addEventListener('input', e => { state.monitor.regex = e.target.value; renderMonitorList(); });

    const searchInput = $('dt-mon-search');
    searchInput.value = state.monitor.search;
    searchInput.addEventListener('input', e => { state.monitor.search = e.target.value; renderMonitorList(); });

    $('dt-mon-clear').addEventListener('click', () => {
      if (!confirm('Clear the network log? This cannot be undone.')) return;
      state.monitor.entries = [];
      Store.set('mon.entries', state.monitor.entries);
      renderMonitorList();
    });

    renderMonitorList();

    // Relative timestamps ("just now", "2m ago") are baked in at render time
    // and previously went stale until the next capture forced a re-render. Only
    // re-render when the list is actually on screen (offsetParent is null while
    // the panel is inactive or the sidebar is closed) — otherwise we'd rebuild
    // hidden DOM every 30s for timestamps no one can see.
    setInterval(() => {
      if (state.monitor.entries.length && $('dt-mon-list') && $('dt-mon-list').offsetParent) renderMonitorList();
    }, 30000);
  }

  function getDefaultState() {
    return {
      enabled: Store.get('mon.enabled', false),
      methods: Store.get('mon.methods', ALL_METHODS),
      entries: Store.get('mon.entries', []),
      regex: '',
      search: '',
    };
  }

  const storageSyncHandlers = {
    'mon.enabled': () => { state.monitor.enabled = Store.get('mon.enabled', false); const el = $('dt-mon-enabled'); if (el) el.checked = state.monitor.enabled; renderMonitorList(); },
    'mon.methods': () => { state.monitor.methods = Store.get('mon.methods', ALL_METHODS); },
    'mon.entries': () => { state.monitor.entries = Store.get('mon.entries', []); renderMonitorList(); },
  };

  return {
    id: 'monitor',
    navLabel: 'Monitor',
    navIcon: 'activity',
    buildPanel: buildMonitorPanel,
    initPanel: initMonitorPanel,
    wantsCapture: shouldMonitor,
    onResponseCapture: monitorCapture,
    getDefaultState,
    storageSyncHandlers,
  };
});
