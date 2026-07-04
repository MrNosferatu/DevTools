// ==UserScript==
// @name         DevTools Sidebar — HTML
// @namespace    http://tampermonkey.net/
// @version      3.4.1
// @description  HTML template builders for DevTools Sidebar
// @author       MrNosferatu
// ==/UserScript==

// ─── Icon library ─────────────────────────────────────────────────────────────
// Single source of truth for iconography so the whole UI shares one visual
// language (feather-style, 24×24 stroke). Replaces the ad-hoc emoji/glyphs that
// rendered inconsistently across OSes and fonts. `icon(name, size, sw)` returns
// an inline <svg>; exposed to plugins via ctx.icon.
const DT_ICON_PATHS = {
  tool:        '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  zap:         '<polygon points="13 2 4 13.5 11 13.5 10.5 22 20 10 13 10 13.5 2"/>',
  reply:       '<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  x:           '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  chevronRight:'<polyline points="9 18 15 12 9 6"/>',
  search:      '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  wrap:        '<line x1="3" y1="6" x2="21" y2="6"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="15 16 13 18 15 20"/>',
  arrowUp:     '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
  arrowDown:   '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
  arrowRight:  '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  globe:       '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a14 14 0 0 1 3.5 9 14 14 0 0 1-3.5 9 14 14 0 0 1-3.5-9A14 14 0 0 1 12 3z"/>',
  filter:      '<polygon points="21 4 3 4 10 12 10 19 14 21 14 12 21 4"/>',
  send:        '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/>',
  copy:        '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  network:     '<circle cx="12" cy="12" r="9"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18M3 9h18M3 15h18"/>',
  server:      '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><line x1="7" y1="7.5" x2="7" y2="7.5"/><line x1="7" y1="16.5" x2="7" y2="16.5"/>',
  book:        '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22.5z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>',
  swap:        '<polyline points="17 2 21 6 17 10"/><path d="M3 6h18"/><polyline points="7 22 3 18 7 14"/><path d="M21 18H3"/>',
  gauge:       '<path d="M12 21a9 9 0 1 1 9-9"/><path d="M12 12l4-2"/>',
  palette:     '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="9.5" r="1"/><circle cx="15.5" cy="9" r="1"/><circle cx="16" cy="14" r="1"/><path d="M12 21a3 3 0 0 1 0-6 2 2 0 0 0 0-4 9 9 0 0 0 0 10z"/>',
  clock:       '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
  trash:       '<polyline points="3 6 5 6 21 6"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  activity:    '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  checkSquare: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
};
function icon(name, size = 14, sw = 1.8) {
  return `<svg class="dt-ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DT_ICON_PATHS[name] || ''}</svg>`;
}

// Shared by every panel builder below (and exposed to plugins via ctx.tip).
function tip(text) {
  return `<span class="dt-tip"><span class="dt-tip-icon">?</span><span class="dt-tip-text">${text}</span></span>`;
}

// ─── Reusable network filter block (methods + URL mode/regex) ─────────────────
// One markup template drives the Global, Request, and Response filter blocks —
// each namespaced ('net' = global convenience, 'req', 'res'). The main script's
// state already stores req.* and res.* independently; 'net' is a UI-only control
// that writes to both at once.
function buildFilterBlock(ns) {
  return `
    <div class="dt-filter-block" data-ns="${ns}">
      <div class="dt-filter-sub">Methods</div>
      <div class="dt-method-grid">${ALL_METHODS.map(m=>`<input type="checkbox" class="dt-method-check" id="dt-${ns}-m-${m}" data-m="${m}" data-ns="${ns}"><label class="dt-method-pill" for="dt-${ns}-m-${m}">${m}</label>`).join('')}</div>
      <div class="dt-filter-sub" style="margin-top:13px;display:flex;align-items:center;justify-content:space-between">
        <span>URL Mode</span>
        <div class="dt-chip" id="dt-${ns}-chip">Auto</div>
      </div>
      <div class="dt-mode-group">
        <button class="dt-mode-btn active" data-mode="auto" data-ns="${ns}">Auto</button>
        <button class="dt-mode-btn" data-mode="manual" data-ns="${ns}">Regex</button>
      </div>
      <div class="dt-regex-wrap" id="dt-${ns}-rwrap">
        <div class="dt-regex-field">
          <span class="dt-regex-delim">/</span>
          <input class="dt-regex-input" id="dt-${ns}-regex" type="text" placeholder="api\\/v\\d+\\/.*" spellcheck="false">
          <span class="dt-regex-delim">/</span>
          <div class="dt-regex-dot" id="dt-${ns}-rdot"></div>
        </div>
      </div>
    </div>`;
}

