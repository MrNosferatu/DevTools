// ==UserScript==
// @name         DevTools Sidebar — Bench Plugin
// @namespace    http://tampermonkey.net/
// @version      3.6.5
// @description  Bench plugin for DevTools Sidebar — manual or captured request benchmarking with concurrency, warmup, and a results sparkline.
// @author       MrNosferatu
// ==/UserScript==

// Registers a factory rather than running immediately — see Devtools_plugins.js.
DT_registerPlugin(function createBenchPlugin(ctx) {
  const { Store, state, $, $$, escHtml, ALL_METHODS, METHOD_COLORS, getFetch } = ctx;

  // ─── Bench panel HTML ──────────────────────────────────────────────────────────
  function buildBenchPanel() {
    return `
      <!-- Mode selector: Off / Manual / Capture -->
      <div class="dt-section">
        <div class="dt-slabel">Mode</div>
        <div class="dt-mode-group" style="margin-top:0">
          <button class="dt-mode-btn active" id="dt-bench-mode-off">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.6" style="vertical-align:middle;margin-right:4px"><circle cx="5.5" cy="5.5" r="4.5"/><line x1="3.3" y1="3.3" x2="7.7" y2="7.7"/></svg>Off
          </button>
          <button class="dt-mode-btn" id="dt-bench-mode-manual">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.6" style="vertical-align:middle;margin-right:4px"><path d="M2 2h7M2 5.5h5M2 9h6"/></svg>Manual
          </button>
          <button class="dt-mode-btn" id="dt-bench-mode-capture">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.6" style="vertical-align:middle;margin-right:4px"><circle cx="5.5" cy="5.5" r="4"/><circle cx="5.5" cy="5.5" r="1.5" fill="currentColor" stroke="none"/></svg>Capture
          </button>
        </div>
      </div>

      <!-- Manual URL input -->
      <div class="dt-section" id="dt-bench-manual-section" style="display:none">
        <div class="dt-slabel">Request</div>

        <!-- cURL paste area -->
        <div id="dt-bench-curl-wrap" style="margin-bottom:10px">
          <div class="dt-flabel" style="margin-bottom:5px">
            Paste cURL
            <span style="font-weight:400;color:var(--mu);margin-left:4px">— or fill the fields below</span>
          </div>
          <textarea class="dt-bench-body-ed" id="dt-bench-curl-input" spellcheck="false" rows="2"
            placeholder="curl 'https://api.example.com/data' -H 'Authorization: Bearer token' -d '{}'"></textarea>
          <button class="dt-pe-add-pattern" id="dt-bench-curl-parse" style="margin-top:6px">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="2,3 5.5,6.5 9,3"/><line x1="5.5" y1="6.5" x2="5.5" y2="1"/><line x1="1" y1="9" x2="10" y2="9"/></svg>
            Parse cURL into fields
          </button>
        </div>

        <div style="display:flex;gap:6px;margin-bottom:10px">
          <select class="dt-bench-method-sel" id="dt-bench-method">
            ${['GET','POST','PUT','PATCH','DELETE'].map(m=>`<option value="${m}">${m}</option>`).join('')}
          </select>
          <input class="dt-bench-url-input" id="dt-bench-url" type="text" placeholder="https://api.example.com/endpoint" spellcheck="false">
        </div>
        <div class="dt-flabel" style="margin-bottom:6px">Headers <span style="font-weight:400;color:var(--mu)">(optional)</span></div>
        <div class="dt-pe-patterns-list" id="dt-bench-headers-list"></div>
        <button class="dt-pe-add-pattern" id="dt-bench-add-header">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="5.5" y1="1" x2="5.5" y2="10"/><line x1="1" y1="5.5" x2="10" y2="5.5"/></svg>
          Add header
        </button>
        <div id="dt-bench-body-wrap" style="display:none;margin-top:12px">
          <div class="dt-flabel" style="margin-bottom:6px">Body</div>
          <textarea class="dt-bench-body-ed" id="dt-bench-body" spellcheck="false" placeholder='{"key": "value"}'></textarea>
        </div>
      </div>

      <!-- Capture mode -->
      <div class="dt-section" id="dt-bench-capture-section" style="display:none">
        <div id="dt-bench-cap-persist-row" class="dt-row" style="margin-bottom:12px">
          <div class="dt-row-info">
            <div class="dt-row-label">Persist</div>
            <div class="dt-row-sub">Keep capture mode enabled across reloads</div>
          </div>
          <label class="dt-toggle"><input type="checkbox" id="dt-bench-cap-persist"><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
        </div>
        <div class="dt-flabel" style="margin-bottom:6px">Capture Methods</div>
        <div class="dt-method-grid" style="margin-bottom:12px">${ALL_METHODS.map(m=>`<input type="checkbox" class="dt-method-check" id="dt-bench-cap-m-${m}" data-m="${m}" checked><label class="dt-method-pill" for="dt-bench-cap-m-${m}">${m}</label>`).join('')}</div>
        <div class="dt-flabel" style="margin-bottom:4px">URL Filter</div>
        <div class="dt-mode-group" style="margin-bottom:8px">
          <button class="dt-mode-btn active" data-mode="auto" data-ns="bench-cap">Auto — All</button>
          <button class="dt-mode-btn" data-mode="manual" data-ns="bench-cap">Manual — Regex</button>
        </div>
        <div class="dt-regex-wrap" id="dt-bench-cap-rwrap">
          <div class="dt-regex-field">
            <span class="dt-regex-delim">/</span>
            <input class="dt-regex-input" id="dt-bench-cap-regex" type="text" placeholder="api\\/v\\d+\\/.*" spellcheck="false">
            <span class="dt-regex-delim">/</span>
            <div class="dt-regex-dot" id="dt-bench-cap-rdot"></div>
          </div>
        </div>
        <div class="dt-bench-capture-list" id="dt-bench-capture-list" style="margin-top:10px">
          <div class="dt-bench-capture-empty" id="dt-bench-capture-empty">Enable capture, then browse the page — requests will appear here.</div>
        </div>
      </div>

      <!-- Selected request preview (shared between modes) -->
      <div class="dt-section" id="dt-bench-selected-section" style="display:none">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div class="dt-slabel" style="margin-bottom:0">Selected Request</div>
          <button class="dt-bench-clear-sel" id="dt-bench-clear-sel">Clear</button>
        </div>
        <div class="dt-bench-sel-pill" id="dt-bench-sel-pill"></div>
      </div>

      <!-- Run config -->
      <div class="dt-section" id="dt-bench-config-section">
        <div class="dt-slabel">Run Config</div>
        <div class="dt-bench-config-grid">
          <div class="dt-bench-config-item">
            <div class="dt-flabel">Iterations</div>
            <input class="dt-bench-num-input" id="dt-bench-iters" type="number" min="1" max="500" value="10">
          </div>
          <div class="dt-bench-config-item">
            <div class="dt-flabel">Concurrency</div>
            <input class="dt-bench-num-input" id="dt-bench-concurrency" type="number" min="1" max="20" value="1">
          </div>
          <div class="dt-bench-config-item">
            <div class="dt-flabel">Delay (ms)</div>
            <input class="dt-bench-num-input" id="dt-bench-delay" type="number" min="0" max="5000" value="0">
          </div>
          <div class="dt-bench-config-item">
            <div class="dt-flabel">Warmup</div>
            <label class="dt-toggle" style="margin-top:4px"><input type="checkbox" id="dt-bench-warmup" checked><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
          </div>
        </div>
        <button class="dt-bench-run-btn" id="dt-bench-run">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><polygon points="2,1 11,6 2,11"/></svg>
          Run Benchmark
        </button>
      </div>

      <!-- Results -->
      <div class="dt-section" id="dt-bench-results-section" style="display:none">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div class="dt-slabel" style="margin-bottom:0">Results</div>
          <div style="display:flex;gap:6px">
            <button class="dt-bench-copy-btn" id="dt-bench-copy-results">Copy</button>
            <button class="dt-bench-copy-btn dt-bench-clear-results-btn" id="dt-bench-clear-results">Clear</button>
          </div>
        </div>

        <!-- Last result accordion — sits at top, expands downward -->
        <div class="dt-bench-accordion" id="dt-bench-last-result" style="display:none;margin-bottom:12px">
          <button class="dt-bench-accordion-hd" id="dt-bench-last-result-toggle">
            <span class="dt-bench-accordion-label">Last Request</span>
            <span class="dt-bench-accordion-pill" id="dt-bench-last-result-pill"></span>
            <svg class="dt-bench-accordion-arrow" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="2,3.5 5,6.5 8,3.5"/></svg>
          </button>
          <div class="dt-bench-accordion-body" id="dt-bench-last-result-body" style="display:none">
            <div class="dt-bench-accordion-row" id="dt-bench-last-url-row">
              <div class="dt-bench-accordion-key">URL</div>
              <div class="dt-bench-accordion-val" id="dt-bench-last-url"></div>
            </div>
            <div class="dt-bench-accordion-row" id="dt-bench-last-params-row" style="display:none">
              <div class="dt-bench-accordion-key">Params</div>
              <div class="dt-bench-accordion-val" id="dt-bench-last-params"></div>
            </div>
            <div class="dt-bench-accordion-row" id="dt-bench-last-headers-row" style="display:none">
              <div class="dt-bench-accordion-key">Headers</div>
              <div class="dt-bench-accordion-val" id="dt-bench-last-headers"></div>
            </div>
            <div class="dt-bench-accordion-row" id="dt-bench-last-body-row" style="display:none">
              <div class="dt-bench-accordion-key">Body</div>
              <div class="dt-bench-accordion-val" id="dt-bench-last-body"></div>
            </div>
          </div>
        </div>

        <div class="dt-bench-progress" id="dt-bench-progress" style="display:none">
          <div class="dt-bench-progress-bar"><div class="dt-bench-progress-fill" id="dt-bench-progress-fill"></div></div>
          <div class="dt-bench-progress-label" id="dt-bench-progress-label">Running…</div>
        </div>
        <div class="dt-bench-stats" id="dt-bench-stats"></div>
        <canvas class="dt-bench-chart" id="dt-bench-chart" height="54"></canvas>
        <div class="dt-bench-run-list" id="dt-bench-run-list"></div>
      </div>
    `;
  }

  // ─── Benchmark ───────────────────────────────────────────────────────────────
  // NB: the panel's UI mode lives in bench.uiMode ('off'|'manual'|'capture').
  // Don't confuse it with state.bench.mode, which is the capture URL FILTER
  // mode ('auto'|'manual') — an earlier `bench.mode` field shadowed that name
  // and broke the manual-sync guard below.
  const bench = {
    uiMode: 'off',
    capturing: false,
    captured: [],
    selected: null,
    running: false,
    abortFlag: false,
  };

  function shouldBenchCapture(url, method) {
    if (!bench.capturing) return false;
    if (!state.bench.methods.includes(method.toUpperCase())) return false;
    if (state.bench.mode === 'manual' && state.bench.urlRegex) {
      try { return new RegExp(state.bench.urlRegex).test(url); } catch { return false; }
    }
    return true;
  }

  function bindBench() {
    $('dt-bench-mode-off').addEventListener('click',     () => setBenchMode('off'));
    $('dt-bench-mode-manual').addEventListener('click',  () => setBenchMode('manual'));
    $('dt-bench-mode-capture').addEventListener('click', () => setBenchMode('capture'));

    // Persist: stores whether capture mode should be re-enabled across reloads
    const capPersistEl = $('dt-bench-cap-persist');
    if (capPersistEl) {
      capPersistEl.checked = Store.get('bench.capPersist', false);
      capPersistEl.addEventListener('change', e => {
        Store.set('bench.capPersist', e.target.checked);
      });
    }

    // Always apply an initial mode — previously setBenchMode was only called
    // when capture-persist was on, leaving the Run Config section enabled (and
    // bench.uiMode undefined) while the UI showed "Off" as active.
    setBenchMode(Store.get('bench.capPersist', false) ? 'capture' : 'off');

    // ── cURL paste parser ─────────────────────────────────────────────────────
    $('dt-bench-curl-parse').addEventListener('click', () => {
      const raw = ($('dt-bench-curl-input').value || '').trim();
      if (!raw) return;
      try {
        const parsed = parseCurlCommand(raw);
        $('dt-bench-url').value = parsed.url;
        $('dt-bench-method').value = parsed.method;
        // Clear header rows and repopulate
        const list = $('dt-bench-headers-list');
        list.innerHTML = '';
        Object.entries(parsed.headers).forEach(([k, v]) => addBenchHeaderRow(k, v));
        if (!list.querySelector('.dt-pe-pattern-row')) addBenchHeaderRow('Content-Type', 'application/json');
        if (parsed.body) {
          $('dt-bench-body').value = parsed.body;
          $('dt-bench-body-wrap').style.display = '';
        }
        $('dt-bench-curl-input').value = '';
        syncManualSelected();
      } catch(e) {
        alert('Could not parse cURL command: ' + e.message);
      }
    });

    // Capture filter: methods
    ALL_METHODS.forEach(m => {
      const el = $(`dt-bench-cap-m-${m}`);
      if (!el) return;
      el.addEventListener('change', () => {
        state.bench.methods = ALL_METHODS.filter(x => $(`dt-bench-cap-m-${x}`).checked);
        Store.set('bench.methods', state.bench.methods);
      });
      el.checked = state.bench.methods.includes(m);
    });

    // Capture filter: URL mode
    $$('.dt-mode-btn[data-ns="bench-cap"]').forEach(btn => btn.addEventListener('click', () => {
      $$('.dt-mode-btn[data-ns="bench-cap"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.bench.mode = btn.dataset.mode;
      Store.set('bench.mode', state.bench.mode);
      const rw = $('dt-bench-cap-rwrap'); if(rw) rw.classList.toggle('visible', state.bench.mode === 'manual');
    }));

    $('dt-bench-cap-regex').addEventListener('input', e => {
      // Keep even invalid patterns in state — clearing to '' meant "capture
      // ALL" while mid-typing; shouldBenchCapture's try/catch already treats an
      // unparseable pattern as match-nothing, which is the safe behavior.
      const val = e.target.value.trim(), dot = $('dt-bench-cap-rdot');
      state.bench.urlRegex = val;
      if (!val) dot.className = 'dt-regex-dot';
      else { try { new RegExp(val); dot.className = 'dt-regex-dot valid'; } catch { dot.className = 'dt-regex-dot invalid'; } }
      Store.setSoon('bench.urlRegex', state.bench.urlRegex);
    });

    $('dt-bench-add-header').addEventListener('click', () => addBenchHeaderRow('', ''));

    $('dt-bench-method').addEventListener('change', () => {
      $('dt-bench-body-wrap').style.display = $('dt-bench-method').value === 'GET' ? 'none' : '';
      syncManualSelected();
    });

    $('dt-bench-url').addEventListener('input', syncManualSelected);
    $('dt-bench-clear-sel').addEventListener('click', () => { bench.selected = null; renderBenchSelected(); });
    $('dt-bench-run').addEventListener('click', () => { if (bench.running) { bench.abortFlag = true; return; } runBenchmark(); });
    $('dt-bench-copy-results').addEventListener('click', copyBenchResults);
    $('dt-bench-clear-results').addEventListener('click', () => {
      $('dt-bench-stats').innerHTML = '';
      $('dt-bench-run-list').innerHTML = '';
      $('dt-bench-last-result').style.display = 'none';
      const canvas = $('dt-bench-chart');
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      $('dt-bench-results-section').style.display = 'none';
      Store.set('bench.lastResult', null);
    });

    addBenchHeaderRow('Content-Type', 'application/json');

    // Restore bench capture filter mode UI
    if (state.bench.mode === 'manual') {
      $$('.dt-mode-btn[data-ns="bench-cap"]').forEach(b => b.classList.toggle('active', b.dataset.mode === 'manual'));
      const rw = $('dt-bench-cap-rwrap'); if(rw) rw.classList.add('visible');
      const ri = $('dt-bench-cap-regex'); if(ri && state.bench.urlRegex) ri.value = state.bench.urlRegex;
    }

    // Restore last benchmark result
    const savedLast = Store.get('bench.lastResult', null);
    if (savedLast && savedLast.request && Array.isArray(savedLast.results) && savedLast.results.length) {
      $('dt-bench-results-section').style.display = '';
      renderLastResultAccordion(savedLast);
      renderBenchStats(savedLast.results);
      savedLast.results.forEach((r, i) => appendRunRow(i + 1, r));
      // Redraw sparkline after a frame so canvas has layout dimensions
      requestAnimationFrame(() => drawSparkline(savedLast.results.map(r => r.time)));
    }
  }

  // Parse a cURL command string into { url, method, headers, body }
  function parseCurlCommand(raw) {
    // Normalize line continuations and whitespace
    const cmd = raw.replace(/\\\s*\n/g, ' ').trim();
    // Extract URL — first bare string after 'curl' that looks like a URL (or is quoted)
    const urlMatch = cmd.match(/curl\s+(?:[^\s]*\s+)*?'([^']+)'|curl\s+(?:[^\s]*\s+)*?"([^"]+)"|curl\s+(?:[^\s]*\s+)*?(\S+)/);
    let url = urlMatch ? (urlMatch[1] || urlMatch[2] || urlMatch[3]) : '';
    // Strip leading/trailing quotes from url
    url = url.replace(/^['"]|['"]$/g, '');

    let method = 'GET';
    const methodMatch = cmd.match(/-X\s+['"]?([A-Z]+)['"]?/);
    if (methodMatch) method = methodMatch[1];

    const headers = {};
    const headerRegex = /-H\s+['"]([^'"]+)['"]/g;
    let hm;
    while ((hm = headerRegex.exec(cmd)) !== null) {
      const colonIdx = hm[1].indexOf(':');
      if (colonIdx > 0) {
        const k = hm[1].slice(0, colonIdx).trim();
        const v = hm[1].slice(colonIdx + 1).trim();
        headers[k] = v;
      }
    }

    let body = '';
    const bodyMatch = cmd.match(/(?:--data(?:-raw|-binary)?|-d)\s+['"]((?:[^'"\\]|\\.)*)['"]/)
                   || cmd.match(/(?:--data(?:-raw|-binary)?|-d)\s+(\S+)/);
    if (bodyMatch) {
      body = bodyMatch[1].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      if (method === 'GET') method = 'POST';
    }

    if (!url) throw new Error('No URL found');
    return { url, method, headers, body };
  }

  function setBenchMode(mode) {
    bench.uiMode = mode;
    $('dt-bench-mode-off').classList.toggle('active',     mode === 'off');
    $('dt-bench-mode-manual').classList.toggle('active',  mode === 'manual');
    $('dt-bench-mode-capture').classList.toggle('active', mode === 'capture');
    $('dt-bench-manual-section').style.display    = mode === 'manual'  ? '' : 'none';
    $('dt-bench-capture-section').style.display   = mode === 'capture' ? '' : 'none';
    const configSec = $('dt-bench-config-section');
    if (configSec) configSec.classList.toggle('dt-row-disabled', mode === 'off');
    if (mode === 'manual') syncManualSelected();
    // Capture mode: automatically active when selected
    if (mode === 'capture') {
      bench.capturing = true;
    } else {
      bench.capturing = false;
    }
  }

  function addBenchHeaderRow(k, v) {
    const list = $('dt-bench-headers-list');
    const row = document.createElement('div');
    row.className = 'dt-pe-pattern-row';
    row.innerHTML = `
      <input class="dt-regex-input" style="flex:1" placeholder="Header name" spellcheck="false" value="${escHtml(k)}">
      <input class="dt-regex-input" style="flex:2" placeholder="Value" spellcheck="false" value="${escHtml(v)}">
      <button class="dt-pe-pattern-remove" title="Remove">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg>
      </button>
    `;
    row.querySelector('.dt-pe-pattern-remove').addEventListener('click', () => {
      if (list.querySelectorAll('.dt-pe-pattern-row').length > 1) row.remove();
    });
    list.appendChild(row);
  }

  function collectBenchHeaders() {
    const headers = {};
    $('dt-bench-headers-list').querySelectorAll('.dt-pe-pattern-row').forEach(row => {
      const [ki, vi] = row.querySelectorAll('input');
      const k = ki?.value.trim(), v = vi?.value ?? '';
      if (k) headers[k] = v;
    });
    return headers;
  }

  function syncManualSelected() {
    if (bench.uiMode !== 'manual') return;
    const url = $('dt-bench-url').value.trim();
    const method = $('dt-bench-method').value;
    if (!url) { bench.selected = null; }
    else {
      bench.selected = {
        url, method,
        headers: collectBenchHeaders(),
        body: method === 'GET' ? '' : $('dt-bench-body').value,
      };
    }
    renderBenchSelected();
  }

  function renderBenchSelected() {
    const sec = $('dt-bench-selected-section');
    const pill = $('dt-bench-sel-pill');
    if (!bench.selected) { sec.style.display = 'none'; return; }
    sec.style.display = '';
    const color = METHOD_COLORS[bench.selected.method] || '#555';
    pill.innerHTML = `
      <span class="dt-bench-sel-method" style="background:${color}">${escHtml(bench.selected.method)}</span>
      <span class="dt-bench-sel-url" title="${escHtml(bench.selected.url)}">${escHtml(bench.selected.url)}</span>
    `;
  }

  // ── Capture integration — hooked from fetch/XHR patch via wantsCapture/onResponseCapture.
  // statusText/resHeaders/resBody/duration aren't used (bench only cares about
  // the REQUEST shape, to let you replay it), but the capture hook signature
  // is shared across plugins — see the generic dispatch in Devtools.js.
  function benchCapture(url, method, reqHeaders, reqBody, status) {
    const key = method + '|' + url;
    bench.captured = bench.captured.filter(c => c.method + '|' + c.url !== key);
    bench.captured.unshift({ url, method, headers: { ...reqHeaders }, body: reqBody || '', status, ts: Date.now() });
    if (bench.captured.length > 40) bench.captured.pop();
    renderCaptureList();
  }

  function renderCaptureList() {
    const list = $('dt-bench-capture-list');
    if (!list) return;
    const empty = $('dt-bench-capture-empty');
    if (!bench.captured.length) { if(empty) empty.style.display = ''; return; }
    if(empty) empty.style.display = 'none';
    // Rebuild items keeping the empty node
    [...list.querySelectorAll('.dt-bench-capture-item')].forEach(el => el.remove());
    bench.captured.forEach((c, i) => {
      const item = document.createElement('div');
      item.className = 'dt-bench-capture-item' + (bench.selected && bench.selected.url === c.url && bench.selected.method === c.method ? ' selected' : '');
      const color = METHOD_COLORS[c.method] || '#555';
      const shortUrl = (() => { try { const u = new URL(c.url); return u.pathname + (u.search.length > 20 ? u.search.slice(0,20)+'…' : u.search); } catch { return c.url; } })();
      item.innerHTML = `
        <span class="dt-bench-capture-method" style="background:${color}">${escHtml(c.method)}</span>
        <span class="dt-bench-capture-url" title="${escHtml(c.url)}">${escHtml(shortUrl)}</span>
        ${c.status ? `<span class="dt-bench-capture-status">${c.status}</span>` : ''}
      `;
      item.addEventListener('click', () => {
        bench.selected = { url: c.url, method: c.method, headers: { ...c.headers }, body: c.body };
        list.querySelectorAll('.dt-bench-capture-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        renderBenchSelected();
      });
      // bench.captured is already newest-first (unshift) — appending preserves
      // that. The previous insertBefore(firstChild) re-reversed it, showing the
      // OLDEST request at the top.
      list.appendChild(item);
    });
  }

  async function runBenchmark() {
    if (bench.uiMode === 'off') return;
    if (!bench.selected) {
      // Try to sync from manual fields first
      syncManualSelected();
      if (!bench.selected) { alert('Select or enter a request first.'); return; }
    }

    // Show pending state immediately
    const runBtn = $('dt-bench-run');
    runBtn.classList.add('pending');
    runBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" style="animation:dt-spin .7s linear infinite"><path d="M7 1.5A5.5 5.5 0 1 1 1.5 7"/></svg> Preparing…`;
    // Yield to let the UI paint before proceeding
    await new Promise(r => setTimeout(r, 0));
    const iters     = Math.max(1, Math.min(500, parseInt($('dt-bench-iters').value)    || 10));
    const concurr   = Math.max(1, Math.min(20,  parseInt($('dt-bench-concurrency').value) || 1));
    const delay     = Math.max(0,               parseInt($('dt-bench-delay').value)    || 0);
    const warmup    = $('dt-bench-warmup').checked;
    const { url, method, headers, body } = bench.selected;

    bench.running = true;
    bench.abortFlag = false;
    runBtn.classList.remove('pending');
    runBtn.classList.add('running');
    runBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1.5" y="1.5" width="3" height="7"/><rect x="5.5" y="1.5" width="3" height="7"/></svg> Stop`;
    $('dt-bench-results-section').style.display = '';
    $('dt-bench-progress').style.display = '';
    const pf=$('dt-bench-progress-fill'); if(pf) pf.style.width='0%';
    $('dt-bench-stats').innerHTML = '';
    $('dt-bench-run-list').innerHTML = '';
    const canvas = $('dt-bench-chart');
    const canvasCtx = canvas.getContext('2d');
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

    const results = []; // { time, ok, status }
    let done = 0;
    const total = iters + (warmup ? 1 : 0);
    const nativeFetch = getFetch();

    const doOne = async () => {
      const t0 = performance.now();
      try {
        const res = await nativeFetch(url, {
          method,
          headers,
          body: method === 'GET' ? undefined : (body || undefined),
          credentials: 'include',
        });
        // Consume the body so timing includes full download (matches browser Network tab)
        await res.arrayBuffer();
        const t1 = performance.now();
        return { time: t1 - t0, ok: res.ok, status: res.status };
      } catch(e) {
        return { time: performance.now() - t0, ok: false, status: 0, err: e.message };
      }
    };

    // Warmup (not counted)
    if (warmup) {
      setProgress(0, total, 'Warming up…');
      await doOne();
      done = 1;
    }

    // Batched concurrency
    let idx = 0;
    while (idx < iters && !bench.abortFlag) {
      const batch = [];
      for (let b = 0; b < concurr && idx + b < iters; b++) batch.push(doOne());
      const batchResults = await Promise.all(batch);
      for (const r of batchResults) {
        results.push(r);
        done++;
        setProgress(done, total, `Run ${results.length} / ${iters} · ${r.time.toFixed(0)}ms`);
        appendRunRow(results.length, r);
      }
      idx += concurr;
      if (delay > 0 && idx < iters && !bench.abortFlag) await new Promise(res => setTimeout(res, delay));
    }

    bench.running = false;
    bench.abortFlag = false;
    runBtn.classList.remove('running');
    runBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><polygon points="2,1 11,6 2,11"/></svg> Run Benchmark`;
    $('dt-bench-progress').style.display = 'none';

    if (results.length) {
      renderBenchStats(results);
      // Save last result + request for accordion
      bench.lastResult = { request: { ...bench.selected }, results };
      renderLastResultAccordion(bench.lastResult);
    }
  }

  function setProgress(done, total, label) {
    const pct = Math.round((done / total) * 100);
    const fill = $('dt-bench-progress-fill');
    if (fill) fill.style.width = pct + '%';
    $('dt-bench-progress-label').textContent = label;
  }

  function appendRunRow(n, r) {
    const list = $('dt-bench-run-list');
    const row = document.createElement('div');
    row.className = 'dt-bench-run-row';
    const color = r.time < 200 ? 'var(--gn)' : r.time < 800 ? 'var(--am)' : 'var(--rd)';
    row.innerHTML = `
      <span class="dt-bench-run-num">#${n}</span>
      <span class="dt-bench-run-time" style="color:${color}">${r.time.toFixed(1)}ms</span>
      <span class="dt-bench-run-status ${r.ok ? 'ok' : 'err'}">${r.status || 'ERR'}</span>
    `;
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
  }

  function renderBenchStats(results) {
    const times = results.map(r => r.time).sort((a, b) => a - b);
    const ok = results.filter(r => r.ok).length;
    const avg = times.reduce((s, t) => s + t, 0) / times.length;
    const min = times[0], max = times[times.length - 1];
    const p95 = times[Math.floor(times.length * 0.95)] ?? max;
    const p50 = times[Math.floor(times.length * 0.5)] ?? avg;
    const successRate = Math.round((ok / results.length) * 100);

    const rateColor = successRate === 100 ? 'good' : successRate >= 80 ? 'warn' : 'bad';
    const avgColor  = avg < 200 ? 'good' : avg < 800 ? 'warn' : 'bad';

    $('dt-bench-stats').innerHTML = `
      <div class="dt-bench-stat"><div class="dt-bench-stat-val ${avgColor}">${avg.toFixed(0)}<span style="font-size:11px">ms</span></div><div class="dt-bench-stat-lbl">Average</div></div>
      <div class="dt-bench-stat"><div class="dt-bench-stat-val">${min.toFixed(0)}<span style="font-size:11px">ms</span></div><div class="dt-bench-stat-lbl">Min</div></div>
      <div class="dt-bench-stat"><div class="dt-bench-stat-val">${max.toFixed(0)}<span style="font-size:11px">ms</span></div><div class="dt-bench-stat-lbl">Max</div></div>
      <div class="dt-bench-stat"><div class="dt-bench-stat-val">${p50.toFixed(0)}<span style="font-size:11px">ms</span></div><div class="dt-bench-stat-lbl">p50</div></div>
      <div class="dt-bench-stat"><div class="dt-bench-stat-val">${p95.toFixed(0)}<span style="font-size:11px">ms</span></div><div class="dt-bench-stat-lbl">p95</div></div>
      <div class="dt-bench-stat"><div class="dt-bench-stat-val ${rateColor}">${successRate}%</div><div class="dt-bench-stat-lbl">Success</div></div>
    `;

    // Sparkline
    drawSparkline(results.map(r => r.time));
  }

  function drawSparkline(times) {
    const canvas = $('dt-bench-chart');
    const W = canvas.offsetWidth || 300;
    canvas.width = W;
    const H = 54;
    const canvasCtx = canvas.getContext('2d');
    canvasCtx.clearRect(0, 0, W, H);

    const pad = 6;
    const min = Math.min(...times), max = Math.max(...times);
    const range = max - min || 1;
    const toY = t => pad + (H - pad * 2) * (1 - (t - min) / range);
    const toX = i => pad + (W - pad * 2) * (i / (times.length - 1 || 1));

    // Grid lines
    canvasCtx.strokeStyle = 'rgba(128,128,128,.12)';
    canvasCtx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach(f => {
      const y = pad + (H - pad * 2) * f;
      canvasCtx.beginPath(); canvasCtx.moveTo(pad, y); canvasCtx.lineTo(W - pad, y); canvasCtx.stroke();
    });

    // Fill area
    const grad = canvasCtx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(37,99,235,.25)');
    grad.addColorStop(1, 'rgba(37,99,235,.02)');
    canvasCtx.beginPath();
    canvasCtx.moveTo(toX(0), toY(times[0]));
    times.forEach((t, i) => { if (i > 0) canvasCtx.lineTo(toX(i), toY(t)); });
    canvasCtx.lineTo(toX(times.length - 1), H); canvasCtx.lineTo(toX(0), H); canvasCtx.closePath();
    canvasCtx.fillStyle = grad; canvasCtx.fill();

    // Line
    canvasCtx.beginPath();
    canvasCtx.strokeStyle = '#2563eb';
    canvasCtx.lineWidth = 1.8;
    canvasCtx.lineJoin = 'round';
    times.forEach((t, i) => { i === 0 ? canvasCtx.moveTo(toX(i), toY(t)) : canvasCtx.lineTo(toX(i), toY(t)); });
    canvasCtx.stroke();

    // Dots for slow outliers
    times.forEach((t, i) => {
      if (t > (Math.min(...times) + range * 0.7)) {
        canvasCtx.beginPath();
        canvasCtx.arc(toX(i), toY(t), 3, 0, Math.PI * 2);
        canvasCtx.fillStyle = '#dc2626'; canvasCtx.fill();
      }
    });
  }

  function renderLastResultAccordion(last) {
    const wrap = $('dt-bench-last-result');
    if (!wrap) return;
    const { request } = last;
    const color = METHOD_COLORS[request.method] || '#555';

    // Persist to store
    Store.set('bench.lastResult', last);

    // Pill: method + short URL
    const shortUrl = (() => { try { const u = new URL(request.url); return u.pathname + (u.search.length > 20 ? u.search.slice(0,20)+'…' : u.search); } catch { return request.url; } })();
    const pill = $('dt-bench-last-result-pill');
    if (pill) pill.innerHTML = `<span style="background:${color};color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;font-family:'IBM Plex Mono',monospace">${escHtml(request.method)}</span><span style="font-size:11px;color:var(--tx2);font-family:'IBM Plex Mono',monospace;margin-left:5px">${escHtml(shortUrl)}</span>`;

    // URL row
    const urlEl = $('dt-bench-last-url');
    if (urlEl) urlEl.textContent = request.url;

    // Params row (from URL query string)
    const paramsRow = $('dt-bench-last-params-row');
    const paramsEl = $('dt-bench-last-params');
    try {
      const u = new URL(request.url);
      const params = [...u.searchParams.entries()];
      if (params.length && paramsRow && paramsEl) {
        paramsEl.innerHTML = params.map(([k,v]) => `<span style="color:var(--ac)">${escHtml(k)}</span><span style="color:var(--mu)">=</span>${escHtml(v)}`).join('<br>');
        paramsRow.style.display = '';
      } else if (paramsRow) { paramsRow.style.display = 'none'; }
    } catch { if (paramsRow) paramsRow.style.display = 'none'; }

    // Headers row
    const headersRow = $('dt-bench-last-headers-row');
    const headersEl = $('dt-bench-last-headers');
    const headerEntries = Object.entries(request.headers || {});
    if (headerEntries.length && headersRow && headersEl) {
      headersEl.innerHTML = headerEntries.map(([k,v]) => `<span style="color:var(--ac)">${escHtml(k)}</span><span style="color:var(--mu)">: </span>${escHtml(v)}`).join('<br>');
      headersRow.style.display = '';
    } else if (headersRow) { headersRow.style.display = 'none'; }

    // Body row
    const bodyRow = $('dt-bench-last-body-row');
    const bodyEl = $('dt-bench-last-body');
    if (request.body && bodyRow && bodyEl) {
      bodyEl.textContent = request.body;
      bodyRow.style.display = '';
    } else if (bodyRow) { bodyRow.style.display = 'none'; }

    wrap.style.display = '';

    // Accordion toggle (bind once)
    const toggle = $('dt-bench-last-result-toggle');
    if (toggle && !toggle._bound) {
      toggle._bound = true;
      toggle.addEventListener('click', () => {
        const body = $('dt-bench-last-result-body');
        const arrow = toggle.querySelector('.dt-bench-accordion-arrow');
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : '';
        if (arrow) arrow.style.transform = open ? '' : 'rotate(180deg)';
      });
    }
  }

  function copyBenchResults() {
    const rows = [...$('dt-bench-run-list').querySelectorAll('.dt-bench-run-row')];
    const lines = rows.map(r => {
      const num = r.querySelector('.dt-bench-run-num')?.textContent ?? '';
      const t = r.querySelector('.dt-bench-run-time')?.textContent ?? '';
      const s = r.querySelector('.dt-bench-run-status')?.textContent ?? '';
      return `${num}\t${t}\t${s}`;
    });
    const stats = [...$('dt-bench-stats').querySelectorAll('.dt-bench-stat')].map(s => {
      return `${s.querySelector('.dt-bench-stat-lbl')?.textContent}: ${s.querySelector('.dt-bench-stat-val')?.textContent}`;
    });
    const text = [
      `URL: ${bench.selected?.url ?? '—'}`,
      `Method: ${bench.selected?.method ?? '—'}`,
      '',
      stats.join('  |  '),
      '',
      lines.join('\n'),
    ].join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      const btn = $('dt-bench-copy-results');
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = orig, 1800);
    });
  }

  function getDefaultState() {
    return {
      captureEnabled: false,
      methods: Store.get('bench.methods', ALL_METHODS),
      mode:    Store.get('bench.mode', 'auto'),
      urlRegex: Store.get('bench.urlRegex', ''),
    };
  }

  const storageSyncHandlers = {
    'bench.methods':  () => { state.bench.methods = Store.get('bench.methods', ALL_METHODS); },
    'bench.mode':     () => { state.bench.mode = Store.get('bench.mode', 'auto'); },
    'bench.urlRegex': () => { state.bench.urlRegex = Store.get('bench.urlRegex', ''); },
  };

  return {
    id: 'bench',
    navLabel: 'Bench',
    navIcon: 'gauge',
    buildPanel: buildBenchPanel,
    initPanel: bindBench,
    wantsCapture: shouldBenchCapture,
    onResponseCapture: benchCapture,
    // Never let the core request/response interceptors edit or queue the
    // benchmark's own fetch calls while a run is in flight.
    suppressIntercept: () => bench.running,
    getDefaultState,
    storageSyncHandlers,
  };
});
