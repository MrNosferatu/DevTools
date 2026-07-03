// ==UserScript==
// @name         DevTools Sidebar
// @namespace    http://tampermonkey.net/
// @version      10.2.5
// @description  Some tools for web development
// @author       MrNosferatu
// @match        http://*/*
// @match        https://*/*
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @run-at       document-start
// @require http://127.0.0.1:8421/Devtools_constants.js
// @require http://127.0.0.1:8421/Devtools_plugins.js
// @require http://127.0.0.1:8421/Devtools_css.js
// @require http://127.0.0.1:8421/Devtools_html.js
// @require http://127.0.0.1:8421/Devtools_recorder.js
// @require http://127.0.0.1:8421/Devtools_monitor.js
// @require http://127.0.0.1:8421/Devtools_baseurl.js
// @require http://127.0.0.1:8421/Devtools_bench.js
// ==/UserScript==

(function () {
  'use strict';

  // Run ONLY in the top-level document. `@match http(s)://*/*` also matches every
  // same-scheme iframe on a page (reCAPTCHA widgets, some embedded video players,
  // ad/analytics frames, …), so without this each of those frames would run the
  // script and inject its own duplicate sidebar/tab — exactly the "multiple
  // sidebars" seen on captchas and certain players. `@noframes` in the metadata
  // stops compliant managers from running us in frames at all; this is the
  // runtime backstop for the rest, and also avoids needlessly patching fetch/XHR
  // inside subframes (there's no UI there to service an intercept anyway).
  // Comparing the window *references* is safe cross-origin (no property access).
  if (window.top !== window.self) return;

  // Some userscript managers (Tampermonkey/Violentmonkey, depending on their
  // Sandbox Mode setting) run this script in an isolated JS realm where `window`
  // is a wrapper, not the page's real global object. Mutating a shared prototype
  // (XMLHttpRequest.prototype.send, etc.) still reaches the page either way, but
  // assigning a plain property like `window.fetch = ...` does NOT — it only
  // shadows fetch inside our own sandbox, leaving the page's real fetch calls
  // completely unpatched and invisible to us. `unsafeWindow` (when available) is
  // the actual page window and is required to patch fetch reliably.
  const realWindow = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

  // ─── Store ────────────────────────────────────────────────────────────────────
  const Store = {
    get(k, fb) { try { return GM_getValue(k, fb); } catch { try { const v = localStorage.getItem('__dt_'+k); return v===null?fb:JSON.parse(v); } catch { return fb; } } },
    set(k, v)  { try { GM_setValue(k, v); } catch { try { localStorage.setItem('__dt_'+k, JSON.stringify(v)); } catch {} } },
    // Debounced write, keyed by storage key. GM_setValue serializes the value and
    // writes to backing storage synchronously (notably slow in Firefox), so doing
    // it on every keystroke of a text field floods the main thread and drops
    // characters. This coalesces bursts to a single write ~300ms after the last
    // change. Only for values where a brief persistence delay is harmless (live
    // text/color editing); use set() directly when the write must be immediate.
    _t: {},
    setSoon(k, v, ms) { clearTimeout(this._t[k]); this._t[k] = setTimeout(() => { this._t[k] = null; this.set(k, v); }, ms || 300); }
  };

  // ─── State ────────────────────────────────────────────────────────────────────
  const state = {
    sidebarOpen: false,
    req: {
      enabled:  Store.get('req.enabled', false),
      persist:  Store.get('req.persist', false),
      mode:     Store.get('req.mode', 'auto'),
      urlRegex: Store.get('req.urlRegex', ''),
      methods:  Store.get('req.methods', ['POST','PUT','PATCH']),
    },
    res: {
      enabled:       Store.get('res.enabled', false),
      persist:       Store.get('res.persist', false),
      mode:          Store.get('res.mode', 'auto'),
      urlRegex:      Store.get('res.urlRegex', ''),
      methods:       Store.get('res.methods', ['GET','POST','PUT','PATCH','DELETE']),
      autoTransform: Store.get('res.autoTransform', false),
    },
    editorSettings: {
      theme:      Store.get('ed.theme', 'catppuccin'),
      font:       Store.get('ed.font', 'ibm'),
      fontSize:   Store.get('ed.fontSize', 12),
      customBg:   Store.get('ed.customBg', ''),
      customText: Store.get('ed.customText', ''),
    },
    layout: {
      side:       Store.get('layout.side', 'right'),
      width:      Store.get('layout.width', 360),
      appearance: Store.get('layout.appearance', 'light'), // 'light'|'dark'|'auto'|'custom'
      customBg:   Store.get('layout.customBg', ''),
      customSf:   Store.get('layout.customSf', ''),
      customTx:   Store.get('layout.customTx', ''),
      customBd:   Store.get('layout.customBd', ''),
    },
    resPresets: Store.get('res.presets', []),
    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    // Global hotkeys for quickly toggling interception without opening the
    // Network panel. Combos are stored as normalized strings (e.g. "Alt+Shift+I").
    // Defaults are a left-hand-only cluster (left Alt + Q/W/A/S) so every
    // shortcut can be triggered one-handed while the other hand stays on the
    // mouse. They avoid the browser's own Ctrl+Shift+I / Alt+D style shortcuts.
    keybinds: {
      toggleBoth:    Store.get('keybinds.toggleBoth',    'Alt+Q'),
      toggleReq:     Store.get('keybinds.toggleReq',     'Alt+W'),
      toggleRes:     Store.get('keybinds.toggleRes',     'Alt+A'),
      holdIntercept: Store.get('keybinds.holdIntercept', 'Alt+S'),
    },
    _captureKeybind: null, // set while the settings UI is recording a new combo
    reqSearch: { term:'', matchIndex:0, matches:[] },
    resSearch: { term:'', matchIndex:0, matches:[] },
    pendingReqs: [],
    pendingRes:  [],
    currentRes: null,
    // Per-plugin state (e.g. state.recorder, state.monitor, state.bench) is
    // filled in below, once plugin factories have run — see "Plugins" section.
  };
  if (!state.req.persist) state.req.enabled = false;
  if (!state.res.persist) state.res.enabled = false;

  // ─── Cross-tab settings sync ─────────────────────────────────────────────────
  // GM storage is shared across every tab running this script, but without this,
  // a change in one tab only updates that tab's in-memory `state` — other open
  // tabs keep showing stale values until reloaded. GM_addValueChangeListener
  // fires in ALL tabs (including the one that didn't make the change) whenever a
  // value changes; `remote === true` tells us it came from elsewhere, so we pull
  // the new value and refresh whatever UI depends on it. We skip remote===false
  // because that tab already updated its own state directly when it made the change.
  const STORAGE_SYNC_HANDLERS = {
    'req.enabled':  () => { state.req.enabled = Store.get('req.enabled', false); syncNetworkPanel(); },
    'req.persist':  () => { state.req.persist = Store.get('req.persist', false); syncNetworkPanel(); },
    'req.mode':     () => { state.req.mode = Store.get('req.mode', 'auto'); syncNetworkPanel(); },
    'req.urlRegex': () => { state.req.urlRegex = Store.get('req.urlRegex', ''); syncNetworkPanel(); },
    'req.methods':  () => { state.req.methods = Store.get('req.methods', ['POST','PUT','PATCH']); syncNetworkPanel(); },

    'res.enabled':  () => { state.res.enabled = Store.get('res.enabled', false); syncNetworkPanel(); },
    'res.persist':  () => { state.res.persist = Store.get('res.persist', false); syncNetworkPanel(); },
    'res.mode':     () => { state.res.mode = Store.get('res.mode', 'auto'); syncNetworkPanel(); },
    'res.urlRegex': () => { state.res.urlRegex = Store.get('res.urlRegex', ''); syncNetworkPanel(); },
    'res.methods':  () => { state.res.methods = Store.get('res.methods', ALL_METHODS); syncNetworkPanel(); },
    'res.autoTransform': () => { state.res.autoTransform = Store.get('res.autoTransform', false); syncAutoTransformUI(); },
    'res.presets':  () => { state.resPresets = Store.get('res.presets', []); renderPresetsList(); },

    'keybinds.toggleBoth': () => { state.keybinds.toggleBoth = Store.get('keybinds.toggleBoth', 'Alt+Q'); syncKeybindUI(); },
    'keybinds.toggleReq':  () => { state.keybinds.toggleReq  = Store.get('keybinds.toggleReq',  'Alt+W'); syncKeybindUI(); },
    'keybinds.toggleRes':  () => { state.keybinds.toggleRes  = Store.get('keybinds.toggleRes',  'Alt+A'); syncKeybindUI(); },
    'keybinds.holdIntercept': () => { state.keybinds.holdIntercept = Store.get('keybinds.holdIntercept', 'Alt+S'); syncKeybindUI(); },

    // Per-plugin storage-sync handlers (e.g. 'rec.*', 'mon.*', 'baseurl.*',
    // 'bench.*') are merged in below, once plugin factories have run.

    'layout.side':        () => { state.layout.side = Store.get('layout.side', 'right'); applyLayout(true); },
    'layout.width':       () => { state.layout.width = Store.get('layout.width', 360); applyLayout(true); },
    'layout.appearance':  () => { state.layout.appearance = Store.get('layout.appearance', 'light'); applySidebarTheme(); },
    'layout.customBg':    () => { state.layout.customBg = Store.get('layout.customBg', ''); applySidebarTheme(); },
    'layout.customSf':    () => { state.layout.customSf = Store.get('layout.customSf', ''); applySidebarTheme(); },
    'layout.customTx':    () => { state.layout.customTx = Store.get('layout.customTx', ''); applySidebarTheme(); },
    'layout.customBd':    () => { state.layout.customBd = Store.get('layout.customBd', ''); applySidebarTheme(); },

    'ed.theme':      () => { state.editorSettings.theme = Store.get('ed.theme', 'catppuccin'); applyEditorTheme(); },
    'ed.font':       () => { state.editorSettings.font = Store.get('ed.font', 'ibm'); applyEditorTheme(); },
    'ed.fontSize':   () => { state.editorSettings.fontSize = Store.get('ed.fontSize', 12); applyEditorTheme(); },
    'ed.customBg':   () => { state.editorSettings.customBg = Store.get('ed.customBg', ''); applyEditorTheme(); },
    'ed.customText': () => { state.editorSettings.customText = Store.get('ed.customText', ''); applyEditorTheme(); },
  };
  function initStorageSync() {
    if (typeof GM_addValueChangeListener !== 'function') return;
    Object.keys(STORAGE_SYNC_HANDLERS).forEach(key => {
      try {
        GM_addValueChangeListener(key, (name, oldVal, newVal, remote) => {
          if (!remote) return;
          try { STORAGE_SYNC_HANDLERS[name](); } catch (e) { console.warn('[DevTools] cross-tab sync failed for', name, e); }
        });
      } catch (e) { /* manager doesn't support it — sync just won't happen, no crash */ }
    });
  }
  // initStorageSync() is called further down, after plugins have merged their
  // own storage-sync handlers into STORAGE_SYNC_HANDLERS (see "Plugins" section).

  // Legacy Base URL group data migration (older versions stored one color per
  // group + an activeIdx + a regex matchPattern) now lives in the Base URL
  // plugin's getDefaultState — see Devtools_baseurl.js.

  // ─── DOM helper ───────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  // ─── Editor theme helpers ─────────────────────────────────────────────────────
  function getEditorTheme() {
    const key = state.editorSettings.theme;
    if (key === 'custom') {
      // Build a full theme from catppuccin as structural base, override bg/text only
      const base = { ...ED_THEMES.catppuccin };
      if (state.editorSettings.customBg)   base.bg   = state.editorSettings.customBg;
      if (state.editorSettings.customText) base.text = state.editorSettings.customText;
      return base;
    }
    const base = ED_THEMES[key] || ED_THEMES.catppuccin;
    const out = { ...base };
    // customBg/customText are only used in custom mode; named themes use their own colors
    return out;
  }
  function getEditorFont() {
    return (ED_FONTS.find(x => x.id === state.editorSettings.font) || ED_FONTS[0]).css;
  }

  // ─── Inject ───────────────────────────────────────────────────────────────────
  function inject() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.documentElement.appendChild(style);
    const wrap = document.createElement('div');
    const pluginNavHtml = plugins.map(p => p.navLabel
      ? `<button class="dt-nav-btn" data-panel="${p.id}">${escHtml(p.navLabel)}</button>` : '').join('');
    const pluginPanelHtml = plugins.map(p => p.buildPanel
      ? `<div class="dt-panel" id="dt-panel-${p.id}">${p.buildPanel()}</div>` : '').join('');
    wrap.innerHTML = HTML
      .replace('<!--dt-nav-plugins-->', pluginNavHtml)
      .replace('<!--dt-panel-plugins-->', pluginPanelHtml);
    while (wrap.firstChild) document.documentElement.appendChild(wrap.firstChild);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      ['dt-sidebar','dt-tab','dt-req-overlay','dt-res-overlay','dt-presets-overlay','dt-save-preset-overlay']
        .forEach(id => { const el=$(id); if(el) { el.style.display=''; el.classList.add('dt-ready'); } });
      const fab=$('dt-baseurl-fab'); if(fab) fab.classList.add('dt-ready');
    }));

    bindUI();
    syncNetworkPanel();
    applyEditorTheme();
    applyLayout();
    populateSidebarSettings();
    syncAutoTransformUI();
    plugins.forEach(p => { if (p.initPanel) p.initPanel(); });
  }

  // ─── Apply editor theme to all editors ───────────────────────────────────────
  function applyEditorTheme() {
    const t = getEditorTheme(), f = getEditorFont(), fs = state.editorSettings.fontSize;
    let styleTag = $('dt-editor-theme-style');
    if (!styleTag) { styleTag = document.createElement('style'); styleTag.id='dt-editor-theme-style'; document.documentElement.appendChild(styleTag); }
    styleTag.textContent = `
      #dt-tab, #dt-sidebar, .dt-overlay, #dt-baseurl-fab, .dt-rec-kebab-menu { --dt-ed-bg:${t.bg}; --dt-ed-text:${t.text}; --dt-ed-font:${f}; --dt-ed-fs:${fs}px; --er:${t.invalid}; }
      .dt-editor-wrap { background:${t.bg}; border-color:${t.bdr}; }
      .dt-editor { color:${t.text}; font-family:${f}; font-size:${fs}px; caret-color:${t.caret}; background:${t.bg}; }
      .dt-hl-overlay { font-family:${f}; font-size:${fs}px; }
      .dt-hl-overlay mark { background:${t.hlMark}; }
      .dt-hl-overlay mark.current { background:${t.hlCurrent}; }
      .dt-editor-bar { background:${t.bar}; border-top-color:${t.bdr}; }
      .dt-editor-btn { color:${t.sMuColor}; border-color:${t.sBdr}; background:transparent; }
      .dt-editor-btn:hover { color:${t.sTxt}; border-color:${t.bdr}; }
      .dt-search-toggle-btn { color:${t.sMuColor}; border-color:${t.sBdr}; }
      .dt-search-toggle-btn:hover,.dt-search-toggle-btn.active { color:${t.caret}; border-color:${t.caret}; background:${t.caret}18; }
      .dt-json-badge { color:${t.sMuColor}; }
      .dt-json-badge.valid { color:${t.valid}; }
      .dt-json-badge.invalid { color:${t.invalid}; }
      .dt-search-bar { background:${t.bar}; border-top-color:${t.bdr}; }
      .dt-search-wrap { background:${t.sWrap}; border:1px solid ${t.sWrapBdr}; }
      .dt-search-wrap:focus-within { border-color:${t.caret}; }
      .dt-search-icon { color:${t.sMuColor}; }
      .dt-search-input { color:${t.sTxt}; caret-color:${t.caret}; }
      .dt-search-count { color:${t.sMuColor}; }
      .dt-search-count.found { color:${t.valid}; }
      .dt-snav { border:1px solid ${t.sBdr}; color:${t.sMuColor}; }
      .dt-snav:hover { border-color:${t.bdr}; color:${t.sTxt}; }
      .dt-sclose { color:${t.sMuColor}; }
      .dt-sclose:hover { color:${t.sTxt}; }
    `;
  }

  const SB_THEMES = {
    light: { bg:'#fff', sf:'#f7f7f7', sf2:'#efefef', bd:'#e2e2e2', bd2:'#cacaca', tx:'#111', tx2:'#444', mu:'#777', fa:'#bbb' },
    dark:  { bg:'#1a1b1e', sf:'#222327', sf2:'#2a2b2f', bd:'#333540', bd2:'#4a4d5a', tx:'#e4e6f0', tx2:'#b0b3c6', mu:'#6b6f82', fa:'#454760' },
  };

  function applySidebarTheme() {
    const { appearance, customBg, customSf, customTx, customBd } = state.layout;
    let tokens;
    if (appearance === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      tokens = prefersDark ? SB_THEMES.dark : SB_THEMES.light;
    } else if (appearance === 'custom') {
      // Base on the previously active resolved theme, not always dark
      const prevIsDark = state.layout._customBase === 'dark';
      tokens = { ...(prevIsDark ? SB_THEMES.dark : SB_THEMES.light) };
      if (customBg) tokens.bg = customBg;
      if (customSf) { tokens.sf = customSf; tokens.sf2 = customSf; }
      if (customTx) { tokens.tx = customTx; tokens.tx2 = customTx; }
      if (customBd) { tokens.bd = customBd; tokens.bd2 = customBd; }
    } else {
      tokens = SB_THEMES[appearance] || SB_THEMES.light;
    }
    const isDark = appearance === 'dark' || (appearance === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches) || appearance === 'custom';

    // All themed elements: sidebar, tab, and all modal overlays
    const themedEls = [
      $('dt-sidebar'), $('dt-tab'),
      $('dt-req-overlay'), $('dt-res-overlay'),
      $('dt-presets-overlay'), $('dt-save-preset-overlay'),
      $('dt-baseurl-fab'), // its dropdown menu uses --bg/--bd — was stuck light in dark mode
    ].filter(Boolean);

    themedEls.forEach(el => {
      el.classList.toggle('dt-dark', isDark && appearance !== 'custom');
      if (appearance === 'custom') {
        el.style.setProperty('--bg', tokens.bg);
        el.style.setProperty('--sf', tokens.sf);
        el.style.setProperty('--sf2', tokens.sf2);
        el.style.setProperty('--tx', tokens.tx);
        el.style.setProperty('--tx2', tokens.tx2);
        el.style.setProperty('--bd', tokens.bd);
        el.style.setProperty('--bd2', tokens.bd2);
        el.style.setProperty('--mu', tokens.mu);
      } else {
        ['--bg','--sf','--sf2','--tx','--tx2','--bd','--bd2','--mu'].forEach(v => el.style.removeProperty(v));
      }
    });

    // Sync appearance tab UI
    document.querySelectorAll('.dt-appearance-tab').forEach(b => b.classList.toggle('active', b.dataset.sbmode === appearance));
    const customPanel = $('dt-sb-custom-colors');
    if (customPanel) customPanel.style.display = appearance === 'custom' ? '' : 'none';
  }

  // ─── Layout (side + width) ────────────────────────────────────────────────────
  function applyLayout(animate) {
    applySidebarTheme();
    const { side, width } = state.layout;
    const sb = $('dt-sidebar'), tab = $('dt-tab');
    const isLeft = side === 'left';

    // Width CSS var
    document.documentElement.style.setProperty('--dt-w', width + 'px');

    // Sidebar side
    if (sb) {
      sb.style.left  = isLeft ? '0' : '';
      sb.style.right = isLeft ? '' : '0';
      sb.style.boxShadow = isLeft
        ? '4px 0 24px rgba(0,0,0,.10),1px 0 0 var(--bd)'
        : '-4px 0 24px rgba(0,0,0,.10),-1px 0 0 var(--bd)';
      // Slide direction: left sidebar slides left when closed
      if (isLeft) {
        sb.style.transform = state.sidebarOpen ? 'translateX(0)' : `translateX(-${width}px)`;
      } else {
        sb.style.transform = state.sidebarOpen ? 'translateX(0)' : `translateX(${width}px)`;
      }
    }

    // Tab side — only add position transition during open/close, not during drag
    if (tab) {
      tab.style.left  = isLeft ? '0' : '';
      tab.style.right = isLeft ? '' : '0';
      tab.style.borderRadius = isLeft ? '0 10px 10px 0' : '10px 0 0 10px';
      tab.style.borderRight  = isLeft ? 'none' : '';
      tab.style.borderLeft   = isLeft ? '' : 'none';
      tab.style.boxShadow    = isLeft ? '2px 0 10px rgba(0,0,0,.07)' : '-2px 0 10px rgba(0,0,0,.07)';
      // Tab chevron direction
      const chevron = $('dt-tab-chevron');
      if (chevron) chevron.style.transform = isLeft ? 'scaleX(-1)' : '';
      // Tab offset when open — animate only during open/close toggle, not drag or side-switch
      if (animate) {
        tab.classList.add('dt-tab-animate');
        // Remove after transition completes so drag doesn't get the slow transition
        clearTimeout(tab._animTimeout);
        tab._animTimeout = setTimeout(() => tab.classList.remove('dt-tab-animate'), 350);
      }
      // Clear both sides first so there's no lingering value on the inactive side
      tab.style.left  = '';
      tab.style.right = '';
      if (state.sidebarOpen) {
        tab.style[isLeft ? 'left' : 'right'] = width + 'px';
      } else {
        tab.style[isLeft ? 'left' : 'right'] = '0';
      }
    }

    // Drag handle side
    const handle = $('dt-sb-drag-handle');
    if (handle) {
      handle.style.left  = isLeft ? 'auto' : '0';
      handle.style.right = isLeft ? '0' : 'auto';
    }

    // Base URL FAB — keep it off the sidebar. The FAB lives at the bottom-right;
    // an open right-side sidebar would sit on top of it, so slide it left to rest
    // just past the sidebar's inner edge (the CSS `right` transition animates it
    // in step with the panel). A left-side or closed sidebar never overlaps the
    // bottom-right corner, so it returns to its default 24px inset.
    const fab = $('dt-baseurl-fab');
    if (fab) {
      const pushLeft = state.sidebarOpen && !isLeft;
      fab.style.right = pushLeft ? (width + 24) + 'px' : '';
      // Close the switcher menu on any layout change so it never animates
      // mid-slide from a stale anchor position.
      const fabMenu = $('dt-baseurl-fab-menu');
      if (fabMenu) fabMenu.classList.remove('open');
    }

    // Sync settings UI
    const slider = $('dt-sb-width-slider');
    if (slider) { slider.value = width; const wv = $('dt-sb-width-val'); if (wv) wv.value = width; }
    document.querySelectorAll('.dt-side-btn').forEach(b => b.classList.toggle('active', b.dataset.side === side));
  }
  let sbTemp = {};

  // Wires a show/hide eye-icon toggle for a CSS-masked (not type=password) input —
  // see the comment on .dt-rec-secret-input for why it's not a real password field.
  function bindSecretToggle(inputId, toggleId) {
    const input = $(inputId), toggle = $(toggleId);
    if (!input || !toggle) return;
    const EYE_ICON = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    const EYE_OFF_ICON = '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
    toggle.addEventListener('click', () => {
      const visible = input.classList.toggle('dt-rec-secret-visible');
      toggle.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${visible ? EYE_OFF_ICON : EYE_ICON}</svg>`;
    });
  }

  // Reflects whether a Postman API key is set onto any "Push to Postman" kebab
  // item currently in the DOM (handles the edge case where the kebab menu
  // happens to be open at the exact moment the key changes, e.g. via cross-tab
  // sync) — disables it and sets a tooltip pointing at Settings.
  function updatePostmanKeyWarning() {
    // state.recorder only exists when the Recorder plugin is installed —
    // plugins are optional, so never assume it.
    const hasKey = !!((state.recorder && state.recorder.postmanApiKey) || '').trim();
    document.querySelectorAll('[data-act="postman"]').forEach(btn => {
      btn.disabled = !hasKey;
      btn.title = hasKey ? '' : 'Add a Postman API key in Settings (gear icon, top right) to enable this';
    });
  }

  // ─── Keyboard shortcuts settings ──────────────────────────────────────────────
  // Reflect current combos into the settings rows. Safe to call before the panel
  // exists (used by cross-tab storage sync) — it no-ops if the DOM isn't there.
  function syncKeybindUI() {
    KEYBIND_DEFS.forEach(def => {
      const row = document.querySelector(`.dt-kb-row[data-kb="${def.id}"]`);
      if (!row) return;
      const combo = row.querySelector('.dt-kb-combo');
      const btn = row.querySelector('.dt-kb-input');
      const capturing = state._captureKeybind === def.id;
      if (capturing) {
        btn.classList.add('capturing');
        combo.innerHTML = `<em class="dt-kb-hint">Press keys…</em>`;
      } else {
        btn.classList.remove('capturing');
        const val = state.keybinds[def.id];
        combo.innerHTML = val ? renderComboKeys(val) : `<em class="dt-kb-hint">Not set</em>`;
      }
      // The reset button is only meaningful when the current combo differs from
      // the default (or is empty).
      const reset = row.querySelector('.dt-kb-reset');
      if (reset) reset.classList.toggle('dt-kb-reset-hidden', state.keybinds[def.id] === def.def);
    });
  }
  // Render "Alt+Shift+I" as individual <kbd> chips.
  function renderComboKeys(combo) {
    return combo.split('+').map(k => `<kbd class="dt-kbd">${escHtml(k)}</kbd>`).join('<span class="dt-kb-plus">+</span>');
  }
  function bindKeybindSettings() {
    // Cancel capture on any outside click.
    KEYBIND_DEFS.forEach(def => {
      const btn = document.querySelector(`.dt-kb-input[data-kb-btn="${def.id}"]`);
      const reset = document.querySelector(`.dt-kb-reset[data-kb-reset="${def.id}"]`);
      if (btn) btn.addEventListener('click', e => { e.stopPropagation(); startKeybindCapture(def.id); });
      if (reset) reset.addEventListener('click', e => {
        e.stopPropagation();
        state.keybinds[def.id] = def.def;
        Store.set('keybinds.' + def.id, def.def);
        cancelKeybindCapture();
        syncKeybindUI();
      });
    });
    syncKeybindUI();
  }
  function startKeybindCapture(id) {
    state._captureKeybind = id;
    syncKeybindUI();
    // Attach a one-shot capture-phase listener. Escape cancels; Backspace/Delete
    // clears the binding; anything else with a non-modifier key is recorded.
    const onKey = e => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { finish(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        state.keybinds[id] = '';
        Store.set('keybinds.' + id, '');
        finish();
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return; // modifier-only press — keep waiting
      // Prevent binding the same combo to two different actions.
      const clash = KEYBIND_DEFS.find(d => d.id !== id && state.keybinds[d.id] === combo);
      if (clash) state.keybinds[clash.id] = '';
      state.keybinds[id] = combo;
      Store.set('keybinds.' + id, combo);
      if (clash) Store.set('keybinds.' + clash.id, '');
      finish();
    };
    const finish = () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onOutside, true);
      state._captureKeybind = null;
      state._captureCancel = null;
      syncKeybindUI();
    };
    const onOutside = e => { if (!e.target.closest || !e.target.closest(`.dt-kb-row[data-kb="${id}"]`)) finish(); };
    // Store the cancel fn so cancelKeybindCapture() can reach it.
    state._captureCancel = finish;
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onOutside, true);
  }
  function cancelKeybindCapture() {
    if (state._captureCancel) { const c = state._captureCancel; state._captureCancel = null; c(); }
  }

  function populateSidebarSettings() {
    bindKeybindSettings();
    const pmKey = $('dt-set-postman-key');
    if (pmKey && state.recorder) { // key belongs to the (optional) Recorder plugin
      pmKey.value = state.recorder.postmanApiKey || '';
      pmKey.addEventListener('change', e => {
        state.recorder.postmanApiKey = e.target.value.trim();
        Store.set('rec.postmanApiKey', state.recorder.postmanApiKey);
        updatePostmanKeyWarning();
      });
      bindSecretToggle('dt-set-postman-key', 'dt-set-postman-key-toggle');
    } else if (pmKey) {
      pmKey.disabled = true;
      pmKey.placeholder = 'API Recorder plugin not installed';
    }

    // ── Position & drag ──────────────────────────────────────────────────────────
    document.querySelectorAll('.dt-side-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = $('dt-tab');
        // Instantly reposition without transition when switching sides
        if (tab) {
          tab.classList.remove('dt-tab-animate');
          clearTimeout(tab._animTimeout);
        }
        state.layout.side = btn.dataset.side;
        Store.set('layout.side', state.layout.side);
        applyLayout(false); // false = no position animation on side-switch
      });
    });
    const handle = $('dt-sb-drag-handle');
    if (handle) {
      // Attach the document move/up listeners only for the duration of a drag,
      // instead of leaving an always-on `mousemove` handler on the host page.
      let startX = 0, startW = 0;
      const onMove = e => { const isLeft=state.layout.side==='left'; const delta=isLeft?e.clientX-startX:startX-e.clientX; setLayoutWidth(Math.max(280,Math.min(720,startW+delta))); };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.userSelect=''; document.body.style.cursor=''; };
      handle.addEventListener('mousedown', e => { startX=e.clientX; startW=state.layout.width; document.body.style.userSelect='none'; document.body.style.cursor='ew-resize'; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); e.preventDefault(); });
    }

    // ── Width slider + stepper + input ───────────────────────────────────────────
    function setLayoutWidth(w) {
      w = Math.max(280, Math.min(720, Math.round(w / 4) * 4));
      state.layout.width = w; Store.set('layout.width', w);
      const sl=$('dt-sb-width-slider'), vi=$('dt-sb-width-val');
      if(sl) sl.value = w; if(vi) vi.value = w;
      applyLayout();
    }
    const wSlider=$('dt-sb-width-slider'), wVal=$('dt-sb-width-val');
    if(wSlider){ wSlider.value=state.layout.width; wSlider.addEventListener('input',()=>setLayoutWidth(parseInt(wSlider.value))); }
    if(wVal){ wVal.value=state.layout.width; wVal.addEventListener('change',()=>setLayoutWidth(parseInt(wVal.value)||360)); }
    const wdDec = $('dt-sb-width-dec'), wdInc = $('dt-sb-width-inc');
    if(wdDec) wdDec.addEventListener('click',()=>setLayoutWidth(state.layout.width-4));
    if(wdInc) wdInc.addEventListener('click',()=>setLayoutWidth(state.layout.width+4));

    // ── Appearance mode tabs ─────────────────────────────────────────────────────
    document.querySelectorAll('.dt-appearance-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const prev = state.layout.appearance;
        state.layout.appearance = btn.dataset.sbmode;
        // When switching TO custom, pre-fill with current theme colors
        if (btn.dataset.sbmode === 'custom') {
          const isDark = prev === 'dark' || (prev === 'auto' && window.matchMedia('(prefers-color-scheme:dark)').matches);
          // Remember which base to use so applySidebarTheme picks the right defaults
          state.layout._customBase = isDark ? 'dark' : 'light';
          const base = isDark ? SB_THEMES.dark : SB_THEMES.light;
          if (!state.layout.customBg) state.layout.customBg = base.bg;
          if (!state.layout.customSf) state.layout.customSf = base.sf;
          if (!state.layout.customTx) state.layout.customTx = base.tx;
          if (!state.layout.customBd) state.layout.customBd = base.bd;
          syncSbCustomColorInputs();
        }
        Store.set('layout.appearance', state.layout.appearance);
        applySidebarTheme();
      });
    });
    // Sidebar custom color inputs
    function bindSbColor(prefix, stateKey) {
      const picker=$(`dt-sb-${prefix}-picker`), hex=$(`dt-sb-${prefix}-hex`), clear=$(`dt-sb-${prefix}-clear`);
      if(!picker) return;
      picker.addEventListener('input',()=>{ hex.value=picker.value; state.layout[stateKey]=picker.value; Store.setSoon('layout.'+stateKey,picker.value); applySidebarTheme(); });
      hex.addEventListener('change',()=>{ const v=hex.value.trim(); if(/^#[0-9a-f]{3,6}$/i.test(v)){picker.value=v;state.layout[stateKey]=v;Store.set('layout.'+stateKey,v);applySidebarTheme();} });
      clear.addEventListener('click',()=>{ hex.value='';state.layout[stateKey]='';Store.set('layout.'+stateKey,'');applySidebarTheme(); });
    }
    bindSbColor('sbg','customBg'); bindSbColor('ssf','customSf'); bindSbColor('stx','customTx'); bindSbColor('sbd','customBd');
    function syncSbCustomColorInputs() {
      const map = {sbg:'customBg',ssf:'customSf',stx:'customTx',sbd:'customBd'};
      Object.entries(map).forEach(([p,k])=>{ const v=state.layout[k]||''; const h=$(`dt-sb-${p}-hex`),pi=$(`dt-sb-${p}-picker`); if(h)h.value=v; if(pi&&v)pi.value=v; });
    }
    syncSbCustomColorInputs();
    applySidebarTheme(); // set correct initial state

    // Auto mode: listen for system color scheme change
    window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>{ if(state.layout.appearance==='auto') applySidebarTheme(); });

    // ── Editor theme grid ────────────────────────────────────────────────────────
    buildThemeGrid('dt-sb-theme-grid', ()=>sbTemp.theme, k => {
      sbTemp.theme = k;
      const isCustom = k === 'custom';
      const eccDiv = $('dt-sb-editor-custom-colors');
      if(eccDiv) eccDiv.style.display = isCustom ? '' : 'none';
      if(isCustom && !sbTemp.customBg) {
        // Pre-fill custom colors from last non-custom theme
        const last = Object.keys(ED_THEMES).filter(x=>x!=='custom').slice(-1)[0];
        const base = ED_THEMES[last] || ED_THEMES.catppuccin;
        sbTemp.customBg = base.bg; sbTemp.customText = base.text;
        syncColorInputsToState('dt-sb-bg', sbTemp.customBg);
        syncColorInputsToState('dt-sb-text', sbTemp.customText);
      }
      updateSbPreview();
    });

    // ── Font list (styled per-font) ──────────────────────────────────────────────
    buildFontList('dt-sb-font-list', ()=>sbTemp.font||state.editorSettings.font, fId => {
      sbTemp.font = fId;
      updateSbPreview();
    });

    // ── Font size slider + stepper + input ───────────────────────────────────────
    function setSizeVal(v) {
      v = Math.max(9, Math.min(18, parseInt(v)||12));
      sbTemp.fontSize = v;
      const sl=$('dt-sb-size-slider'), vi=$('dt-sb-size-val');
      if(sl) sl.value = v; if(vi) vi.value = v;
      updateSbPreview();
    }
    const sSlider=$('dt-sb-size-slider'), sVal=$('dt-sb-size-val');
    if(sSlider){ sSlider.value=state.editorSettings.fontSize; sSlider.addEventListener('input',()=>setSizeVal(sSlider.value)); }
    if(sVal){ sVal.value=state.editorSettings.fontSize; sVal.addEventListener('change',()=>setSizeVal(sVal.value)); }
    const sdDec = $('dt-sb-size-dec'), sdInc = $('dt-sb-size-inc');
    if(sdDec) sdDec.addEventListener('click',()=>setSizeVal((sbTemp.fontSize||state.editorSettings.fontSize)-1));
    if(sdInc) sdInc.addEventListener('click',()=>setSizeVal((sbTemp.fontSize||state.editorSettings.fontSize)+1));

    // ── Editor custom colors ─────────────────────────────────────────────────────
    bindColorInputs('dt-sb-bg',   'customBg',   ()=>updateSbPreview());
    bindColorInputs('dt-sb-text', 'customText', ()=>updateSbPreview());
    syncColorInputsToState('dt-sb-bg',   state.editorSettings.customBg);
    syncColorInputsToState('dt-sb-text', state.editorSettings.customText);

    // Show/hide custom editor colors based on current theme selection
    const eccDiv = $('dt-sb-editor-custom-colors');
    if(eccDiv) eccDiv.style.display = (sbTemp.theme||state.editorSettings.theme) === 'custom' ? '' : 'none';

    // ── Apply / Reset ────────────────────────────────────────────────────────────
    const applyBtn = $('dt-sb-settings-apply');
    if(applyBtn) applyBtn.addEventListener('click', () => {
      Object.assign(state.editorSettings, sbTemp);
      Store.set('ed.theme', state.editorSettings.theme);
      Store.set('ed.font',  state.editorSettings.font);
      Store.set('ed.fontSize', state.editorSettings.fontSize);
      Store.set('ed.customBg', state.editorSettings.customBg);
      Store.set('ed.customText', state.editorSettings.customText);
      applyEditorTheme();
      const btn=$('dt-sb-settings-apply'), orig=btn.textContent;
      btn.textContent='Saved ✓'; btn.style.background='var(--gn)'; btn.style.borderColor='var(--gn)'; btn.style.color='#fff';
      setTimeout(()=>{btn.textContent=orig;btn.style.background='';btn.style.borderColor='';btn.style.color='';},1800);
    });
    const resetBtn = $('dt-sb-settings-reset');
    if(resetBtn) resetBtn.addEventListener('click', () => {
      const defaults = { theme:'catppuccin', font:'ibm', fontSize:12, customBg:'', customText:'' };
      sbTemp = { ...defaults };
      syncSbControlsToTemp();
      updateSbPreview();
    });

    sbTemp = { ...state.editorSettings };
    updateSbPreview();
  }

  function syncSbControlsToTemp() {
    document.querySelectorAll('.dt-theme-swatch').forEach(s => s.classList.toggle('active', s.dataset.theme === sbTemp.theme));
    // Sync font list
    const targetFont = sbTemp.font || state.editorSettings.font;
    document.querySelectorAll('#dt-sb-font-list .dt-font-opt').forEach(o => o.classList.toggle('active', o.dataset.font === targetFont));
    const fs = sbTemp.fontSize || state.editorSettings.fontSize;
    const sl=$('dt-sb-size-slider'), vi=$('dt-sb-size-val');
    if(sl) sl.value=fs; if(vi) vi.value=fs;
    syncColorInputsToState('dt-sb-bg', sbTemp.customBg||'');
    syncColorInputsToState('dt-sb-text', sbTemp.customText||'');
  }

  function updateSbPreview() {
    const themeKey = sbTemp.theme || state.editorSettings.theme;
    const t   = ED_THEMES[themeKey] || ED_THEMES.catppuccin;
    // For a named theme, always use its bg/text. For custom, overlay the custom values.
    const bg  = (themeKey === 'custom' && sbTemp.customBg)   ? sbTemp.customBg
              : (themeKey === 'custom' && state.editorSettings.customBg) ? state.editorSettings.customBg
              : t.bg;
    const txt = (themeKey === 'custom' && sbTemp.customText) ? sbTemp.customText
              : (themeKey === 'custom' && state.editorSettings.customText) ? state.editorSettings.customText
              : t.text;
    const fId = sbTemp.font || state.editorSettings.font;
    const f   = (ED_FONTS.find(x => x.id === fId) || ED_FONTS[0]).css;
    const fs  = sbTemp.fontSize !== undefined ? sbTemp.fontSize : state.editorSettings.fontSize;
    // Apply to both the outer wrap (overrides the applyEditorTheme stylesheet) and inner text
    const wrap = $('dt-sb-preview');
    const inn  = $('dt-sb-preview-inner');
    if (wrap) {
      wrap.style.background = bg;
      // Also target the dt-editor-wrap inside so the CSS class rule is overridden
      const edWrap = wrap.querySelector('.dt-editor-wrap');
      if (edWrap) edWrap.style.background = bg;
    }
    if (inn) {
      inn.style.color = txt;
      inn.style.fontFamily = f;
      inn.style.fontSize = fs + 'px';
      inn.style.background = bg;
    }
  }

  // ─── Reusable: build theme grid & font list ───────────────────────────────────
  function buildThemeGrid(containerId, getCurrent, onChange) {
    const grid = $(containerId); if (!grid) return;
    grid.innerHTML = '';
    const allThemes = { ...ED_THEMES, custom: { name:'Custom', bg:'#1e1e2e', text:'#cdd6f4', bdr:'#313145' } };
    Object.entries(allThemes).forEach(([key, t]) => {
      const el = document.createElement('div');
      el.className = 'dt-theme-swatch' + (state.editorSettings.theme===key?' active':'');
      el.dataset.theme = key;
      el.innerHTML = `<div class="dt-swatch-preview" style="background:${t.bg}"><span class="dt-swatch-preview-inner" style="color:${t.text};font-family:'IBM Plex Mono',monospace">{…}</span></div><div class="dt-swatch-name" style="color:${t.text||'inherit'};background:${t.bg}">${t.name}</div>`;
      el.addEventListener('click', () => {
        document.querySelectorAll(`#${containerId} .dt-theme-swatch`).forEach(s=>s.classList.remove('active'));
        el.classList.add('active');
        onChange(key);
      });
      grid.appendChild(el);
    });
  }

  function buildFontList(containerId, getCurrent, onChange) {
    const list = $(containerId); if (!list) return;
    list.innerHTML = '';
    ED_FONTS.forEach(f => {
      const el = document.createElement('div');
      el.className = 'dt-font-opt' + (state.editorSettings.font===f.id?' active':'');
      el.dataset.font = f.id;
      el.innerHTML = `<div class="dt-font-opt-radio"></div><span class="dt-font-opt-name" style="font-family:${f.css}">${f.name}</span><span class="dt-font-opt-preview" style="font-family:${f.css}">const x = 1;</span>`;
      el.addEventListener('click', () => {
        document.querySelectorAll(`#${containerId} .dt-font-opt`).forEach(o=>o.classList.remove('active'));
        el.classList.add('active');
        onChange(f.id);
      });
      list.appendChild(el);
    });
  }

  // ─── Reusable: bind color picker + hex input + clear ─────────────────────────
  function bindColorInputs(prefix, stateKey, onchange) {
    const picker = $(`${prefix}-picker`), hexEl = $(`${prefix}-hex`), clearBtn = $(`${prefix}-clear`);
    picker.addEventListener('input', () => { hexEl.value = picker.value; sbTemp[stateKey] = picker.value; onchange(); });
    hexEl.addEventListener('input', () => {
      const v = hexEl.value.trim();
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { picker.value = v; sbTemp[stateKey] = v; onchange(); }
    });
    clearBtn.addEventListener('click', () => { hexEl.value = ''; picker.value = '#000000'; sbTemp[stateKey] = ''; onchange(); });
  }

  function syncColorInputsToState(prefix, value) {
    const hexEl = $(`${prefix}-hex`), picker = $(`${prefix}-picker`);
    if (hexEl) hexEl.value = value || '';
    if (picker && value) picker.value = value;
  }

  // ─── Bind UI ─────────────────────────────────────────────────────────────────
  function bindUI() {
    $('dt-tab').addEventListener('click', toggleSidebar);
    $('dt-close-btn').addEventListener('click', closeSidebar);

    // Global intercept hotkeys — capture phase so they fire even when a page
    // element (or the intercept modal's editor) has focus, and before the host
    // page can swallow the event. Only preventDefault/stopPropagation when a
    // combo actually matches one of ours (see handleGlobalHotkey), so unrelated
    // page shortcuts are left untouched.
    document.addEventListener('keydown', handleGlobalHotkey, true);
    document.addEventListener('keyup', handleGlobalHotkeyUp, true);
    // If focus leaves the page mid-hold (e.g. Alt-Tab), the keyup may never
    // arrive — end the hold defensively so intercept doesn't get stuck on.
    realWindow.addEventListener('blur', endHold);

    // Network panel "Hold to Intercept" button — momentary, same as the hold
    // keybind. pointerdown/up covers mouse, touch, and pen; pointerleave/cancel
    // guard against a release that lands outside the button.
    const holdBtn = $('dt-hold-intercept');
    if (holdBtn) {
      holdBtn.addEventListener('pointerdown', e => { e.preventDefault(); beginHold([]); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
        holdBtn.addEventListener(ev, () => endHold()));
    }

    // Portal tooltip — the tip text is rendered into #dt-tip-portal appended
    // directly to <html>, OUTSIDE #dt-sidebar. The sidebar has a `transform`
    // (translateX for the slide animation), which makes position:fixed resolve
    // against the sidebar's box instead of the viewport — so the old inline
    // tooltip was pushed off-screen whenever the sidebar sat on the right. A
    // portal at document root has no transformed ancestor, so fixed positioning
    // is true viewport-relative and works on either side. Delegated mouseover/
    // mouseout also covers tips added later by plugins.
    let tipPortal = document.getElementById('dt-tip-portal');
    if (!tipPortal) {
      tipPortal = document.createElement('div');
      tipPortal.id = 'dt-tip-portal';
      document.documentElement.appendChild(tipPortal);
    }
    function hideTip() { tipPortal.classList.remove('visible'); }
    function showTip(tipEl) {
      const text = tipEl.querySelector('.dt-tip-text');
      if (!text) return;
      tipPortal.innerHTML = text.innerHTML;
      tipPortal.classList.toggle('dt-dark', $('dt-sidebar').classList.contains('dt-dark'));
      // Reveal off-screen first so we can measure the real size before placing it
      tipPortal.style.left = '-9999px';
      tipPortal.style.top = '-9999px';
      tipPortal.classList.add('visible');
      const icon = tipEl.querySelector('.dt-tip-icon') || tipEl;
      const ir = icon.getBoundingClientRect();
      const tw = tipPortal.offsetWidth || 230;
      const th = tipPortal.offsetHeight || 80;
      let left = ir.left;
      let top  = ir.bottom + 8;
      if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
      if (left < 8) left = 8;
      if (top + th > window.innerHeight - 8) top = ir.top - th - 8;
      if (top < 8) top = 8;
      tipPortal.style.left = left + 'px';
      tipPortal.style.top  = top + 'px';
    }
    // Scope the hover listeners to our own roots (sidebar + modal overlays)
    // rather than `document`. Every `.dt-tip` lives inside one of these, and
    // mouseover/mouseout otherwise fire for EVERY element the cursor crosses on
    // the host page — pure overhead on a script that loads on every site. Bound
    // to the containers, the handler only runs while the cursor is over our UI.
    ['dt-sidebar','dt-req-overlay','dt-res-overlay','dt-presets-overlay','dt-save-preset-overlay']
      .map(id => $(id)).filter(Boolean).forEach(root => {
        root.addEventListener('mouseover', e => {
          const t = e.target.closest && e.target.closest('.dt-tip');
          if (t) showTip(t);
        });
        root.addEventListener('mouseout', e => {
          const t = e.target.closest && e.target.closest('.dt-tip');
          if (t && (!e.relatedTarget || !t.contains(e.relatedTarget))) hideTip();
        });
      });

    document.addEventListener('click', e => {
      // Fires for every click on the host page. When the sidebar is closed (the
      // overwhelmingly common state) there's nothing to close — bail before doing
      // any DOM lookups or classList/contains checks.
      if (!state.sidebarOpen) return;
      const sb=$('dt-sidebar'), tab=$('dt-tab');
      const rqo=$('dt-req-overlay'), rso=$('dt-res-overlay'), pso=$('dt-presets-overlay'), spo=$('dt-save-preset-overlay');
      // Only close sidebar on outside click if no modal is open
      const anyModalOpen = (rqo&&rqo.classList.contains('visible'))||(rso&&rso.classList.contains('visible'))||(pso&&pso.classList.contains('visible'))||(spo&&spo.classList.contains('visible'));
      if (!anyModalOpen && sb && !sb.contains(e.target) && !tab.contains(e.target) && !e.target.closest('#dt-rec-kebab-portal')) closeSidebar();
    }, true);

    // Nav
    function switchToPanel(panelName) {
      document.querySelectorAll('.dt-nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.dt-panel').forEach(p => p.classList.remove('active'));
      const btn = document.querySelector(`.dt-nav-btn[data-panel="${panelName}"]`);
      if (btn) btn.classList.add('active');
      const panel = $('dt-panel-' + panelName);
      if (panel) panel.classList.add('active');
      const gearBtn = $('dt-settings-btn');
      if (gearBtn) gearBtn.classList.toggle('active', panelName === 'settings');
    }
    document.querySelectorAll('.dt-nav-btn').forEach(btn => btn.addEventListener('click', () => switchToPanel(btn.dataset.panel)));
    const settingsBtn = $('dt-settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', () => switchToPanel('settings'));
    // The About panel has no nav button — previously it was dead, unreachable
    // markup. The header icon/title now opens it.
    const headIcon = document.querySelector('#dt-sidebar .dt-head-icon');
    const headTitle = document.querySelector('#dt-sidebar .dt-head-title');
    [headIcon, headTitle].forEach(el => {
      if (!el) return;
      el.style.cursor = 'pointer';
      el.title = 'About DevTools Sidebar';
      el.addEventListener('click', () => switchToPanel('about'));
    });

    // ── Network filters: a Global block ('net') that writes to BOTH req & res,
    // plus independent 'req' and 'res' blocks. state.req.* / state.res.* have
    // always been stored separately; 'net' is a UI convenience that mirrors into
    // both. shouldIntercept() already reads each namespace's own values, so the
    // request and response interceptors can now use different method sets and
    // regexes. See buildFilterBlock() in Devtools_html.js.
    ['net', 'req', 'res'].forEach(bindFilterNs);
    document.querySelectorAll('.dt-disclosure-hd').forEach(hd =>
      hd.addEventListener('click', () => hd.closest('.dt-disclosure').classList.toggle('open')));
    ['net', 'req', 'res'].forEach(applyFilterToUI);
    updateFilterHints();

    // ── Request interceptor enable/persist ────────────────────────────────────
    $('dt-req-enabled').addEventListener('change', e => {
      state.req.enabled = e.target.checked;
      if (state.req.persist) Store.set('req.enabled', state.req.enabled);
      syncNetworkPanel();
    });
    $('dt-req-persist').addEventListener('change', e => {
      state.req.persist = e.target.checked;
      Store.set('req.persist', state.req.persist);
      if (state.req.persist) Store.set('req.enabled', state.req.enabled);
      syncNetworkPanel();
    });

    // ── Response interceptor enable/persist ───────────────────────────────────
    $('dt-res-enabled').addEventListener('change', e => {
      state.res.enabled = e.target.checked;
      if (state.res.persist) Store.set('res.enabled', state.res.enabled);
      syncNetworkPanel();
    });
    $('dt-res-persist').addEventListener('change', e => {
      state.res.persist = e.target.checked;
      Store.set('res.persist', state.res.persist);
      if (state.res.persist) Store.set('res.enabled', state.res.enabled);
      syncNetworkPanel();
    });

    // Headers toggles (modal)
    ['req', 'res'].forEach(ns => {
      $(`dt-${ns}-htoggle`).addEventListener('click', () => {
        $(`dt-${ns}-htoggle`).classList.toggle('open');
        $(`dt-${ns}-hbody`).classList.toggle('open');
      });
    });

    // Editor bindings
    $('dt-req-add-param').addEventListener('click', () => { addParamRow('dt-req-params-list','',''); pruneParamSuggestions('dt-req-params-list'); });
    // Catches a manually-typed key that duplicates a pending suggestion, on
    // either list (a real row's key field) or editor (body JSON) edits.
    $('dt-req-params-list').addEventListener('input', e => { if (e.target.dataset.role === 'key') pruneParamSuggestions('dt-req-params-list'); });
    $('dt-req-ed').addEventListener('input', () => renderBodySuggestions(state._lastReqDocSuggestions ? state._lastReqDocSuggestions.body : null));
    bindEditor('dt-req-ed','reqSearch');
    bindEditor('dt-res-ed','resSearch');
    $('dt-req-modal').addEventListener('keydown', e => { if((e.ctrlKey||e.metaKey)&&e.key==='f'){e.preventDefault();openSearch('dt-req-ed');} });
    $('dt-res-modal').addEventListener('keydown', e => { if((e.ctrlKey||e.metaKey)&&e.key==='f'){e.preventDefault();openSearch('dt-res-ed');} });
    bindModalResize('dt-req-modal');
    bindModalResize('dt-res-modal');

    // Response mode tabs
    document.querySelectorAll('.dt-res-tab').forEach(tab => tab.addEventListener('click', () => {
      document.querySelectorAll('.dt-res-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.restab;
      $('dt-res-manual').style.display = mode==='manual' ? 'flex' : 'none';
      $('dt-res-gui').style.display    = mode==='gui'    ? 'flex' : 'none';
      $('dt-res-code').style.display   = mode==='code'   ? 'flex' : 'none';
      if (mode==='gui' && state.currentRes) buildResTree(state.currentRes.body);
      if (mode==='code') updateTransformPreview();
    }));

    // GUI path actions
    $('dt-res-extract-btn').addEventListener('click', () => {
      const path = $('dt-res-path-display').textContent;
      if (!path || path==='—') return;
      try {
        const val = getByPath(JSON.parse(state.currentRes?.body||'{}'), path);
        $('dt-res-ed').value = typeof val==='string' ? val : JSON.stringify(val, null, 2);
        updateBadge('dt-res-ed');
        switchResTab('manual');
      } catch(e) { console.warn('DevTools: extract failed', e); }
    });
    $('dt-res-wrap-btn').addEventListener('click', () => {
      const ki = $('dt-res-wrap-key');
      if (ki.style.display==='none') { ki.style.display='block'; ki.focus(); return; }
      const key = ki.value.trim(); if (!key) return;
      try {
        const data = JSON.parse(state.currentRes?.body||'{}');
        const path = $('dt-res-path-display').textContent;
        const val  = path==='—' ? data : getByPath(data, path);
        $('dt-res-ed').value = JSON.stringify({ [key]: val }, null, 2);
        updateBadge('dt-res-ed');
        ki.style.display='none'; ki.value='';
        switchResTab('manual');
      } catch(e) { console.warn('DevTools: wrap failed', e); }
    });

    // JS Transform
    $('dt-res-run-btn').addEventListener('click', () => {
      const errEl = $('dt-res-transform-err');
      try {
        const raw  = state.currentRes?.body || '{}';
        let data; try { data = JSON.parse(raw); } catch { data = raw; }
        const meta = { url: state.currentRes?.url, method: state.currentRes?.method, status: state.currentRes?.status };
        // eslint-disable-next-line no-new-func
        const result = new Function('data','res', $('dt-res-code-editor').value)(data, meta);
        $('dt-res-ed').value = typeof result==='string' ? result : JSON.stringify(result, null, 2);
        updateBadge('dt-res-ed');
        errEl.textContent = ''; errEl.className='dt-transform-err';
        updateTransformPreview();
        switchResTab('manual');
      } catch(e) {
        errEl.textContent = e.message; errEl.className='dt-transform-err show';
      }
    });

    // Presets management
    $('dt-res-presets-btn').addEventListener('click', () => { openPresetsModal(); });
    $('dt-presets-close').addEventListener('click', () => { closePresetsModal(); });
    $('dt-res-save-preset').addEventListener('click', () => { savePresetDialog(); });
    $('dt-presets-overlay').addEventListener('click', e => { if(e.target.id==='dt-presets-overlay') closePresetsModal(); });
    // Preset editor sub-view (rename / edit URL patterns of an existing preset)
    $('dt-pe-cancel').addEventListener('click', () => closePresetEditor());
    $('dt-pe-save').addEventListener('click', () => commitPresetEditor());

    // Mini save preset overlay
    $('dt-spe-cancel').addEventListener('click', () => closeSavePresetOverlay());
    $('dt-spe-save').addEventListener('click', () => commitSavePreset());
    $('dt-spe-add-pattern').addEventListener('click', () => addSavePatternRow(''));
    $('dt-save-preset-overlay').addEventListener('click', e => { if(e.target.id==='dt-save-preset-overlay') closeSavePresetOverlay(); });

    // Auto-transform toggle
    const atToggle = $('dt-res-auto-transform');
    if (atToggle) {
      atToggle.checked = state.res.autoTransform;
      atToggle.addEventListener('change', e => {
        state.res.autoTransform = e.target.checked;
        Store.set('res.autoTransform', state.res.autoTransform);
        syncAutoTransformUI();
      });
    }

    // Show preview on code editor changes
    $('dt-res-code-editor').addEventListener('input', () => updateTransformPreview());
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  function switchResTab(mode) {
    document.querySelectorAll('.dt-res-tab').forEach(t=>t.classList.remove('active'));
    document.querySelector(`.dt-res-tab[data-restab="${mode}"]`).classList.add('active');
    $('dt-res-manual').style.display=mode==='manual'?'flex':'none';
    $('dt-res-gui').style.display=mode==='gui'?'flex':'none';
    $('dt-res-code').style.display=mode==='code'?'flex':'none';
  }

  function bindEditor(id, searchKey) {
    $(id).addEventListener('input', () => onEditorChange(id, searchKey));
    $(id).addEventListener('scroll', () => syncOvScroll(id));
    $(`${id}-fmt`).addEventListener('click', () => { try { $(id).value=JSON.stringify(JSON.parse($(id).value),null,2); onEditorChange(id,searchKey); } catch {} });
    $(`${id}-min`).addEventListener('click', () => { try { $(id).value=JSON.stringify(JSON.parse($(id).value)); onEditorChange(id,searchKey); } catch {} });
    $(`${id}-stoggle`).addEventListener('click', () => toggleSearch(id));
    $(`${id}-sinput`).addEventListener('input', e => runSearch(id, searchKey, e.target.value));
    $(`${id}-sinput`).addEventListener('keydown', e => {
      if(e.key==='Enter'){e.shiftKey?searchPrev(id,searchKey):searchNext(id,searchKey);}
      if(e.key==='Escape') closeSearch(id,searchKey);
    });
    $(`${id}-sprev`).addEventListener('click', () => searchPrev(id,searchKey));
    $(`${id}-snext`).addEventListener('click', () => searchNext(id,searchKey));
    $(`${id}-sclose`).addEventListener('click', () => closeSearch(id,searchKey));

    // Feature 3: Line wrap toggle
    const wrapBtn = $(`${id}-wrap-toggle`);
    if (wrapBtn) {
      let wrapOn = false;
      wrapBtn.addEventListener('click', () => {
        wrapOn = !wrapOn;
        const ed = $(id), ov = $(`${id}-hl`), outer = $(`${id}-outer`);
        if (wrapOn) {
          ed.style.whiteSpace = 'pre-wrap';
          ed.style.overflowX = 'hidden';
          if (ov) { ov.style.whiteSpace = 'pre-wrap'; ov.style.overflowX = 'hidden'; }
          wrapBtn.classList.add('active');
        } else {
          ed.style.whiteSpace = 'pre';
          ed.style.overflowX = '';
          if (ov) { ov.style.whiteSpace = 'pre'; ov.style.overflowX = ''; }
          wrapBtn.classList.remove('active');
        }
      });
    }

    // Feature 4: Vertical resize handle — remembered per-editor across reloads
    const resizeHandle = $(`${id}-resize`);
    const edWrap = $(`${id}-wrap`);
    if (resizeHandle && edWrap) {
      const heightKey = `ed.height.${id}`;
      const savedHeight = Store.get(heightKey, null);
      if (savedHeight) { edWrap.style.height = savedHeight + 'px'; edWrap.style.flex = 'none'; }

      // Move/up listeners live only for the duration of a drag. bindEditor runs
      // once per editor, so the old always-on handlers meant a permanent
      // document `mousemove` listener for every editor on every page.
      let startY = 0, startH = 0;
      const onMove = e => {
        const newH = Math.max(120, startH + (e.clientY - startY));
        edWrap.style.height = newH + 'px';
        edWrap.style.flex = 'none';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        Store.set(heightKey, edWrap.offsetHeight);
      };
      resizeHandle.addEventListener('mousedown', e => {
        startY = e.clientY;
        startH = edWrap.offsetHeight;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'ns-resize';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
      });
    }
  }

  // Modal size (the native CSS `resize:both` drag handle in its bottom-right
  // corner) is remembered per-modal across reloads, the same way the editor's
  // own resize handle is above.
  function bindModalResize(modalId) {
    const modal = $(modalId);
    if (!modal) return;
    const sizeKey = `ed.modalSize.${modalId}`;
    const saved = Store.get(sizeKey, null);
    if (saved && saved.w && saved.h) {
      modal.style.width = saved.w + 'px';
      modal.style.height = saved.h + 'px';
    }
    let saveTimer = null;
    new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        Store.set(sizeKey, { w: Math.round(width), h: Math.round(height) });
      }, 300);
    }).observe(modal);
  }

  function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    $('dt-sidebar').classList.toggle('open', state.sidebarOpen);
    $('dt-tab').classList.toggle('active', state.sidebarOpen);
    applyLayout(true);
  }
  function closeSidebar() {
    state.sidebarOpen = false;
    $('dt-sidebar').classList.remove('open');
    $('dt-tab').classList.remove('active');
    applyLayout(true);
  }

  // ── Network filter helpers (global 'net' + independent 'req'/'res') ─────────
  function setRegexDot(dot, val) {
    if (!dot) return;
    if (!val) { dot.className = 'dt-regex-dot'; return; }
    // Keep the raw value even while invalid: empty means "match ALL", so a
    // half-typed regex must NOT fall back to matching everything. The dot shows
    // validity; shouldIntercept()'s try/catch matches nothing until it parses.
    try { new RegExp(val); dot.className = 'dt-regex-dot valid'; }
    catch { dot.className = 'dt-regex-dot invalid'; }
  }
  // For the global block: a value is shown only when req & res agree on it.
  function netMethodOn(m) { return state.req.methods.includes(m) && state.res.methods.includes(m); }
  function netMode()  { return state.req.mode === state.res.mode ? state.req.mode : 'auto'; }
  function netRegex() { return state.req.urlRegex === state.res.urlRegex ? state.req.urlRegex : ''; }

  function applyFilterToUI(ns) {
    const isNet = ns === 'net';
    const s = isNet ? null : state[ns];
    ALL_METHODS.forEach(m => {
      const el = $(`dt-${ns}-m-${m}`);
      if (el) el.checked = isNet ? netMethodOn(m) : s.methods.includes(m);
    });
    const mode = isNet ? netMode() : s.mode;
    document.querySelectorAll(`.dt-mode-btn[data-ns="${ns}"]`).forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const chip = $(`dt-${ns}-chip`); if (chip) chip.textContent = mode === 'auto' ? 'Auto' : 'Regex';
    const rw = $(`dt-${ns}-rwrap`); if (rw) rw.classList.toggle('visible', mode === 'manual');
    const ri = $(`dt-${ns}-regex`);
    if (ri) {
      const rx = isNet ? netRegex() : s.urlRegex;
      // Don't stomp the caret if the user is actively typing in this field.
      if (document.activeElement !== ri) ri.value = rx;
      setRegexDot($(`dt-${ns}-rdot`), ri.value);
    }
  }

  function bindFilterNs(ns) {
    ALL_METHODS.forEach(m => {
      const el = $(`dt-${ns}-m-${m}`);
      if (!el) return;
      el.addEventListener('change', () => {
        const selected = ALL_METHODS.filter(x => $(`dt-${ns}-m-${x}`).checked);
        if (ns === 'net') {
          state.req.methods = selected.slice(); state.res.methods = selected.slice();
          Store.set('req.methods', state.req.methods); Store.set('res.methods', state.res.methods);
        } else {
          state[ns].methods = selected; Store.set(`${ns}.methods`, selected);
        }
        refreshFilters();
      });
    });
    document.querySelectorAll(`.dt-mode-btn[data-ns="${ns}"]`).forEach(btn => btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (ns === 'net') {
        state.req.mode = mode; state.res.mode = mode;
        Store.set('req.mode', mode); Store.set('res.mode', mode);
      } else {
        state[ns].mode = mode; Store.set(`${ns}.mode`, mode);
      }
      refreshFilters();
    }));
    const ri = $(`dt-${ns}-regex`);
    if (ri) ri.addEventListener('input', e => {
      const val = e.target.value.trim();
      setRegexDot($(`dt-${ns}-rdot`), val);
      if (ns === 'net') {
        state.req.urlRegex = val; state.res.urlRegex = val;
        Store.setSoon('req.urlRegex', val); Store.setSoon('res.urlRegex', val);
      } else {
        state[ns].urlRegex = val; Store.setSoon(`${ns}.urlRegex`, val);
      }
      // Update sibling blocks without touching this field's caret.
      applyFilterToUI('net'); applyFilterToUI('req'); applyFilterToUI('res');
      updateFilterHints();
    });
  }

  function filterSummary(ns) {
    const s = state[ns];
    const methods = s.methods.length === ALL_METHODS.length ? 'All methods'
      : (s.methods.length ? s.methods.join(' ') : 'No methods');
    const url = s.mode === 'manual' ? (s.urlRegex ? `/${s.urlRegex}/` : 'regex: —') : 'all URLs';
    return `${methods} · ${url}`;
  }
  function updateFilterHints() {
    const rh = $('dt-req-filter-hint'); if (rh) rh.textContent = filterSummary('req');
    const sh = $('dt-res-filter-hint'); if (sh) sh.textContent = filterSummary('res');
  }
  function refreshFilters() {
    ['net', 'req', 'res'].forEach(applyFilterToUI);
    updateFilterHints();
  }

  function syncNetworkPanel() {
    refreshFilters();
    // Req
    const re=$('dt-req-enabled'); if(re) re.checked=state.req.enabled;
    const rp=$('dt-req-persist'); if(rp) rp.checked=state.req.persist;
    const reqPersistRow=$('dt-req-persist-row');
    if(reqPersistRow) reqPersistRow.classList.toggle('dt-row-disabled', !state.req.enabled);
    updateQueueUI('req');
    const se=$('dt-res-enabled'); if(se) se.checked=state.res.enabled;
    const sp=$('dt-res-persist'); if(sp) sp.checked=state.res.persist;
    const resPersistRow=$('dt-res-persist-row');
    if(resPersistRow) resPersistRow.classList.toggle('dt-row-disabled', !state.res.enabled);
    updateQueueUI('res');
  }

  function updateQueueUI(ns) {
    const arr=ns==='req'?state.pendingReqs:state.pendingRes, n=arr.length;
    const dot=$(`dt-${ns}-qdot`), txt=$(`dt-${ns}-qtext`);
    if(!dot||!txt) return;
    dot.className=n>0?'dt-queue-dot active':'dt-queue-dot';
    txt.innerHTML=n>0?`<strong>${n}</strong> ${ns==='res'?'response':'request'}${n!==1?'s':''} waiting`:`No ${ns==='res'?'responses':'requests'} waiting`;
  }

  // ─── Editor helpers ───────────────────────────────────────────────────────────
  // jump=false here: re-running search on every keystroke keeps highlights/count
  // accurate as matches shift, but must NOT move the caret away from wherever
  // the user is actually typing (that's a content edit, not a search action).
  function onEditorChange(id, sk) { updateBadge(id); if(state[sk].term) runSearch(id,sk,state[sk].term,false); else renderHL(id,sk,''); }
  function updateBadge(id) {
    const el=$(`${id}-badge`); if(!el) return;
    const val=$(id).value;
    if(!val.trim()){el.textContent='—';el.className='dt-json-badge';return;}
    try{JSON.parse(val);el.textContent='✓ valid json';el.className='dt-json-badge valid';}
    catch{el.textContent='✗ invalid json';el.className='dt-json-badge invalid';}
  }
  function syncOvScroll(id) { const ed=$(id),ov=$(`${id}-hl`); if(ov&&ed){ov.scrollTop=ed.scrollTop;ov.scrollLeft=ed.scrollLeft;} }

  // ─── Search ───────────────────────────────────────────────────────────────────
  function openSearch(id) { $(`${id}-sbar`).classList.remove('hidden'); $(`${id}-stoggle`).classList.add('active'); const inp=$(`${id}-sinput`);inp.focus();inp.select(); }
  function closeSearch(id,sk) { $(`${id}-sbar`).classList.add('hidden'); $(`${id}-stoggle`).classList.remove('active'); state[sk]={term:'',matchIndex:0,matches:[]}; renderHL(id,sk,''); const c=$(`${id}-scount`);if(c){c.textContent='—';c.className='dt-search-count';} }
  function toggleSearch(id) { const bar=$(`${id}-sbar`); const sk=id.startsWith('dt-req')?'reqSearch':'resSearch'; bar.classList.contains('hidden')?openSearch(id):closeSearch(id,sk); }
  function runSearch(id,sk,term,jump) { if(jump===undefined)jump=true; state[sk].term=term;state[sk].matches=[];state[sk].matchIndex=0; if(!term){renderHL(id,sk,'');updateSCount(id,sk);return;} const text=$(id).value,lower=text.toLowerCase(),q=term.toLowerCase();let pos=0;while((pos=lower.indexOf(q,pos))!==-1){state[sk].matches.push(pos);pos+=q.length;} renderHL(id,sk,term);updateSCount(id,sk);if(jump)scrollToMatch(id,sk); }
  function renderHL(id,sk,term) { const ov=$(`${id}-hl`),ed=$(id);if(!ov||!ed)return; if(!term||!state[sk].matches.length){ov.innerHTML=escHtml(ed.value);return;} const text=ed.value,q=term.toLowerCase(),ql=q.length;let res='',cur=0;state[sk].matches.forEach((pos,i)=>{res+=escHtml(text.slice(cur,pos));res+=`<mark class="${i===state[sk].matchIndex?'current':''}">${escHtml(text.slice(pos,pos+ql))}</mark>`;cur=pos+ql;});res+=escHtml(text.slice(cur));ov.innerHTML=res;syncOvScroll(id); }
  function searchNext(id,sk) { if(!state[sk].matches.length)return;state[sk].matchIndex=(state[sk].matchIndex+1)%state[sk].matches.length;renderHL(id,sk,state[sk].term);updateSCount(id,sk);scrollToMatch(id,sk); }
  function searchPrev(id,sk) { if(!state[sk].matches.length)return;state[sk].matchIndex=(state[sk].matchIndex-1+state[sk].matches.length)%state[sk].matches.length;renderHL(id,sk,state[sk].term);updateSCount(id,sk);scrollToMatch(id,sk); }
  function updateSCount(id,sk) { const c=$(`${id}-scount`);if(!c)return;const n=state[sk].matches.length;if(!state[sk].term||n===0){c.textContent=n===0&&state[sk].term?'0 results':'—';c.className='dt-search-count';}else{c.textContent=`${state[sk].matchIndex+1}/${n}`;c.className='dt-search-count found';} }
  function scrollToMatch(id,sk) { const ed=$(id);if(!ed||!state[sk].matches.length)return;const pos=state[sk].matches[state[sk].matchIndex];const lh=parseFloat(getComputedStyle(ed).lineHeight)||20;const lines=ed.value.slice(0,pos).split('\n').length-1;ed.scrollTop=Math.max(0,lines*lh-ed.clientHeight/2);ed.setSelectionRange(pos,pos+state[sk].term.length);syncOvScroll(id); }

  // ─── GET Params ───────────────────────────────────────────────────────────────
  function addParamRow(listId,key,val) { const list=$(listId);const row=document.createElement('div');row.className='dt-param-row';row.innerHTML=`<input class="dt-param-input" placeholder="key" value="${escHtml(key)}" data-role="key"><span class="dt-param-eq">=</span><input class="dt-param-input" placeholder="value" value="${escHtml(val)}" data-role="val"><button class="dt-param-dup" title="Duplicate row">${icon('copy',13,1.8)}</button><button class="dt-param-del" title="Remove row">${icon('x',13,2.2)}</button>`;row.querySelector('.dt-param-del').addEventListener('click',()=>row.remove());row.querySelector('.dt-param-dup').addEventListener('click',()=>{const k=row.querySelector('[data-role=key]').value;const v=row.querySelector('[data-role=val]').value;const newRow=row.cloneNode(true);newRow.querySelector('[data-role=key]').value=k;newRow.querySelector('[data-role=val]').value=v;newRow.querySelector('.dt-param-del').addEventListener('click',()=>newRow.remove());newRow.querySelector('.dt-param-dup').addEventListener('click',function(){const k2=newRow.querySelector('[data-role=key]').value;const v2=newRow.querySelector('[data-role=val]').value;addParamRow(listId,k2,v2);});row.after(newRow);});list.appendChild(row); }
  // Suggested rows are excluded — they're inert until the user clicks "+ Add".
  function buildEditedUrl(originalUrl,listId) { try{const u=new URL(originalUrl.startsWith('http')?originalUrl:'https://x.com'+originalUrl);u.search='';document.querySelectorAll(`#${listId} .dt-param-row:not(.dt-param-row-suggested)`).forEach(r=>{const k=r.querySelector('[data-role=key]').value.trim(),v=r.querySelector('[data-role=val]').value;if(k)u.searchParams.append(k,v);});return originalUrl.startsWith('http')?u.toString():u.pathname+u.search;}catch{return originalUrl;} }

  // ─── API Docs cross-check (request interceptor) ────────────────────────────────
  // Cross-checks a pending request against whatever the API Recorder plugin has
  // already documented for that endpoint, and surfaces documented fields that
  // are missing from the current payload — greyed-out param rows for GET,
  // click-to-add chips below the editor for everything else. Purely additive:
  // if the Recorder plugin isn't installed or has no docs for this endpoint,
  // none of this renders anything.
  function addSuggestedParamRow(listId, key, val) {
    const list = $(listId);
    const row = document.createElement('div');
    row.className = 'dt-param-row dt-param-row-suggested';
    row.dataset.suggestKey = key;
    row.innerHTML = `<input class="dt-param-input" value="${escHtml(key)}" data-role="key" disabled><span class="dt-param-eq">=</span><input class="dt-param-input" value="${escHtml(val)}" data-role="val" disabled><button class="dt-param-add-suggested" title="Add to request">+ Add</button>`;
    row.querySelector('.dt-param-add-suggested').addEventListener('click', () => {
      // addParamRow always appends at the end of the list — swap the new real
      // row into the suggested row's own slot instead, so activating one
      // suggestion doesn't jump below any suggestions still pending below it.
      addParamRow(listId, key, val);
      const newRow = list.lastElementChild;
      row.replaceWith(newRow);
      const valInput = newRow.querySelector('[data-role=val]');
      valInput.focus(); valInput.select();
    });
    list.appendChild(row);
  }
  function renderParamSuggestions(listId, fields) {
    if (!fields || !fields.length) return;
    const list = $(listId);
    const existingKeys = new Set([...list.querySelectorAll('.dt-param-row:not(.dt-param-row-suggested) [data-role=key]')].map(i => i.value.trim()).filter(Boolean));
    fields.forEach(f => { if (f.key && !existingKeys.has(f.key)) addSuggestedParamRow(listId, f.key, f.value); });
  }
  // Catches a key typed (or pasted) into a real row that happens to match a
  // pending suggestion, so the same field never ends up listed twice.
  function pruneParamSuggestions(listId) {
    const list = $(listId);
    if (!list) return;
    const realKeys = new Set([...list.querySelectorAll('.dt-param-row:not(.dt-param-row-suggested) [data-role=key]')].map(i => i.value.trim()).filter(Boolean));
    list.querySelectorAll('.dt-param-row-suggested').forEach(row => { if (realKeys.has(row.dataset.suggestKey)) row.remove(); });
  }

  function getReqBodyObjectSafe() {
    try { const v = JSON.parse($('dt-req-ed').value || '{}'); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; } catch { return null; }
  }
  // Selects the value that was just inserted for `key` so the user can type
  // straight over it without hunting through the JSON for where it landed.
  function focusJsonValue(ed, key) {
    const text = ed.value;
    const re = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"\\s*:\\s*`);
    const m = re.exec(text);
    if (!m) return;
    const valStart = m.index + m[0].length;
    let valEnd = valStart, depth = 0;
    for (let i = valStart; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') { if (depth === 0) { valEnd = i; break; } depth--; }
      else if (ch === ',' && depth === 0) { valEnd = i; break; }
      valEnd = i + 1;
    }
    ed.focus();
    ed.setSelectionRange(valStart, valEnd);
    const lh = parseFloat(getComputedStyle(ed).lineHeight) || 20;
    const lines = text.slice(0, valStart).split('\n').length - 1;
    ed.scrollTop = Math.max(0, lines * lh - ed.clientHeight / 2);
  }
  function renderBodySuggestions(fields) {
    const wrap = $('dt-req-body-suggestions');
    if (!wrap) return;
    if (!fields || !fields.length) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
    const bodyObj = getReqBodyObjectSafe();
    const existingKeys = new Set(bodyObj ? Object.keys(bodyObj) : []);
    const remaining = fields.filter(f => f.key && !existingKeys.has(f.key));
    if (!remaining.length) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
    wrap.style.display = '';
    wrap.innerHTML = `<div class="dt-flabel" style="margin:8px 0 6px">Documented fields not in payload</div>`
      + `<div class="dt-body-suggestions-row">${remaining.map(f => `<button type="button" class="dt-body-suggestion-chip" data-key="${escHtml(f.key)}">${escHtml(f.key)}</button>`).join('')}</div>`;
    wrap.querySelectorAll('.dt-body-suggestion-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = remaining.find(f => f.key === btn.dataset.key);
        const ed = $('dt-req-ed');
        const obj = getReqBodyObjectSafe() || {};
        obj[field.key] = field.value;
        ed.value = JSON.stringify(obj, null, 2);
        onEditorChange('dt-req-ed', 'reqSearch');
        focusJsonValue(ed, field.key);
        renderBodySuggestions(fields);
      });
    });
  }

  // ─── Headers ─────────────────────────────────────────────────────────────────
  function populateHeaders(innerId, countId, obj, revertBtnId) {
    const inner=$(innerId), count=$(countId);
    inner.innerHTML='';
    const entries=Object.entries(obj||{});
    entries.forEach(([k,v])=>{
      const row=document.createElement('div');
      row.className='dt-header-row dt-header-row-edit';
      row.innerHTML=`
        <input class="dt-hkey-input" value="${escHtml(k)}" spellcheck="false" placeholder="Header name">
        <input class="dt-hval-input" value="${escHtml(v)}" spellcheck="false" placeholder="Value">
        <button class="dt-hrow-del" title="Remove header">
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.7"><line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/></svg>
        </button>
      `;
      const markChanged = () => { if(revertBtnId) $(revertBtnId) && ($(revertBtnId).style.display=''); };
      row.querySelector('.dt-hkey-input').addEventListener('input', markChanged);
      row.querySelector('.dt-hval-input').addEventListener('input', markChanged);
      row.querySelector('.dt-hrow-del').addEventListener('click', () => { row.remove(); if(count) count.textContent=inner.querySelectorAll('.dt-header-row').length||''; markChanged(); });
      inner.appendChild(row);
    });
    // Add row button
    const addRow = document.createElement('button');
    addRow.className='dt-hadd-btn';
    addRow.innerHTML=`<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.7"><line x1="5" y1="1" x2="5" y2="9"/><line x1="1" y1="5" x2="9" y2="5"/></svg> Add header`;
    addRow.addEventListener('click', () => {
      const row=document.createElement('div');
      row.className='dt-header-row dt-header-row-edit';
      row.innerHTML=`<input class="dt-hkey-input" spellcheck="false" placeholder="Header name"><input class="dt-hval-input" spellcheck="false" placeholder="Value"><button class="dt-hrow-del" title="Remove"><svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.7"><line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/></svg></button>`;
      row.querySelector('.dt-hrow-del').addEventListener('click', () => { row.remove(); if(count) count.textContent=inner.querySelectorAll('.dt-header-row').length||''; });
      inner.insertBefore(row, addRow);
      row.querySelector('.dt-hkey-input').focus();
      if(revertBtnId) $(revertBtnId) && ($(revertBtnId).style.display='');
    });
    inner.appendChild(addRow);
    if(count) count.textContent=entries.length||'';
    if(revertBtnId) $(revertBtnId) && ($(revertBtnId).style.display='none');
  }

  function collectHeaders(innerId) {
    const headers={};
    document.querySelectorAll(`#${innerId} .dt-header-row-edit`).forEach(row => {
      const k=row.querySelector('.dt-hkey-input')?.value.trim();
      const v=row.querySelector('.dt-hval-input')?.value??'';
      if(k) headers[k]=v;
    });
    return headers;
  }

  // ─── Response tree (GUI) ──────────────────────────────────────────────────────
  let currentResPath = [];
  function buildResTree(bodyStr) {
    const tree=$('dt-res-tree'); if(!tree) return;
    tree.innerHTML=''; currentResPath=[];
    $('dt-res-path-display').textContent='—';
    let data; try{data=JSON.parse(bodyStr);}catch{tree.textContent='(not valid JSON)';return;}
    renderNode(tree,data,[],0);
  }
  function renderNode(container,val,path,depth) {
    if(typeof val!=='object'||val===null||Array.isArray(val)&&val.length===0){container.appendChild(makeTreeNode(path,depth,path[path.length-1],val,typeof val));return;}
    const entries=Array.isArray(val)?val.map((v,i)=>[i,v]):Object.entries(val);
    entries.slice(0,80).forEach(([k,v])=>{
      const isObj=typeof v==='object'&&v!==null;
      const childPath=[...path,String(k)];
      const node=makeTreeNode(childPath,depth,k,v,isObj?(Array.isArray(v)?'array':'object'):(typeof v));
      container.appendChild(node);
      if(isObj){
        const children=document.createElement('div');children.style.display='none';node._children=children;node._expanded=false;
        const arrow=node.querySelector('.dt-tree-arrow');if(arrow)arrow.textContent='▶';
        node.addEventListener('click',e=>{e.stopPropagation();selectPath(childPath);if(!node._expanded){renderNode(children,v,childPath,depth+1);node._expanded=true;}children.style.display=children.style.display==='none'?'block':'none';if(arrow)arrow.textContent=children.style.display==='none'?'▶':'▼';});
        container.appendChild(children);
      }else{node.addEventListener('click',e=>{e.stopPropagation();selectPath(childPath);});}
    });
    if(Array.isArray(val)&&val.length>80){const more=document.createElement('div');more.className='dt-tree-node';more.style.color='var(--fa)';more.style.paddingLeft=(depth*14+4)+'px';more.textContent=`… +${val.length-80} more`;container.appendChild(more);}
  }
  function makeTreeNode(path,depth,key,val,type){const node=document.createElement('div');node.className='dt-tree-node';node.style.paddingLeft=(depth*14+4)+'px';const preview=type==='object'?'{…}':type==='array'?`[${val.length}]`:String(val).slice(0,24)+(String(val).length>24?'…':'');node.innerHTML=`<span class="dt-tree-arrow" style="width:10px;flex-shrink:0"></span><span class="dt-tree-key">${escHtml(String(key))}</span><span class="dt-tree-type">${type}</span><span class="dt-tree-val">${escHtml(preview)}</span>`;return node;}
  function selectPath(path){currentResPath=path;const display=$('dt-res-path-display');if(display)display.textContent='data.'+path.join('.');document.querySelectorAll('.dt-tree-node').forEach(n=>n.classList.remove('selected'));}
  function getByPath(obj,pathStr){if(!pathStr||pathStr==='—')return obj;const parts=pathStr.replace(/^data\./,'').split('.');let cur=obj;for(const p of parts){if(cur===null||cur===undefined)return undefined;cur=cur[p];}return cur;}

  // ─── Presets management ───────────────────────────────────────────────────────
  function syncAutoTransformUI() {
    const atToggle = $('dt-res-auto-transform');
    if (atToggle) atToggle.checked = state.res.autoTransform;
    const hint = $('dt-res-auto-transform-hint');
    if (hint) {
      const activeCount = state.resPresets.filter(p => p.enabled !== false).length;
      hint.textContent = state.res.autoTransform
        ? (activeCount ? `${activeCount} preset${activeCount!==1?'s':''} active — responses won't show modal` : 'No active presets — modal will still show')
        : 'Off — intercept modal will always open';
      hint.className = 'dt-row-sub dt-at-hint' + (state.res.autoTransform && activeCount ? ' on' : '');
    }
  }

  // ─── Preset save/edit panel ───────────────────────────────────────────────────
  let _editingPresetIdx = null; // null = new, number = editing

  function stripQueryParams(url) {
    try { const u = new URL(url); u.search = ''; u.hash = ''; return u.toString(); } catch { return url.split('?')[0]; }
  }

  function openPresetEditor(idx) {
    _editingPresetIdx = idx;
    const isNew = idx === null;
    const p = isNew ? null : state.resPresets[idx];

    $('dt-pe-title') && ($('dt-pe-title').textContent = isNew ? 'Save Preset' : 'Edit Preset');
    $('dt-pe-name').value = p ? p.name : 'My Transform';

    const patterns = p && p.urlPatterns && p.urlPatterns.length
      ? p.urlPatterns
      : (isNew && state.currentRes ? [stripQueryParams(state.currentRes.url)] : ['']);
    renderPatternRows(patterns);

    $('dt-presets-list-view').style.display = 'none';
    $('dt-preset-editor-view').style.display = '';
    $('dt-presets-foot-list').style.display = 'none';
    $('dt-presets-foot-editor').style.display = '';
    $('dt-presets-modal-title').textContent = isNew ? 'Save Preset' : 'Edit Preset';
    $('dt-pe-save').textContent = isNew ? 'Save Preset' : 'Save Changes';
    setTimeout(() => $('dt-pe-name').focus(), 50);
  }

  function closePresetEditor() {
    $('dt-presets-list-view').style.display = '';
    $('dt-preset-editor-view').style.display = 'none';
    $('dt-presets-foot-list').style.display = '';
    $('dt-presets-foot-editor').style.display = 'none';
    $('dt-presets-modal-title').textContent = 'Response Transform Presets';
    _editingPresetIdx = null;
    // Show load hint if there are presets
    const hint = $('dt-preset-load-hint');
    if (hint) hint.style.display = state.resPresets.length ? '' : 'none';
  }

  function renderPatternRows(patterns) {
    const list = $('dt-pe-patterns');
    list.innerHTML = '';
    (patterns.length ? patterns : ['']).forEach(pat => addPatternRow(pat));
  }

  // Shared builder for a single regex-pattern row (a live-validated /…/ input
  // with a remove button). Both the full presets editor (#dt-pe-patterns) and
  // the mini save-preset overlay (#dt-spe-patterns) use it via the thin wrappers
  // below — the only difference between them was the target list id.
  function buildPatternRow(listId, value) {
    const list = $(listId);
    const row = document.createElement('div');
    row.className = 'dt-pe-pattern-row';
    row.innerHTML = `
      <span class="dt-regex-delim">/</span>
      <input class="dt-regex-input dt-pe-pattern-input" type="text" placeholder="api\\/v\\d+\\/.*" spellcheck="false" value="${escHtml(value||'')}">
      <span class="dt-regex-delim">/</span>
      <div class="dt-pe-pattern-dot"></div>
      <button class="dt-pe-pattern-remove" title="Remove">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg>
      </button>
    `;
    const input = row.querySelector('.dt-pe-pattern-input');
    const dot = row.querySelector('.dt-pe-pattern-dot');
    input.addEventListener('input', () => {
      const v = input.value.trim();
      if (!v) { dot.className = 'dt-pe-pattern-dot'; return; }
      try { new RegExp(v); dot.className = 'dt-pe-pattern-dot valid'; }
      catch { dot.className = 'dt-pe-pattern-dot invalid'; }
    });
    // Trigger initial dot state
    if (value) input.dispatchEvent(new Event('input'));
    row.querySelector('.dt-pe-pattern-remove').addEventListener('click', () => {
      if (list.querySelectorAll('.dt-pe-pattern-row').length > 1) row.remove();
      else input.value = '';
    });
    list.appendChild(row);
  }
  function addPatternRow(value) { buildPatternRow('dt-pe-patterns', value); }

  function collectPatterns() {
    return [...$('dt-pe-patterns').querySelectorAll('.dt-pe-pattern-input')]
      .map(i => i.value.trim()).filter(Boolean);
  }

  function commitPresetEditor() {
    const name = $('dt-pe-name').value.trim();
    if (!name) { $('dt-pe-name').focus(); return; }

    const patterns = collectPatterns();
    // Validate all patterns
    for (const pat of patterns) {
      try { new RegExp(pat); } catch(e) { alert(`Invalid regex: ${pat}\n${e.message}`); return; }
    }

    const isNew = _editingPresetIdx === null;
    if (isNew) {
      const code = $('dt-res-code-editor') ? $('dt-res-code-editor').value.trim() : '';
      if (!code) { alert('No transform code to save. Write code in the JS Transform tab first.'); return; }
      const preset = { id: Date.now(), name, type: 'code', code, urlPatterns: patterns, enabled: true };
      state.resPresets.push(preset);
    } else {
      const p = state.resPresets[_editingPresetIdx];
      p.name = name;
      p.urlPatterns = patterns;
    }

    Store.set('res.presets', state.resPresets);
    closePresetEditor();
    renderPresetsList();
    syncAutoTransformUI();
  }

  function openPresetsModal() { $('dt-presets-overlay').classList.add('visible'); closePresetEditor(); renderPresetsList(); }
  function closePresetsModal() { $('dt-presets-overlay').classList.remove('visible'); closePresetEditor(); }

  function renderPresetsList() {
    const list = $('dt-presets-list'), empty = $('dt-presets-empty');
    list.innerHTML = '';
    if (state.resPresets.length === 0) { empty.style.display='block'; return; }
    empty.style.display='none';
    state.resPresets.forEach((p, idx) => {
      const isEnabled = p.enabled !== false;
      const item = document.createElement('div');
      item.className = 'dt-preset-item' + (isEnabled ? '' : ' dt-preset-disabled');
      const typeLabel = p.type === 'code' ? 'JS Transform' : p.type === 'gui' ? 'GUI Extract' : 'Manual Edit';
      const patternDesc = p.urlPatterns && p.urlPatterns.length
        ? p.urlPatterns.map(r => `/${r}/`).join(', ')
        : (p.urlRegex ? `/${p.urlRegex}/` : 'All URLs');
      item.innerHTML = `
        <label class="dt-toggle dt-preset-toggle" title="${isEnabled?'Enabled':'Disabled'}">
          <input type="checkbox" class="dt-preset-enabled-chk" ${isEnabled?'checked':''}>
          <div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div>
        </label>
        <div class="dt-preset-info">
          <div class="dt-preset-name">${escHtml(p.name)}</div>
          <div class="dt-preset-desc">${typeLabel} · ${escHtml(patternDesc)}</div>
        </div>
        <div class="dt-preset-actions">
          <button class="dt-preset-btn load-btn" data-idx="${idx}" title="Load code into JS Transform editor">Load</button>
          <button class="dt-preset-btn edit-btn" data-idx="${idx}" title="Edit preset name & URL patterns">Edit</button>
          <button class="dt-preset-btn delete-btn delete" data-idx="${idx}">Delete</button>
        </div>
      `;
      item.querySelector('.dt-preset-enabled-chk').addEventListener('change', e => {
        state.resPresets[idx].enabled = e.target.checked;
        Store.set('res.presets', state.resPresets);
        item.classList.toggle('dt-preset-disabled', !e.target.checked);
        syncAutoTransformUI();
      });
      item.querySelector('.load-btn').addEventListener('click', () => loadPreset(idx));
      item.querySelector('.edit-btn').addEventListener('click', () => openPresetEditor(idx));
      item.querySelector('.delete-btn').addEventListener('click', () => deletePreset(idx));
      list.appendChild(item);
    });
  }

  function savePresetDialog() {
    // Show the inline save overlay — does NOT open the full presets modal
    _editingPresetIdx = null;
    const overlay = $('dt-save-preset-overlay');
    if (!overlay) return;
    $('dt-spe-name').value = 'My Transform';
    const patterns = state.currentRes ? [stripQueryParams(state.currentRes.url)] : [''];
    renderSavePresetPatterns(patterns);
    overlay.classList.add('visible');
    setTimeout(() => $('dt-spe-name').focus(), 50);
  }

  function closeSavePresetOverlay() {
    $('dt-save-preset-overlay').classList.remove('visible');
  }

  function renderSavePresetPatterns(patterns) {
    const list = $('dt-spe-patterns');
    list.innerHTML = '';
    (patterns.length ? patterns : ['']).forEach(pat => addSavePatternRow(pat));
  }

  function addSavePatternRow(value) { buildPatternRow('dt-spe-patterns', value); }

  function commitSavePreset() {
    const name = $('dt-spe-name').value.trim();
    if (!name) { $('dt-spe-name').focus(); return; }
    const patterns = [...$('dt-spe-patterns').querySelectorAll('.dt-pe-pattern-input')]
      .map(i => i.value.trim()).filter(Boolean);
    for (const pat of patterns) {
      try { new RegExp(pat); } catch(e) { alert(`Invalid regex: ${pat}\n${e.message}`); return; }
    }
    const code = $('dt-res-code-editor') ? $('dt-res-code-editor').value.trim() : '';
    if (!code) { alert('No transform code to save. Write code in the JS Transform tab first.'); return; }
    const preset = { id: Date.now(), name, type: 'code', code, urlPatterns: patterns, enabled: true };
    state.resPresets.push(preset);
    Store.set('res.presets', state.resPresets);
    syncAutoTransformUI();
    closeSavePresetOverlay();
  }

  function loadPreset(idx) {
    const p = state.resPresets[idx];
    if (!p) return;
    if (!state.currentRes) {
      alert('Load applies the preset\'s JS code into the transform editor.\nOpen a response intercept modal first, then load the preset.');
      return;
    }
    $('dt-res-code-editor').value = p.code;
    switchResTab('code');
    closePresetsModal();
    updateTransformPreview();
  }
  function deletePreset(idx) {
    if (!confirm('Delete this preset?')) return;
    state.resPresets.splice(idx, 1);
    Store.set('res.presets', state.resPresets);
    renderPresetsList();
  }
  function updateTransformPreview() {
    const origDisplay = $('dt-res-preview-original'), transDisplay = $('dt-res-preview-transformed');
    if (!origDisplay || !transDisplay) return;

    // Always show original
    const raw = (state.currentRes && state.currentRes.body) || '';
    let data;
    try { data = JSON.parse(raw); } catch { data = raw; }
    const origStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    origDisplay.textContent = origStr || '(empty)';

    const code = $('dt-res-code-editor').value;
    if (!code.trim()) {
      transDisplay.textContent = '(no transform)';
      transDisplay.style.opacity = '0.4';
      transDisplay.style.fontStyle = 'italic';
      return;
    }
    try {
      const meta = { url: state.currentRes?.url, method: state.currentRes?.method, status: state.currentRes?.status };
      const result = new Function('data', 'res', code)(data, meta);
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      transDisplay.textContent = resultStr;
      transDisplay.style.opacity = '';
      transDisplay.style.fontStyle = '';
      transDisplay.style.color = '';
    } catch(e) {
      transDisplay.textContent = 'Invalid transform: ' + e.message;
      transDisplay.style.opacity = '1';
      transDisplay.style.fontStyle = 'italic';
      transDisplay.style.color = 'var(--er, #f38ba8)';
    }
  }

  // ─── Modal helpers ────────────────────────────────────────────────────────────
  function bindModalActions(sendId, abortId, onSend, onAbort) {
    const ns = $(sendId).cloneNode(true), na = $(abortId).cloneNode(true);
    $(sendId).replaceWith(ns); $(abortId).replaceWith(na);
    ns.addEventListener('click', onSend);
    na.addEventListener('click', onAbort);
  }

  // ─── cURL helpers ────────────────────────────────────────────────────────────
  function buildCurlCommand(req, isGET, editedUrl) {
    const url = isGET ? editedUrl : req.url;
    const method = req.method;
    const headers = req.headers || {};
    let body = '';

    if (!isGET) {
      const ed = $('dt-req-ed');
      body = ed ? ed.value : '';
    }

    let curl = `curl -X ${method} '${url.replace(/'/g, "'\"'\"'")}'`;

    Object.entries(headers).forEach(([key, val]) => {
      curl += ` -H '${key.replace(/'/g, "'\"'\"'")}: ${String(val).replace(/'/g, "'\"'\"'")}'`;
    });

    if (!isGET && body) {
      curl += ` -d '${body.replace(/'/g, "'\"'\"'")}'`;
    }

    return curl;
  }

  function copyToClipboard(text, btnId) {
    const btn = $(btnId);
    const originalText = btn.textContent;
    const confirm = () => { btn.textContent = 'Copied! ✓'; setTimeout(() => { btn.textContent = originalText; }, 2000); };

    navigator.clipboard.writeText(text).then(confirm).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      confirm();
    });
  }

  // ─── Request Modal ────────────────────────────────────────────────────────────
  function showReqModal(req) {
    const ov=$('dt-req-overlay');
    $('dt-req-url').textContent=req.url;
    const mt=$('dt-req-method');mt.textContent=req.method;mt.className=`dt-method-tag ${req.method}`;
    const isGET=req.method==='GET';
    // API Recorder docs for this endpoint (if any) — used below to surface
    // documented fields missing from the current payload.
    const recorderPlugin = plugins.find(p => p.id === 'recorder');
    const docSuggestions = recorderPlugin && recorderPlugin.getRequestSuggestions ? recorderPlugin.getRequestSuggestions(req.url, req.method) : null;
    state._lastReqDocSuggestions = docSuggestions;
    // Hoisted out of the else-branch below: the Revert handler further down
    // closes over `body`, and a block-scoped `let` inside the branch left it
    // out of scope there — clicking Revert threw a ReferenceError.
    let body = req.body || '';
    try { body = JSON.stringify(JSON.parse(body), null, 2); } catch {}
    if(isGET){
      $('dt-req-editor-section').style.display='none';$('dt-req-params-section').style.display='flex';$('dt-req-params-list').innerHTML='';
      try{const u=new URL(req.url.startsWith('http')?req.url:'https://x.com'+req.url);u.searchParams.forEach((v,k)=>addParamRow('dt-req-params-list',k,v));}catch{addParamRow('dt-req-params-list','','');}
      if (docSuggestions) renderParamSuggestions('dt-req-params-list', docSuggestions.query);
    }else{
      $('dt-req-editor-section').style.display='flex';$('dt-req-params-section').style.display='none';
      $('dt-req-ed').value=body;updateBadge('dt-req-ed');renderHL('dt-req-ed','reqSearch','');
      renderBodySuggestions(docSuggestions ? docSuggestions.body : null);
    }
    // Show/hide cURL button: only useful for POST/PUT/PATCH where the editor is visible
    const curlBtn = $('dt-req-copy-curl');
    if (curlBtn) curlBtn.style.display = isGET ? 'none' : '';

    populateHeaders('dt-req-hinner','dt-req-hcount',req.headers,'dt-req-hrevert');
    // Body revert
    const reqRevert=$('dt-req-ed-revert');
    if(reqRevert){reqRevert.onclick=()=>{$('dt-req-ed').value=body;updateBadge('dt-req-ed');renderHL('dt-req-ed','reqSearch','');};}
    // Header revert
    const reqHRevert=$('dt-req-hrevert');
    if(reqHRevert){reqHRevert.onclick=(e)=>{e.stopPropagation();populateHeaders('dt-req-hinner','dt-req-hcount',req.headers,'dt-req-hrevert');};}
    $('dt-req-count').textContent=`${state.pendingReqs.indexOf(req)+1} of ${state.pendingReqs.length}`;
    ov.classList.add('visible');
    bindModalActions('dt-req-send','dt-req-abort',
      () => { ov.classList.remove('visible');removeFromQueue('pendingReqs',req);const editedHeaders=collectHeaders('dt-req-hinner');if(isGET)req.resolve({editedUrl:buildEditedUrl(req.url,'dt-req-params-list'),editedHeaders});else req.resolve({editedBody:$('dt-req-ed').value,editedHeaders});if(state.pendingReqs.length>0)showReqModal(state.pendingReqs[0]); },
      () => { ov.classList.remove('visible');removeFromQueue('pendingReqs',req);req.reject(new DOMException('Aborted by DevTools','AbortError'));if(state.pendingReqs.length>0)showReqModal(state.pendingReqs[0]); }
    );
    // Skip — pass original through unmodified
    const skipBtn = $('dt-req-skip');
    if (skipBtn) {
      const newSkip = skipBtn.cloneNode(true);
      skipBtn.replaceWith(newSkip);
      newSkip.addEventListener('click', () => {
        ov.classList.remove('visible');
        removeFromQueue('pendingReqs', req);
        if (isGET) req.resolve({ editedUrl: req.url, editedHeaders: req.headers });
        else req.resolve({ editedBody: req.body, editedHeaders: req.headers });
        if (state.pendingReqs.length > 0) showReqModal(state.pendingReqs[0]);
      });
    }
    // Skip All — disable intercept and pass through everything
    const skipAllBtn = $('dt-req-skip-all');
    if (skipAllBtn) {
      const newSkipAll = skipAllBtn.cloneNode(true);
      skipAllBtn.replaceWith(newSkipAll);
      newSkipAll.addEventListener('click', () => {
        // Drain queue: resolve all with original
        const queue = [...state.pendingReqs];
        state.pendingReqs = [];
        queue.forEach(r => {
          const rIsGET = r.method === 'GET';
          if (rIsGET) r.resolve({ editedUrl: r.url, editedHeaders: r.headers });
          else r.resolve({ editedBody: r.body, editedHeaders: r.headers });
        });
        // Disable request interceptor
        state.req.enabled = false;
        if (state.req.persist) Store.set('req.enabled', false);
        syncNetworkPanel();
        ov.classList.remove('visible');
        updateQueueUI('req');
      });
    }

    if (curlBtn) {
      curlBtn.removeEventListener('click', curlBtn._clickHandler);
      curlBtn._clickHandler = () => {
        const editedUrl = isGET ? buildEditedUrl(req.url, 'dt-req-params-list') : req.url;
        copyToClipboard(buildCurlCommand(req, isGET, editedUrl), 'dt-req-copy-curl');
      };
      curlBtn.addEventListener('click', curlBtn._clickHandler);
    }
  }

  // ─── Response Modal ───────────────────────────────────────────────────────────
  function showResModal(res) {
    const ov=$('dt-res-overlay');
    state.currentRes=res;
    $('dt-res-url').textContent=res.url;
    const mt=$('dt-res-method');mt.textContent=res.method;mt.className=`dt-method-tag ${res.method}`;
    const cls=res.status>=200&&res.status<300?'ok':res.status>=400?'err':'oth';
    $('dt-res-status-bar').innerHTML=`<div class="dt-res-status ${cls}"><span class="dt-res-status-code">${res.status}</span><span class="dt-res-status-text"> ${res.statusText||''}</span></div>`;
    switchResTab('manual');
    $('dt-res-transform-err').className='dt-transform-err';
    $('dt-res-wrap-key').style.display='none';
    let body=res.body||'';try{body=JSON.stringify(JSON.parse(body),null,2);}catch{}
    $('dt-res-ed').value=body;updateBadge('dt-res-ed');renderHL('dt-res-ed','resSearch','');
    populateHeaders('dt-res-hinner','dt-res-hcount',res.headers,'dt-res-hrevert');
    // Body revert
    const resRevert=$('dt-res-ed-revert');
    if(resRevert){resRevert.onclick=()=>{let b=res.body||'';try{b=JSON.stringify(JSON.parse(b),null,2);}catch{}$('dt-res-ed').value=b;updateBadge('dt-res-ed');renderHL('dt-res-ed','resSearch','');};}
    // Header revert
    const resHRevert=$('dt-res-hrevert');
    if(resHRevert){resHRevert.onclick=(e)=>{e.stopPropagation();populateHeaders('dt-res-hinner','dt-res-hcount',res.headers,'dt-res-hrevert');};}
    $('dt-res-count').textContent=`${state.pendingRes.indexOf(res)+1} of ${state.pendingRes.length}`;
    updateTransformPreview();
    ov.classList.add('visible');
    bindModalActions('dt-res-send','dt-res-abort',
      () => { ov.classList.remove('visible');removeFromQueue('pendingRes',res);res.resolve($('dt-res-ed').value);if(state.pendingRes.length>0)showResModal(state.pendingRes[0]); },
      () => { ov.classList.remove('visible');removeFromQueue('pendingRes',res);res.resolve(res.body);if(state.pendingRes.length>0)showResModal(state.pendingRes[0]); }
    );
  }

  function removeFromQueue(key,item) { const i=state[key].indexOf(item);if(i!==-1)state[key].splice(i,1);updateQueueUI(key==='pendingReqs'?'req':'res'); }
  // Escapes quotes too — escHtml output is routinely interpolated into HTML
  // ATTRIBUTES (value="...", title="...") with network-derived strings; a `"`
  // in a captured URL/header would otherwise break out of the attribute and
  // allow attribute injection into this (privileged) userscript's UI.
  function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  // Shared by Monitor (here) and the Recorder plugin (via ctx) for the
  // labeled "headers/body" detail blocks both panels render.
  function schemaBlock(label, contentHtml) {
    return `<div class="dt-rec-schema-block"><div class="dt-rec-schema-label">${escHtml(label)}</div><div class="dt-rec-schema-pre">${contentHtml}</div></div>`;
  }
  // Shared by the Base URL plugin and the Recorder plugin (via ctx) — kept
  // here (rather than living in Devtools_baseurl.js) because ctx is built
  // once before any plugin factory runs, so a plugin can't hand a function
  // to ctx in time for other plugins in that same registration pass to use.
  function getGroupHosts(group) {
    const hosts = new Set();
    (group.entries || []).forEach(e => {
      if (!e.url) return;
      try {
        const u = new URL(e.url.includes('://') ? e.url : 'http://' + e.url);
        hosts.add(u.host);
      } catch {}
    });
    return hosts;
  }

  // ─── Intercept checks ─────────────────────────────────────────────────────────
  function shouldIntercept(ns,url,method){
    // Plugins can veto interception entirely (e.g. Bench, while a benchmark run
    // is in flight — its own fetch calls must never be edited/queued).
    if (plugins.some(p => p.suppressIntercept && p.suppressIntercept())) return false;
    const s=state[ns];if(!s.enabled)return false;if(!s.methods.includes(method.toUpperCase()))return false;if(s.mode==='manual'&&s.urlRegex){try{return new RegExp(s.urlRegex).test(url);}catch{return false;}}return true;
  }
  function shouldInterceptReq(url,method){return shouldIntercept('req',url,method);}
  function shouldInterceptRes(url,method){return shouldIntercept('res',url,method);}

  // ─── Keyboard shortcuts (quick intercept toggles) ─────────────────────────────
  // Each entry is a hotkey the user can trigger from anywhere on the page. The
  // labels/hints are reused verbatim by the Settings > Keyboard Shortcuts UI.
  const KEYBIND_DEFS = [
    { id:'toggleBoth',    label:'Toggle Intercept (Request + Response)', def:'Alt+Q' },
    { id:'toggleReq',     label:'Toggle Request Intercept',              def:'Alt+W' },
    { id:'toggleRes',     label:'Toggle Response Intercept',             def:'Alt+A' },
    // Momentary: interception is forced on only while the combo is held down,
    // then reverts — the enable toggles are never changed. See beginHold/endHold.
    { id:'holdIntercept', label:'Hold to Intercept',                     def:'Alt+S', hold:true },
  ];

  // Physical-key name for a KeyboardEvent, derived from e.code so the combo is
  // stable across layouts and unaffected by Alt producing special characters
  // (e.g. Alt+I emits a dead key on some layouts, but e.code stays "KeyI").
  function keyNameFromEvent(e) {
    const c = e.code || '';
    if (/^Key[A-Z]$/.test(c))    return c.slice(3);          // KeyI  -> I
    if (/^Digit\d$/.test(c))     return c.slice(5);          // Digit1 -> 1
    if (/^Numpad\d$/.test(c))    return 'Num' + c.slice(6);  // Numpad1 -> Num1
    if (/^F\d{1,2}$/.test(c))    return c;                   // F1..F12
    if (c === 'Space')           return 'Space';
    if (c === 'Enter')           return 'Enter';
    if (c === 'Backslash')       return '\\';
    if (c === 'Slash')           return '/';
    if (c.startsWith('Arrow'))   return c;                   // ArrowUp, ...
    // Fall back to the logical key for anything we don't special-case.
    const k = e.key || '';
    return k.length === 1 ? k.toUpperCase() : k;
  }

  // Build a normalized combo string ("Alt+Shift+I") from an event. Returns null
  // if only modifier keys are held (nothing to bind yet).
  function comboFromEvent(e) {
    const key = e.key;
    if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return null;
    const parts = [];
    if (e.ctrlKey)  parts.push('Ctrl');
    if (e.altKey)   parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey)  parts.push('Meta');
    parts.push(keyNameFromEvent(e));
    return parts.join('+');
  }

  // Apply an interceptor on/off. "Temporary" by default: the flag only persists
  // to storage when that namespace's Persist toggle is on — mirroring how the
  // Network panel's own enable checkbox behaves.
  function setInterceptorEnabled(ns, on) {
    state[ns].enabled = on;
    if (state[ns].persist) Store.set(ns + '.enabled', on);
    syncNetworkPanel();
  }

  function runKeybind(id) {
    if (id === 'toggleReq') {
      setInterceptorEnabled('req', !state.req.enabled);
      showInterceptToast(`Request intercept ${state.req.enabled ? 'ON' : 'OFF'}`, state.req.enabled);
    } else if (id === 'toggleRes') {
      setInterceptorEnabled('res', !state.res.enabled);
      showInterceptToast(`Response intercept ${state.res.enabled ? 'ON' : 'OFF'}`, state.res.enabled);
    } else if (id === 'toggleBoth') {
      // If either side is currently on, turn both off; otherwise turn both on.
      const turnOn = !(state.req.enabled || state.res.enabled);
      setInterceptorEnabled('req', turnOn);
      setInterceptorEnabled('res', turnOn);
      showInterceptToast(`Intercept ${turnOn ? 'ON' : 'OFF'} · Request + Response`, turnOn);
    }
  }

  // ── Momentary "hold to intercept" ─────────────────────────────────────────────
  // While held, force BOTH interceptors on without persisting; on release, put
  // enabled flags back exactly as they were. Triggered by a hold-type keybind
  // (key held down) or by pressing-and-holding the Network panel's Hold button.
  let _holdState = null; // { prevReq, prevRes, comboParts:[] } while active
  function beginHold(comboParts) {
    if (_holdState) return; // already holding (keydown auto-repeat, or button)
    _holdState = { prevReq: state.req.enabled, prevRes: state.res.enabled, comboParts: comboParts || [] };
    state.req.enabled = true;
    state.res.enabled = true;
    syncNetworkPanel(); // NOTE: no Store.set — the hold must never persist
    showInterceptToast('Hold intercept · Request + Response', true);
    const btn = $('dt-hold-intercept'); if (btn) btn.classList.add('holding');
  }
  function endHold() {
    if (!_holdState) return;
    state.req.enabled = _holdState.prevReq;
    state.res.enabled = _holdState.prevRes;
    _holdState = null;
    syncNetworkPanel();
    showInterceptToast('Hold released', false);
    const btn = $('dt-hold-intercept'); if (btn) btn.classList.remove('holding');
  }
  // Normalized name of the key released in a keyup (modifiers included), so we
  // can tell when any part of the held chord has been let go.
  function releasedKeyName(e) {
    if (e.key === 'Control') return 'Ctrl';
    if (e.key === 'Alt')     return 'Alt';
    if (e.key === 'Shift')   return 'Shift';
    if (e.key === 'Meta')    return 'Meta';
    return keyNameFromEvent(e);
  }

  function handleGlobalHotkey(e) {
    // While the settings UI is recording a new combo, its own capture handler
    // owns the keyboard — don't also fire the (possibly matching) live binding.
    if (state._captureKeybind) return;
    const combo = comboFromEvent(e);
    if (!combo) return;
    for (const def of KEYBIND_DEFS) {
      if (!state.keybinds[def.id] || state.keybinds[def.id] !== combo) continue;
      e.preventDefault();
      e.stopPropagation();
      // beginHold() self-guards against keydown auto-repeat; toggles must ignore
      // it explicitly, or holding the key would flip the state on every repeat.
      if (def.hold) beginHold(combo.split('+'));
      else if (!e.repeat) runKeybind(def.id);
      return;
    }
  }
  // Releasing ANY key that's part of the held chord ends the momentary hold.
  function handleGlobalHotkeyUp(e) {
    if (!_holdState) return;
    if (_holdState.comboParts.includes(releasedKeyName(e))) endHold();
  }

  // ─── Toast (hotkey feedback) ──────────────────────────────────────────────────
  // Self-contained colors (not theme tokens) so it reads on any host page. Kept
  // out of #dt-sidebar because that element carries a transform and can sit
  // off-screen; the toast lives at the document root instead.
  let _toastEl = null, _toastTimer = null;
  function showInterceptToast(msg, on) {
    if (!_toastEl) {
      _toastEl = document.createElement('div');
      _toastEl.id = 'dt-hotkey-toast';
      document.documentElement.appendChild(_toastEl);
    }
    _toastEl.innerHTML = `<span class="dt-hotkey-toast-dot${on ? ' on' : ''}"></span>${escHtml(msg)}`;
    _toastEl.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => _toastEl.classList.remove('show'), 1600);
  }

  function queueReq(url,method,headers,body){return new Promise((resolve,reject)=>{const req={url,method,headers,body,resolve,reject};state.pendingReqs.push(req);updateQueueUI('req');if(state.pendingReqs.length===1)showReqModal(req);});}
  function tryAutoTransform(url, body) {
    if (!state.res.autoTransform) return null;
    const active = state.resPresets.filter(p => p.enabled !== false);
    if (!active.length) return null;
    const cleanUrl = url.split('?')[0];
    const preset = active.find(p => {
      const patterns = p.urlPatterns && p.urlPatterns.length ? p.urlPatterns
        : (p.urlRegex ? [p.urlRegex] : []);
      if (!patterns.length) return true; // no patterns = match all
      return patterns.some(pat => { try { return new RegExp(pat).test(cleanUrl); } catch { return false; } });
    });
    if (!preset || !preset.code) return null;
    try {
      let data; try { data = JSON.parse(body); } catch { data = body; }
      const result = new Function('data', 'res', preset.code)(data, {});
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch(e) {
      console.warn('[DevTools] Auto-transform failed:', e);
      return null;
    }
  }

  function queueRes(url,method,status,statusText,headers,body){
    const auto = tryAutoTransform(url, body);
    if (auto !== null) return Promise.resolve(auto);
    return new Promise(resolve=>{const res={url,method,status,statusText,headers,body,resolve};state.pendingRes.push(res);updateQueueUI('res');if(state.pendingRes.length===1)showResModal(res);});
  }

  // ─── Patch fetch (robust with re-patching) ────────────────────────────────────
  let _fetch = null;
  function setupFetchPatch() {
    if (!realWindow.fetch) return; // fetch not available yet
    // Already our patched fetch — nothing to do. Re-wrapping fetch every tick
    // (even with an identical implementation) trips bot-management scripts
    // (e.g. Cloudflare) that watch for repeated fetch reassignment as a
    // tamper signal, causing endless challenge/verification loops.
    if (realWindow.fetch._dt_patched) return;
    // Only capture the native fetch if we haven't patched yet, or if the current
    // window.fetch is not our patched version (e.g. another script replaced it).
    // Never overwrite _fetch with our own wrapper — that causes infinite recursion.
    // Bind to the real window: _fetch is called detached (`_fetch(url)`), and an
    // unbound native fetch throws "TypeError: Illegal invocation" in some browsers.
    if (!_fetch || !realWindow.fetch._dt_patched) _fetch = realWindow.fetch.bind(realWindow);
    try {
      const patchedFetch = async function(input, init = {}) {
          const reqStart = performance.now();
          const isReqObj = input instanceof realWindow.Request;
          const url = typeof input === 'string' ? input : (input?.url || '');
          const method = ((init.method || (isReqObj ? input.method : 'GET')) || 'GET').toUpperCase();
          let actualUrl = url, actualInit = init, intercepted = false;
          if (shouldInterceptReq(url, method)) {
            intercepted = true;
            let body = init.body;
            if (!body && isReqObj) { try { body = await input.clone().text(); } catch {} }
            if (body instanceof realWindow.Blob) { try { body = await body.text(); } catch {} }
            if (body instanceof realWindow.ArrayBuffer) body = new realWindow.TextDecoder().decode(body);
            let headers = {};
            if (init.headers instanceof realWindow.Headers) init.headers.forEach((v, k) => headers[k] = v);
            else if (init.headers) headers = { ...init.headers };
            else if (isReqObj) input.headers.forEach((v, k) => headers[k] = v);
            const result = await queueReq(url, method, headers, body || '');
            // result.editedHeaders MUST be applied here — previously both
            // branches rebuilt actualInit without them, so header edits made
            // in the intercept modal were silently discarded.
            if (method === 'GET' && result.editedUrl) { actualUrl = result.editedUrl; const gi = { ...init, method: 'GET', headers: result.editedHeaders || headers }; delete gi.body; actualInit = gi; }
            else { actualInit = { ...init, method, headers: result.editedHeaders || headers, body: result.editedBody ?? body }; }
          }

          // CRITICAL: when interception never touched this request (the default,
          // most-common case — including EVERY request when the feature is
          // toggled off), pass `input`/`init` straight through completely
          // unmodified. Previously this unconditionally rebuilt `fetch(requestObj)`
          // calls as `new Request(url, {})`, silently dropping the original
          // Request's headers, credentials, body, and mode — breaking auth
          // (401s) and other behavior on any site using that pattern, regardless
          // of whether any interceptor was even enabled.
          let rawInput, fetchInit;
          if (!intercepted) {
            rawInput = input;
            fetchInit = isReqObj ? undefined : init;
          } else if (isReqObj) {
            // Interception ran — rebuild the Request, but preserve every property
            // of the ORIGINAL request we're not intentionally changing (headers,
            // credentials, mode, cache, etc.) instead of dropping them to defaults.
            const finalMethod = (actualInit.method || input.method || 'GET').toUpperCase();
            const reqInit = {
              method: finalMethod,
              headers: actualInit.headers || input.headers,
              credentials: input.credentials,
              mode: input.mode === 'navigate' ? 'same-origin' : input.mode, // 'navigate' is invalid here
              cache: input.cache,
              redirect: input.redirect,
              referrer: input.referrer,
              referrerPolicy: input.referrerPolicy,
              integrity: input.integrity,
              keepalive: input.keepalive,
              signal: input.signal,
            };
            if (finalMethod !== 'GET' && finalMethod !== 'HEAD' && actualInit.body !== undefined) reqInit.body = actualInit.body;
            try { rawInput = new realWindow.Request(actualUrl, reqInit); }
            catch { rawInput = new realWindow.Request(actualUrl, { method: finalMethod, headers: reqInit.headers, body: reqInit.body }); }
            fetchInit = undefined;
          } else {
            rawInput = actualUrl;
            fetchInit = actualInit;
          }
          const response = await _fetch(rawInput, fetchInit);
          // Plugin capture (Bench, Recorder, Monitor, ...) — extract request headers properly
          const capturingPlugins = plugins.filter(p => p.wantsCapture && p.wantsCapture(url, method));
          if (capturingPlugins.length) {
            const capHeaders = {};
            if (actualInit.headers instanceof realWindow.Headers) actualInit.headers.forEach((v,k)=>capHeaders[k]=v);
            else if (actualInit.headers && typeof actualInit.headers === 'object') Object.assign(capHeaders, actualInit.headers);
            else if (isReqObj) input.headers.forEach((v,k)=>capHeaders[k]=v);
            const capBody = typeof actualInit.body === 'string' ? actualInit.body : '';
            const capDuration = Math.round(performance.now() - reqStart);
            const capClone = response.clone();
            // Fire-and-forget: capture is observational, so don't hold the
            // page's response hostage while the clone's body downloads — and
            // read the body/headers ONCE, not once per capturing plugin.
            (async () => {
              const resHeaders = {}; response.headers.forEach((v,k)=>resHeaders[k]=v);
              let resBody = ''; try { resBody = await capClone.text(); } catch {}
              for (const p of capturingPlugins) {
                try { p.onResponseCapture(url, method, capHeaders, capBody, response.status, response.statusText, resHeaders, resBody, capDuration); }
                catch (e) { console.warn('[DevTools] plugin capture failed:', e); }
              }
            })();
          }
          if (shouldInterceptRes(url, method)) {
            const resHeaders = {}; response.headers.forEach((v, k) => resHeaders[k] = v);
            let resBody = ''; try { resBody = await response.clone().text(); } catch {}
            const editedBody = await queueRes(url, method, response.status, response.statusText, resHeaders, resBody);
            return new realWindow.Response(editedBody, { status: response.status, statusText: response.statusText, headers: response.headers });
          }
          return response;
      };
      patchedFetch._dt_patched = true;
      Object.defineProperty(realWindow, 'fetch', {
        value: patchedFetch,
        writable: true,
        configurable: true
      });
    } catch (e) {
      console.warn('[DevTools] Failed to patch fetch:', e);
    }
  }
  // Try to setup fetch patch immediately and on injection
  setupFetchPatch();
  // Re-patch if fetch gets redefined
  setInterval(setupFetchPatch, 1000);

  // ─── Patch XHR ───────────────────────────────────────────────────────────────
  const _open=XMLHttpRequest.prototype.open,_send=XMLHttpRequest.prototype.send,_setHdr=XMLHttpRequest.prototype.setRequestHeader;
  const _addEventListener=XMLHttpRequest.prototype.addEventListener,_removeEventListener=XMLHttpRequest.prototype.removeEventListener;

  XMLHttpRequest.prototype.open=function(m,u,...rest){this._dt_method=m;this._dt_url=u;this._dt_headers={};this._dt_res_hooked=false;this._dt_held_listeners={};this._dt_holding=false;return _open.call(this,m,u,...rest);};
  XMLHttpRequest.prototype.setRequestHeader=function(k,v){if(this._dt_headers)this._dt_headers[k]=v;return _setHdr.call(this,k,v);};

  // Override addEventListener on XHR instances that will be response-intercepted,
  // so we can hold response-related events until queueRes resolves.
  const RES_EVENTS = new Set(['readystatechange','load','loadend','progress']);
  XMLHttpRequest.prototype.addEventListener = function(type, listener, opts) {
    if (this._dt_holding && RES_EVENTS.has(type)) {
      if (!this._dt_held_listeners[type]) this._dt_held_listeners[type] = [];
      this._dt_held_listeners[type].push({ listener, opts });
      return;
    }
    return _addEventListener.call(this, type, listener, opts);
  };

  XMLHttpRequest.prototype.send=function(body){
    const method=(this._dt_method||'').toUpperCase(),url=this._dt_url||'',savedHeaders={...(this._dt_headers||{})},self=this;
    const _dtSendStart = performance.now();

    // ── Independent plugin capture (e.g. API Recorder / Monitor) ──────────────
    // Decide up front which plugins actually want THIS url/method, then attach a
    // single readystatechange listener that reads the response once and fans out
    // to them. Previously every XHR got one listener PER capture-capable plugin
    // regardless of whether any wanted the URL, and each re-parsed the response
    // headers separately — dead work on every XHR the page makes.
    const _capturers = plugins.filter(p => p.wantsCapture && p.onResponseCapture && p.wantsCapture(url, method));
    if (_capturers.length) {
      _addEventListener.call(self,'readystatechange',function pluginCaptureHandler(){
        if(self.readyState!==4)return;
        _removeEventListener.call(self,'readystatechange',pluginCaptureHandler);
        const rh={};
        try{self.getAllResponseHeaders().split('\r\n').forEach(line=>{const idx=line.indexOf(':');if(idx>0)rh[line.slice(0,idx).trim()]=line.slice(idx+1).trim();});}catch{}
        const reqBody = typeof body==='string'?body:'';
        const dur = Math.round(performance.now() - _dtSendStart);
        for (const p of _capturers) {
          try { p.onResponseCapture(url, method, savedHeaders, reqBody, self.status, self.statusText, rh, self.responseText, dur); }
          catch(e){ console.warn('[DevTools] plugin capture failed:', e); }
        }
      });
    }

    if(shouldInterceptRes(url,method)&&!this._dt_res_hooked){
      this._dt_res_hooked=true;
      this._dt_holding=true; // intercept future addEventListener calls

      // Save and null out inline handlers
      const saved={
        onreadystatechange: self.onreadystatechange,
        onload: self.onload,
        onloadend: self.onloadend,
        onprogress: self.onprogress,
      };
      self.onreadystatechange=null; self.onload=null; self.onloadend=null; self.onprogress=null;

      // Watch for completion via a native listener registered before we set _dt_holding
      _addEventListener.call(self,'readystatechange',function nativeHandler(){
        if(self.readyState!==4)return;
        _removeEventListener.call(self,'readystatechange',nativeHandler);
        const rh={};
        self.getAllResponseHeaders().split('\r\n').forEach(line=>{const idx=line.indexOf(':');if(idx>0)rh[line.slice(0,idx).trim()]=line.slice(idx+1).trim();});

        queueRes(url,method,self.status,self.statusText,rh,self.responseText).then(editedBody=>{
          // Patch the body
          try{Object.defineProperty(self,'responseText',{get:()=>editedBody,configurable:true,enumerable:true});}catch{}
          try{Object.defineProperty(self,'response',{get:()=>editedBody,configurable:true,enumerable:true});}catch{}

          // Stop holding — future addEventListener calls go through normally
          self._dt_holding=false;

          // Replay inline handlers
          if(saved.onreadystatechange) try{saved.onreadystatechange.call(self);}catch{}
          if(saved.onload) try{saved.onload.call(self);}catch{}
          if(saved.onloadend) try{saved.onloadend.call(self);}catch{}

          // Replay held addEventListener listeners
          const held=self._dt_held_listeners||{};
          for(const [type,listeners] of Object.entries(held)){
            listeners.forEach(({listener,opts})=>{
              try{
                if(type==='readystatechange'||type==='load'||type==='loadend'){
                  // Fire immediately since XHR is already done
                  if(typeof listener==='function') listener.call(self, new Event(type));
                  else if(listener&&typeof listener.handleEvent==='function') listener.handleEvent(new Event(type));
                } else {
                  _addEventListener.call(self,type,listener,opts);
                }
              }catch(e){console.warn('[DevTools] XHR held listener error',e);}
            });
          }
          self._dt_held_listeners={};
        });
      });
    }

    if(!shouldInterceptReq(url,method)){_send.call(this,body);return;}
    let bodyText=body??'';
    if(bodyText instanceof realWindow.FormData)bodyText='[FormData]';
    else if(bodyText instanceof realWindow.ArrayBuffer)bodyText=new realWindow.TextDecoder().decode(bodyText);
    else if(bodyText instanceof realWindow.Blob){bodyText.text().then(t=>doXHR(self,t,method,savedHeaders));return;}
    doXHR(self,String(bodyText),method,savedHeaders);
  };
  function doXHR(xhr,bodyText,method,savedHeaders){
    queueReq(xhr._dt_url,method,savedHeaders,bodyText).then(result=>{
      // Headers on an already-opened XHR can't be replaced — if the user edited
      // them in the modal, re-open the request and set the edited set instead.
      // (Previously editedHeaders were ignored entirely on the XHR path.)
      const headers = result.editedHeaders || savedHeaders;
      const headersChanged = JSON.stringify(headers) !== JSON.stringify(savedHeaders);
      if(method==='GET'&&result.editedUrl){
        _open.call(xhr,method,result.editedUrl,true);
        Object.entries(headers).forEach(([k,v])=>_setHdr.call(xhr,k,v));
        _send.call(xhr,null);
      }else if(headersChanged){
        _open.call(xhr,method,xhr._dt_url,true);
        Object.entries(headers).forEach(([k,v])=>_setHdr.call(xhr,k,v));
        _send.call(xhr,result.editedBody??bodyText);
      }else{
        _send.call(xhr,result.editedBody??bodyText);
      }
    }).catch(()=>xhr.dispatchEvent(new ProgressEvent('abort')));
  }

  const METHOD_COLORS = { GET:'#0891b2', POST:'#16a34a', PUT:'#2563eb', PATCH:'#7c3aed', DELETE:'#dc2626' };

  // ─── Plugins ──────────────────────────────────────────────────────────────────
  // Plugin scripts (e.g. Devtools_recorder.js) register a factory with
  // DT_registerPlugin before this script's IIFE runs (see Devtools_plugins.js).
  // We invoke each factory now, with a small capability object — this has to
  // happen down here (rather than right after `state`/`Store` are set up)
  // because the ctx below intentionally exposes things like METHOD_COLORS,
  // which aren't initialized yet earlier in the file.
  const ctx = {
    Store, state,
    $: (id) => document.getElementById(id),
    escHtml, schemaBlock, tip, icon, METHOD_COLORS, ALL_METHODS, BASEURL_COLORS, getGroupHosts,
    getFetch: () => _fetch,
    updatePostmanKeyWarning,
    notifyPluginsBaseUrlGroupsChanged,
  };
  const plugins = (window.__DT_PLUGIN_FACTORIES__ || []).map(factory => factory(ctx));
  plugins.forEach(p => { if (p.getDefaultState) state[p.id] = p.getDefaultState(); });
  plugins.forEach(p => { if (p.storageSyncHandlers) Object.assign(STORAGE_SYNC_HANDLERS, p.storageSyncHandlers); });
  initStorageSync();

  function notifyPluginsBaseUrlGroupsChanged() {
    plugins.forEach(p => p.onBaseUrlGroupsChanged && p.onBaseUrlGroupsChanged());
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────────
  // @require scripts run synchronously before this script in normal conditions,
  // but on a cold cache (first ever page visit) the browser may still be fetching
  // them when document-start fires. Poll until CSS and HTML globals are available
  // before injecting, so we never render with undefined globals.
  function boot() {
    // Must check for STRING type, not just defined-ness: `CSS` is also a native
    // browser global (window.CSS, the CSSOM interface), so on a cold cache —
    // before the @require'd Devtools_css.js has loaded — `typeof CSS` is
    // already 'object' and the old `!== 'undefined'` check passed, injecting
    // the literal string "[object CSS]" as the stylesheet.
    if (typeof CSS === 'string' && typeof HTML === 'string') {
      if (document.documentElement) inject();
      else document.addEventListener('DOMContentLoaded', inject);
    } else {
      // Dependencies not ready yet — try again next microtask tick (max ~50 polls)
      if ((boot._tries = (boot._tries || 0) + 1) < 50) {
        setTimeout(boot, 20);
      } else {
        console.warn('[DevTools] Gave up waiting for @require dependencies (CSS/HTML) — sidebar not injected.');
      }
    }
  }
  boot();

})();