// ─── Build merged Network panel ───────────────────────────────────────────────
function buildNetworkPanel() {
  return `
    <div class="dt-section">
      <div class="dt-slabel"><span class="dt-slabel-ico">${icon('globe',12,2)}</span>Global Filter</div>
      <div class="dt-note dt-note-tight">Sets methods &amp; URL matching for <em>both</em> interceptors at once. Fine-tune each below to override.</div>
      ${buildFilterBlock('net')}
    </div>

    <div class="dt-section dt-section-accent-req">
      <div class="dt-slabel"><span class="dt-slabel-ico">${icon('zap',12,2)}</span>Request</div>
      <div class="dt-row" style="margin-bottom:10px">
        <div class="dt-row-label">Intercept ${tip('Halt outgoing requests before they are sent. GET requests show URL params editor; others show body editor.')}</div>
        <label class="dt-toggle"><input type="checkbox" id="dt-req-enabled"><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
      </div>
      <div class="dt-disclosure" id="dt-req-filter-disc">
        <button class="dt-disclosure-hd" data-disc="req-filter" type="button">
          <span class="dt-disclosure-arrow">${icon('chevronRight',13,2.2)}</span>
          <span>Request filter</span>
          <span class="dt-disclosure-hint" id="dt-req-filter-hint"></span>
        </button>
        <div class="dt-disclosure-body">${buildFilterBlock('req')}</div>
      </div>
      <div class="dt-row" id="dt-req-persist-row" style="margin-top:12px;margin-bottom:0">
        <div class="dt-row-label">Persist ${tip('Keep intercept enabled across page reloads.')}</div>
        <label class="dt-toggle"><input type="checkbox" id="dt-req-persist"><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
      </div>
    </div>

    <div class="dt-section dt-section-accent-res">
      <div class="dt-slabel"><span class="dt-slabel-ico">${icon('reply',12,2)}</span>Response</div>
      <div class="dt-row" style="margin-bottom:10px">
        <div class="dt-row-label">Intercept ${tip('Hold API responses and allow editing the body and headers before the page receives them.')}</div>
        <label class="dt-toggle"><input type="checkbox" id="dt-res-enabled"><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
      </div>
      <div class="dt-disclosure" id="dt-res-filter-disc">
        <button class="dt-disclosure-hd" data-disc="res-filter" type="button">
          <span class="dt-disclosure-arrow">${icon('chevronRight',13,2.2)}</span>
          <span>Response filter</span>
          <span class="dt-disclosure-hint" id="dt-res-filter-hint"></span>
        </button>
        <div class="dt-disclosure-body">${buildFilterBlock('res')}</div>
      </div>
      <div class="dt-row" id="dt-res-persist-row" style="margin-top:12px;margin-bottom:0">
        <div class="dt-row-label">Persist ${tip('Keep intercept enabled across page reloads.')}</div>
        <label class="dt-toggle"><input type="checkbox" id="dt-res-persist"><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
      </div>
    </div>

    <div class="dt-section">
      <div class="dt-slabel"><span class="dt-slabel-ico">${icon('swap',12,2)}</span>Transforms</div>
      <div class="dt-row" style="margin-bottom:10px">
        <div class="dt-row-label" style="display:flex;align-items:center;gap:5px">Auto-apply ${tip('Automatically apply a matching enabled preset to responses — no modal shown.')}</div>
        <label class="dt-toggle"><input type="checkbox" id="dt-res-auto-transform"><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
      </div>
      <div class="dt-at-hint" id="dt-res-auto-transform-hint" style="font-size:11px;color:var(--mu);margin-bottom:10px"></div>
      <button class="dt-btn-presets" id="dt-res-presets-btn">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6.5" cy="6.5" r="2"/><path d="M6.5 1v1.5M6.5 10.5V12M1 6.5h1.5M10.5 6.5H12M2.6 2.6l1.1 1.1M9.3 9.3l1.1 1.1M9.3 2.6l-1.1 1.1M3.7 9.3l-1.1 1.1"/></svg>
        Manage Presets
      </button>
    </div>

    <div class="dt-section">
      <div class="dt-slabel"><span class="dt-slabel-ico">${icon('clock',12,2)}</span>Edit Memory ${tip('Every time you edit an intercepted request/response body and Send, the change is auto-detected (added/removed/renamed keys, type transforms like string→array, value changes) and saved to localStorage — so it survives a browser restart. Open an intercept modal and matching edits appear as one-click "Apply" chips above the editor.')}</div>
      <div class="dt-note dt-note-tight">Detected edits are saved here and offered as one-click "Apply" suggestions inside the intercept modals. Stored in localStorage — kept until you delete them.</div>
      <div class="dt-disclosure open" id="dt-edit-mem-disc">
        <button class="dt-disclosure-hd" data-disc="edit-mem" type="button">
          <span class="dt-disclosure-arrow">${icon('chevronRight',13,2.2)}</span>
          <span>Saved edits</span>
          <span class="dt-disclosure-hint" id="dt-edit-mem-count"></span>
        </button>
        <div class="dt-disclosure-body">
          <div class="dt-edit-mem-list" id="dt-edit-mem-list"></div>
          <button class="dt-edit-mem-clear" id="dt-edit-mem-clear">${icon('trash',12,2)}<span>Clear all</span></button>
        </div>
      </div>
    </div>
  `;
}

// ─── Sidebar settings panel HTML ──────────────────────────────────────────────
function buildSidebarSettingsPanel() {
  return `
    <div class="dt-section">
      <div class="dt-slabel">Layout</div>
      <div class="dt-row" style="margin-bottom:10px">
        <div class="dt-row-label">Position</div>
        <div class="dt-side-toggle" id="dt-sb-side-toggle">
          <button class="dt-side-btn" data-side="left">Left</button>
          <button class="dt-side-btn active" data-side="right">Right</button>
        </div>
      </div>
      <div class="dt-row" style="margin-bottom:6px"><div class="dt-row-label">Width</div></div>
      <div class="dt-slider-row">
        <button class="dt-slider-step" id="dt-sb-width-dec">−</button>
        <input type="range" class="dt-size-slider" id="dt-sb-width-slider" min="280" max="720" step="4" style="flex:1">
        <button class="dt-slider-step" id="dt-sb-width-inc">+</button>
        <input type="text" class="dt-slider-val-input" id="dt-sb-width-val" value="360">
      </div>
    </div>

    <div class="dt-section">
      <div class="dt-slabel">Integrations ${tip('Used by the API Docs tab\'s "Push to Postman" action. Get a key from Postman → Settings → API Keys.')}</div>
      <div class="dt-row-sub" style="margin-bottom:8px;color:var(--mu);font-size:11px">Postman API Key</div>
      <div class="dt-rec-secret-wrap">
        <input class="dt-baseurl-entry-url dt-rec-secret-input" id="dt-set-postman-key" type="text" placeholder="Postman API Key (optional)" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" data-lpignore="true" data-1p-ignore data-bwignore="true" data-form-type="other" style="width:100%;box-sizing:border-box;padding-right:32px">
        <button type="button" class="dt-rec-secret-toggle" id="dt-set-postman-key-toggle" title="Show/hide" tabindex="-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
    </div>

    <div class="dt-section">
      <div class="dt-slabel">Keyboard Shortcuts ${tip('Global hotkeys to quickly turn interception on/off without opening the Network panel. Click a shortcut, then press the key combo you want. Press Esc to cancel or Backspace/Delete to clear.')}</div>
      <div class="dt-kb-list" id="dt-kb-list">
        <div class="dt-kb-row" data-kb="toggleBoth">
          <div class="dt-kb-info"><div class="dt-row-label">Toggle Intercept</div><div class="dt-row-sub">Request + Response</div></div>
          <button class="dt-kb-input" data-kb-btn="toggleBoth"><span class="dt-kb-combo"></span></button>
          <button class="dt-kb-reset" data-kb-reset="toggleBoth" title="Reset to default">${icon('x',12,2.2)}</button>
        </div>
        <div class="dt-kb-row" data-kb="toggleReq">
          <div class="dt-kb-info"><div class="dt-row-label">Toggle Request Intercept</div></div>
          <button class="dt-kb-input" data-kb-btn="toggleReq"><span class="dt-kb-combo"></span></button>
          <button class="dt-kb-reset" data-kb-reset="toggleReq" title="Reset to default">${icon('x',12,2.2)}</button>
        </div>
        <div class="dt-kb-row" data-kb="toggleRes">
          <div class="dt-kb-info"><div class="dt-row-label">Toggle Response Intercept</div></div>
          <button class="dt-kb-input" data-kb-btn="toggleRes"><span class="dt-kb-combo"></span></button>
          <button class="dt-kb-reset" data-kb-reset="toggleRes" title="Reset to default">${icon('x',12,2.2)}</button>
        </div>
        <div class="dt-kb-row" data-kb="holdIntercept">
          <div class="dt-kb-info"><div class="dt-row-label">Hold to Intercept</div><div class="dt-row-sub">Momentary — active only while held</div></div>
          <button class="dt-kb-input" data-kb-btn="holdIntercept"><span class="dt-kb-combo"></span></button>
          <button class="dt-kb-reset" data-kb-reset="holdIntercept" title="Reset to default">${icon('x',12,2.2)}</button>
        </div>
      </div>
    </div>

    <div class="dt-section">
      <div class="dt-slabel">Appearance</div>
      <div class="dt-appearance-tabs">
        <button class="dt-appearance-tab" data-sbmode="light">Light</button>
        <button class="dt-appearance-tab" data-sbmode="dark">Dark</button>
        <button class="dt-appearance-tab" data-sbmode="auto">Auto</button>
        <button class="dt-appearance-tab" data-sbmode="custom">Custom</button>
      </div>
      <div id="dt-sb-system-theme">
        <div class="dt-flabel" style="margin:12px 0 6px">System Theme</div>
        <div class="dt-sb-palette-grid" id="dt-sb-palette-grid"></div>
      </div>
      <div id="dt-sb-custom-colors" style="display:none;margin-top:12px">
        <div class="dt-custom-colors">
          <div class="dt-color-group"><div class="dt-color-label">Background</div><div class="dt-color-input-row"><input type="color" class="dt-color-picker" id="dt-sb-sbg-picker"><input type="text" class="dt-color-hex" id="dt-sb-sbg-hex" placeholder="#1a1b1e" maxlength="9"><button class="dt-color-clear" id="dt-sb-sbg-clear">${icon('x',11,2.4)}</button></div></div>
          <div class="dt-color-group"><div class="dt-color-label">Surface</div><div class="dt-color-input-row"><input type="color" class="dt-color-picker" id="dt-sb-ssf-picker"><input type="text" class="dt-color-hex" id="dt-sb-ssf-hex" placeholder="#222327" maxlength="9"><button class="dt-color-clear" id="dt-sb-ssf-clear">${icon('x',11,2.4)}</button></div></div>
          <div class="dt-color-group"><div class="dt-color-label">Text</div><div class="dt-color-input-row"><input type="color" class="dt-color-picker" id="dt-sb-stx-picker"><input type="text" class="dt-color-hex" id="dt-sb-stx-hex" placeholder="#e4e6f0" maxlength="9"><button class="dt-color-clear" id="dt-sb-stx-clear">${icon('x',11,2.4)}</button></div></div>
          <div class="dt-color-group"><div class="dt-color-label">Border</div><div class="dt-color-input-row"><input type="color" class="dt-color-picker" id="dt-sb-sbd-picker"><input type="text" class="dt-color-hex" id="dt-sb-sbd-hex" placeholder="#333540" maxlength="9"><button class="dt-color-clear" id="dt-sb-sbd-clear">${icon('x',11,2.4)}</button></div></div>
        </div>
      </div>
    </div>

    <div class="dt-section">
      <div class="dt-slabel">Editor Theme</div>
      <div class="dt-theme-grid" id="dt-sb-theme-grid"></div>
      <div id="dt-sb-editor-custom-colors" style="display:none;margin-top:12px">
        <div class="dt-custom-colors">
          <div class="dt-color-group"><div class="dt-color-label">Background</div><div class="dt-color-input-row"><input type="color" class="dt-color-picker" id="dt-sb-bg-picker"><input type="text" class="dt-color-hex" id="dt-sb-bg-hex" placeholder="#1e1e2e" maxlength="9"><button class="dt-color-clear" id="dt-sb-bg-clear">${icon('x',11,2.4)}</button></div></div>
          <div class="dt-color-group"><div class="dt-color-label">Text</div><div class="dt-color-input-row"><input type="color" class="dt-color-picker" id="dt-sb-text-picker"><input type="text" class="dt-color-hex" id="dt-sb-text-hex" placeholder="#cdd6f4" maxlength="9"><button class="dt-color-clear" id="dt-sb-text-clear">${icon('x',11,2.4)}</button></div></div>
        </div>
      </div>
    </div>

    <div class="dt-section">
      <div class="dt-slabel">Editor Font</div>
      <div class="dt-font-list" id="dt-sb-font-list"></div>
    </div>

    <div class="dt-section">
      <div class="dt-row" style="margin-bottom:6px"><div class="dt-row-label">Font Size</div></div>
      <div class="dt-slider-row">
        <button class="dt-slider-step" id="dt-sb-size-dec">−</button>
        <input type="range" class="dt-size-slider" id="dt-sb-size-slider" min="9" max="18" step="1" style="flex:1">
        <button class="dt-slider-step" id="dt-sb-size-inc">+</button>
        <input type="text" class="dt-slider-val-input" id="dt-sb-size-val" value="12">
      </div>
      <div style="margin-top:12px;border-radius:8px;overflow:hidden" id="dt-sb-preview">
        <div class="dt-editor-wrap" style="border-radius:6px;margin:0">
          <div style="padding:10px 12px" id="dt-sb-preview-inner">const greeting = "Hello, DevTools!";</div>
        </div>
      </div>
    </div>

    <div class="dt-section">
      <div class="dt-row-sub" style="color:var(--mu);font-size:11px;margin-bottom:8px">Changes apply immediately.</div>
      <button class="dt-btn-reset" id="dt-sb-settings-reset" style="width:100%">Reset editor settings</button>
    </div>
  `;
}

// ─── Editor HTML ──────────────────────────────────────────────────────────────
// The cURL copy button lives here in the editor bar — a secondary utility
// action, consistent with Format/Minify. Only rendered for the request editor.
function buildEditorHTML(id) {
  const isCurlEditor = id === 'dt-req-ed';
  return `
    <div class="dt-editor-wrap" id="${id}-wrap">
      <div class="dt-editor-outer" id="${id}-outer">
        <div class="dt-hl-overlay" id="${id}-hl" aria-hidden="true"></div>
        <textarea class="dt-editor" id="${id}" spellcheck="false"></textarea>
      </div>
      <div class="dt-editor-bar" id="${id}-bar">
        <button class="dt-editor-btn" id="${id}-fmt">Format</button>
        <button class="dt-editor-btn" id="${id}-min">Minify</button>
        <span class="dt-json-badge" id="${id}-badge">—</span>
        <button class="dt-editor-btn dt-wrap-toggle-btn dt-editor-btn-ico" id="${id}-wrap-toggle" title="Toggle line wrap">${icon('wrap',13,1.7)}<span>Wrap</span></button>
        ${isCurlEditor ? `<button class="dt-editor-btn" id="dt-req-copy-curl">Copy as cURL</button>` : ''}
        <button class="dt-editor-btn dt-search-toggle-btn dt-editor-btn-ico" id="${id}-stoggle" title="Find (Ctrl+F)">${icon('search',13,1.9)}<span>Find</span></button>
      </div>
      <div class="dt-search-bar hidden" id="${id}-sbar">
        <div class="dt-search-wrap" id="${id}-swrap">
          <span class="dt-search-icon">${icon('search',13,1.9)}</span>
          <input class="dt-search-input" id="${id}-sinput" type="text" placeholder="Search…" spellcheck="false">
        </div>
        <span class="dt-search-count" id="${id}-scount">—</span>
        <button class="dt-snav" id="${id}-sprev" title="Prev (Shift+Enter)">${icon('arrowUp',13,2)}</button>
        <button class="dt-snav" id="${id}-snext" title="Next (Enter)">${icon('arrowDown',13,2)}</button>
        <button class="dt-sclose" id="${id}-sclose" title="Close">${icon('x',13,2.2)}</button>
      </div>
      <div class="dt-editor-resize-handle" id="${id}-resize" title="Drag to resize"></div>
    </div>
  `;
}

// ─── Full HTML ────────────────────────────────────────────────────────────────
// Plugin nav buttons/panels (e.g. the API Recorder) are NOT baked in here —
// they're appended to #dt-nav-plugins / #dt-scroll-plugins at runtime by the
// main script, once for every registered plugin (see Devtools_plugins.js).
const HTML = `
  <div id="dt-tab" title="DevTools Sidebar">
    <div id="dt-tab-inner">
      <div id="dt-tab-label">DevTools</div><div id="dt-tab-chevron">${icon('chevronLeft',13,2.4)}</div>
    </div>
  </div>

  <div id="dt-sidebar">
    <div id="dt-sb-drag-handle"></div>
    <div class="dt-head">
      <div class="dt-head-icon">${icon('tool',17,1.8)}</div>
      <div class="dt-head-text"><div class="dt-head-title">DevTools</div><div class="dt-head-sub">Developer Utilities</div></div>
      <button class="dt-head-settings" id="dt-settings-btn" title="Settings">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82A1.65 1.65 0 0 0 3 13.09H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <button class="dt-head-close" id="dt-close-btn" title="Close">${icon('x',15,2.2)}</button>
    </div>
    <div class="dt-nav">
      <button class="dt-nav-btn active" data-panel="network">${icon('network',13,1.9)}<span>Network</span></button>
      <!--dt-nav-plugins-->
    </div>
    <div class="dt-scroll">
      <div class="dt-panel active" id="dt-panel-network">${buildNetworkPanel()}</div>
      <!--dt-panel-plugins-->
      <div class="dt-panel" id="dt-panel-settings">${buildSidebarSettingsPanel()}</div>
      <div class="dt-panel" id="dt-panel-about">
        <div class="dt-about-hero"><div class="dt-about-icon">${icon('tool',26,1.7)}</div><div class="dt-about-title">DevTools Sidebar</div><div class="dt-about-version">v10.1.0 · Tampermonkey</div></div>
        <div class="dt-feature-list">
          <div class="dt-feature-item"><div class="dt-feature-ico">${icon('zap',16,1.8)}</div><div><div class="dt-feature-name">Request Interceptor</div><div class="dt-feature-desc">Edit request body or URL params before sending. Supports GET/POST/PUT/PATCH/DELETE.</div></div></div>
          <div class="dt-feature-item"><div class="dt-feature-ico">${icon('reply',16,1.8)}</div><div><div class="dt-feature-name">Response Interceptor</div><div class="dt-feature-desc">Capture & transform responses. Manual edit, GUI path extractor, or custom JS transform.</div></div></div>
          <div class="dt-feature-item"><div class="dt-feature-ico">${icon('network',16,1.8)}</div><div><div class="dt-feature-name">Network Monitor</div><div class="dt-feature-desc">A simple, persistent network log. Toggle on/off, regex filter, full-text search, and copy any request as a real cURL command.</div></div></div>
          <div class="dt-feature-item"><div class="dt-feature-ico">${icon('book',16,1.8)}</div><div><div class="dt-feature-name">API Recorder</div><div class="dt-feature-desc">Passively documents endpoints hit across one or more URLs/Base URL groups — typed request & response schemas, copy as cURL, export or push as a Postman collection.</div></div></div>
          <div class="dt-feature-item"><div class="dt-feature-ico">${icon('globe',16,1.8)}</div><div><div class="dt-feature-name">Base URL Switcher</div><div class="dt-feature-desc">Floating button to hop between configured environments (prod/staging/local) on matching pages, keeping your current path.</div></div></div>
          <div class="dt-feature-item"><div class="dt-feature-ico">${icon('gauge',16,1.8)}</div><div><div class="dt-feature-name">Bench</div><div class="dt-feature-desc">Benchmark a manual, pasted-cURL, or captured request — iterations, concurrency, warmup, delay, and a latency sparkline with p50/p95.</div></div></div>
          <div class="dt-feature-item"><div class="dt-feature-ico">${icon('palette',16,1.8)}</div><div><div class="dt-feature-name">Editor Theming</div><div class="dt-feature-desc">Catppuccin, Monokai, Nord, Dracula, VS Light presets + custom background & text colors, font, and size. Edit live from the Settings tab.</div></div></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Request Modal -->
  <div id="dt-req-overlay" class="dt-overlay">
    <div id="dt-req-modal" class="dt-modal">
      <div class="dt-modal-head">
        <div class="dt-modal-icon req">${icon('zap',18,1.9)}</div>
        <div class="dt-modal-meta"><div class="dt-modal-title">Request Intercepted</div><div class="dt-modal-url" id="dt-req-url"></div></div>
        <div class="dt-method-tag POST" id="dt-req-method">POST</div>
      </div>
      <div class="dt-modal-body" id="dt-req-body">
        <div class="dt-modal-inner">
          <div id="dt-req-editor-section" class="dt-payload-section">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
              <div class="dt-flabel" style="margin-bottom:0">Request Payload</div>
              <button class="dt-revert-btn" id="dt-req-ed-revert" title="Revert to original">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1.5 5.5A4 4 0 1 1 3 8.5"/><polyline points="1,3 1.5,5.5 4,5"/></svg>
                Revert
              </button>
            </div>
            ${buildEditorHTML('dt-req-ed')}
            <div class="dt-edit-suggest" id="dt-req-edit-suggest" style="display:none"></div>
            <div class="dt-body-suggestions" id="dt-req-body-suggestions" style="display:none"></div>
          </div>
          <div id="dt-req-params-section" class="dt-params-section" style="display:none">
            <div class="dt-flabel">URL Parameters</div>
            <div class="dt-params-list" id="dt-req-params-list"></div>
            <button class="dt-add-param" id="dt-req-add-param">+ Add Parameter</button>
          </div>
          <div class="dt-headers-section">
            <div class="dt-headers-toggle" id="dt-req-htoggle">
              <span class="dt-headers-arrow">${icon('chevronRight',13,2.2)}</span>
              <span class="dt-headers-label">Request Headers</span>
              <span class="dt-headers-count" id="dt-req-hcount"></span>
              <button class="dt-hrevert-btn" id="dt-req-hrevert" title="Revert headers to original" style="display:none">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 4.5A3.5 3.5 0 1 1 2.5 7.8"/><polyline points="1,2.5 1,4.5 3,4.5"/></svg>
                Revert
              </button>
            </div>
            <div class="dt-headers-body" id="dt-req-hbody"><div class="dt-headers-inner" id="dt-req-hinner"></div></div>
          </div>
        </div>
      </div>
      <div class="dt-modal-foot">
        <button class="dt-foot-btn dt-foot-btn-abort" id="dt-req-abort">Abort</button>
        <button class="dt-foot-btn dt-foot-btn-skip" id="dt-req-skip" title="Pass through this request unmodified">Skip</button>
        <button class="dt-foot-btn dt-foot-btn-skip-all" id="dt-req-skip-all" title="Disable intercept and pass through all future requests">Skip All</button>
        <button class="dt-qnav" id="dt-req-prev" title="Previous queued request" style="display:none">${icon('chevronLeft',13,2.2)}</button>
        <span class="dt-modal-count" id="dt-req-count"></span>
        <button class="dt-qnav" id="dt-req-next" title="Next queued request" style="display:none">${icon('chevronRight',13,2.2)}</button>
        <button class="dt-foot-btn dt-foot-btn-send" id="dt-req-send"><span>Send Request</span>${icon('arrowRight',14,2)}</button>
      </div>
    </div>
  </div>

  <!-- Response Modal -->
  <div id="dt-res-overlay" class="dt-overlay">
    <div id="dt-res-modal" class="dt-modal">
      <div class="dt-modal-head">
        <div class="dt-modal-icon res">${icon('reply',18,1.9)}</div>
        <div class="dt-modal-meta"><div class="dt-modal-title">Response Intercepted</div><div class="dt-modal-url" id="dt-res-url"></div></div>
        <div class="dt-method-tag GET" id="dt-res-method">GET</div>
      </div>
      <div class="dt-modal-body" id="dt-res-body">
        <div class="dt-modal-inner">
          <div id="dt-res-status-bar"></div>
          <div class="dt-res-tabs">
            <button class="dt-res-tab active" data-restab="manual"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:middle;margin-right:4px"><path d="M2 3h8M2 6h5M2 9h6"/></svg>Manual Edit</button>
            <button class="dt-res-tab" data-restab="gui"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:middle;margin-right:4px"><rect x="1" y="1" width="4" height="4" rx="0.5"/><rect x="7" y="1" width="4" height="4" rx="0.5"/><rect x="1" y="7" width="4" height="4" rx="0.5"/><rect x="7" y="7" width="4" height="4" rx="0.5"/></svg>GUI Extract</button>
            <button class="dt-res-tab" data-restab="code"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:middle;margin-right:4px"><polyline points="3,4 1,6 3,8"/><polyline points="9,4 11,6 9,8"/><line x1="7" y1="2" x2="5" y2="10"/></svg>JS Transform</button>
          </div>
          <div id="dt-res-manual" class="dt-payload-section">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
              <div class="dt-flabel" style="margin-bottom:0">Response Body</div>
              <button class="dt-revert-btn" id="dt-res-ed-revert" title="Revert to original">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1.5 5.5A4 4 0 1 1 3 8.5"/><polyline points="1,3 1.5,5.5 4,5"/></svg>
                Revert
              </button>
            </div>
            ${buildEditorHTML('dt-res-ed')}
            <div class="dt-edit-suggest" id="dt-res-edit-suggest" style="display:none"></div>
          </div>
          <div id="dt-res-gui" class="dt-transform-section" style="display:none">
            <div class="dt-transform-note">Click a key in the tree to select a path. Then choose an action to apply to the response.</div>
            <div class="dt-transform-cols">
              <div class="dt-transform-pane">
                <div class="dt-transform-pane-label">Response Tree</div>
                <div class="dt-tree" id="dt-res-tree"></div>
              </div>
              <div class="dt-transform-pane" style="max-width:200px;flex-shrink:0">
                <div class="dt-transform-pane-label">Actions</div>
                <div class="dt-path-builder">
                  <div class="dt-transform-pane-label" style="color:var(--vi);margin-bottom:4px">Selected path:</div>
                  <div class="dt-path-display" id="dt-res-path-display">—</div>
                  <div class="dt-path-actions">
                    <button class="dt-path-btn dt-path-btn-extract" id="dt-res-extract-btn">Extract value</button>
                    <button class="dt-path-btn dt-path-btn-wrap" id="dt-res-wrap-btn">Wrap in key</button>
                  </div>
                  <input class="dt-custom-wrap-input" id="dt-res-wrap-key" type="text" placeholder='wrap key name e.g. "data"' style="display:none">
                </div>
              </div>
            </div>
          </div>
          <div id="dt-res-code" class="dt-code-section" style="display:none">
            <div class="dt-code-note">
              Write a JS function body. You receive <code>data</code> (parsed JSON or raw string) and <code>res</code> (metadata).<br>
              Return the value that should replace the response. Example:<br>
              <code>return data.res.data;</code> or <code>return { items: data.items, total: data.meta.total };</code>
            </div>
            <textarea class="dt-transform-editor" id="dt-res-code-editor" spellcheck="false" placeholder="// data = parsed response JSON&#10;// res = { url, method, status }&#10;return data;"></textarea>
            <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
              <button class="dt-transform-run-btn" id="dt-res-run-btn">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><polygon points="2,1 11,6 2,11"/></svg>
                Run Transform
              </button>
              <button class="dt-transform-save-btn" id="dt-res-save-preset" title="Save this transform as a preset">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="10" height="10" rx="1"/><rect x="3.5" y="1" width="5" height="3.5" rx="0.5"/><rect x="3" y="6.5" width="6" height="4" rx="0.5"/></svg>
                Save Preset
              </button>
              <div class="dt-transform-err" id="dt-res-transform-err"></div>
            </div>
            <div id="dt-res-preview" class="dt-res-preview-section">
              <div class="dt-flabel" style="margin-bottom:8px">Preview (Before → After)</div>
              <div class="dt-preview-container">
                <div class="dt-preview-pane">
                  <div class="dt-preview-label">Original</div>
                  <div class="dt-preview-content dt-editor-themed" id="dt-res-preview-original"></div>
                </div>
                <div class="dt-preview-arrow">→</div>
                <div class="dt-preview-pane">
                  <div class="dt-preview-label">Transformed</div>
                  <div class="dt-preview-content dt-editor-themed" id="dt-res-preview-transformed"></div>
                </div>
              </div>
            </div>
          </div>
          <div class="dt-headers-section">
            <div class="dt-headers-toggle" id="dt-res-htoggle">
              <span class="dt-headers-arrow">${icon('chevronRight',13,2.2)}</span>
              <span class="dt-headers-label">Response Headers</span>
              <span class="dt-headers-count" id="dt-res-hcount"></span>
              <button class="dt-hrevert-btn" id="dt-res-hrevert" title="Revert headers to original" style="display:none">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 4.5A3.5 3.5 0 1 1 2.5 7.8"/><polyline points="1,2.5 1,4.5 3,4.5"/></svg>
                Revert
              </button>
            </div>
            <div class="dt-headers-body" id="dt-res-hbody"><div class="dt-headers-inner" id="dt-res-hinner"></div></div>
          </div>
        </div>
      </div>
      <div class="dt-modal-foot">
        <button class="dt-foot-btn dt-foot-btn-abort" id="dt-res-abort">Passthrough (Original)</button>
        <span class="dt-modal-count" id="dt-res-count"></span>
        <button class="dt-foot-btn dt-foot-btn-send res-send" id="dt-res-send"><span>Apply Response</span>${icon('arrowRight',14,2)}</button>
      </div>
    </div>
  </div>

  <!-- Presets Modal — must be after dt-res-overlay in DOM so it stacks on top -->
  <div id="dt-presets-overlay" class="dt-overlay">
    <div id="dt-presets-modal" class="dt-modal" style="max-width:560px;width:90%;height:auto;min-height:300px;max-height:80vh">
      <div class="dt-modal-head">
        <div class="dt-modal-icon res">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>
        </div>
        <div class="dt-modal-meta">
          <div class="dt-modal-title" id="dt-presets-modal-title">Response Transform Presets</div>
          <div class="dt-modal-url">Save &amp; manage transform presets</div>
        </div>
      </div>
      <div class="dt-modal-body" id="dt-presets-body">
        <!-- List view -->
        <div id="dt-presets-list-view" class="dt-modal-inner" style="gap:10px">
          <div class="dt-presets-list" id="dt-presets-list"></div>
          <div class="dt-presets-empty" id="dt-presets-empty" style="text-align:center;color:var(--mu);padding:32px 20px;display:none">No presets saved yet.</div>
          <div class="dt-preset-load-hint" id="dt-preset-load-hint" style="display:none;font-size:11px;color:var(--mu);background:var(--am-bg);border:1px solid var(--am-bd);border-radius:6px;padding:8px 12px;line-height:1.5">
            <strong style="color:var(--am)">Load</strong> puts the preset's JS code into the transform editor — it only takes effect once you're in the response intercept modal and click Run or Apply.
          </div>
        </div>
        <!-- Editor view (save / edit) -->
        <div id="dt-preset-editor-view" class="dt-modal-inner" style="display:none;gap:14px">
          <div>
            <div class="dt-flabel" style="margin-bottom:6px">Preset Name</div>
            <input class="dt-preset-name-input" id="dt-pe-name" type="text" placeholder="My Transform" spellcheck="false">
          </div>
          <div>
            <div class="dt-flabel" style="margin-bottom:4px">URL Patterns <span style="font-weight:400;color:var(--mu)">(regex — leave empty to match all)</span></div>
            <div class="dt-pe-patterns-list" id="dt-pe-patterns"></div>
            <button class="dt-pe-add-pattern" id="dt-pe-add-pattern">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="5.5" y1="1" x2="5.5" y2="10"/><line x1="1" y1="5.5" x2="10" y2="5.5"/></svg>
              Add pattern
            </button>
          </div>
        </div>
      </div>
      <div class="dt-modal-foot" id="dt-presets-foot-list">
        <button class="dt-foot-btn dt-foot-btn-abort" id="dt-presets-close" style="flex:1">Close</button>
      </div>
      <div class="dt-modal-foot" id="dt-presets-foot-editor" style="display:none">
        <button class="dt-foot-btn dt-foot-btn-abort" id="dt-pe-cancel">Cancel</button>
        <button class="dt-foot-btn dt-foot-btn-send" id="dt-pe-save">Save Preset</button>
      </div>
    </div>
  </div>

  <!-- Mini Save Preset — last in DOM, always on top -->
  <div id="dt-save-preset-overlay" class="dt-overlay dt-mini-overlay">
    <div class="dt-mini-modal">
      <div class="dt-mini-modal-head">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="1" y="1" width="12" height="12" rx="1.5"/><rect x="4" y="1" width="6" height="4" rx="0.5"/><rect x="3.5" y="7.5" width="7" height="4.5" rx="0.5"/></svg>
        Save Preset
      </div>
      <div class="dt-mini-modal-body">
        <div class="dt-flabel" style="margin-bottom:5px">Preset Name</div>
        <input class="dt-preset-name-input" id="dt-spe-name" type="text" placeholder="My Transform" spellcheck="false" style="margin-bottom:12px">
        <div class="dt-flabel" style="margin-bottom:4px">URL Patterns <span style="font-weight:400;color:var(--mu)">(regex — empty = match all)</span></div>
        <div class="dt-pe-patterns-list" id="dt-spe-patterns"></div>
        <button class="dt-pe-add-pattern" id="dt-spe-add-pattern">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="5.5" y1="1" x2="5.5" y2="10"/><line x1="1" y1="5.5" x2="10" y2="5.5"/></svg>
          Add pattern
        </button>
      </div>
      <div class="dt-modal-foot" style="padding:12px 16px;gap:8px">
        <button class="dt-foot-btn dt-foot-btn-abort" id="dt-spe-cancel">Cancel</button>
        <button class="dt-foot-btn dt-foot-btn-send" id="dt-spe-save">Save</button>
      </div>
    </div>
  </div>

  <!-- Base URL floating switcher button -->
  <div id="dt-baseurl-fab" style="display:none">
    <button id="dt-baseurl-fab-btn" class="dt-baseurl-fab-btn" title="Switch Base URL">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 1a6 6 0 1 0 0 12A6 6 0 0 0 7 1z"/><path d="M1 7h12M7 1c-1.5 2-2.5 3.8-2.5 6s1 4 2.5 6M7 1c1.5 2 2.5 3.8 2.5 6s-1 4-2.5 6"/></svg>
      <span id="dt-baseurl-fab-label">Switch URL</span>
    </button>
    <div id="dt-baseurl-fab-menu" class="dt-baseurl-fab-menu"></div>
  </div>
`;
