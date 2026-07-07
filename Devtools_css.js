// ==UserScript==
// @name         DevTools Sidebar — CSS
// @namespace    http://tampermonkey.net/
// @version      3.6.8
// @description  Styles for DevTools Sidebar
// @author       MrNosferatu
// ==/UserScript==

// ─── CSS ─────────────────────────────────────────────────────────────────────
const CSS = `
  /* NOTE: no @import here — the IBM Plex fonts are loaded by injectFonts() in
     Devtools.js as a document-level <link>. An @import at the top of this
     sheet made engines treat the WHOLE sheet as pending until the network
     fetch resolved, so on a cold cache the sidebar painted as a raw unstyled
     skeleton (the reveal fired before any rule applied). @font-face inside a
     shadow tree also doesn't register fonts in Chromium — they must be
     declared at document level to be usable in here at all. */

  /* Shadow-DOM host. The whole UI lives in a shadow root, so page CSS can't
     reach it at all (not even with !important) — except INHERITED properties
     (font, color, ...) which still cross the boundary. \`all:initial\` on the
     host severs that last channel; the rules below then set our own baseline.
     Custom properties are NOT affected by \`all\`, so --dt-w still inherits from
     <html> (set by applyLayout). The host box itself takes no space — its
     children are position:fixed. */
  :host { all: initial; }
  #dt-root { font-family: 'IBM Plex Sans', -apple-system, sans-serif; }

  /* Style isolation: reset properties that site stylesheets commonly clobber.
     Kept even under shadow DOM as a belt-and-suspenders baseline for our own
     descendants (the shadow tree inherits nothing from the page now). */
  #dt-tab, #dt-sidebar, #dt-req-overlay, #dt-res-overlay,
  #dt-presets-overlay, #dt-save-preset-overlay,
  #dt-tab *, #dt-sidebar *, #dt-req-overlay *, #dt-res-overlay *,
  #dt-presets-overlay *, #dt-save-preset-overlay * {
    box-sizing: border-box;
    font-family: 'IBM Plex Sans', -apple-system, sans-serif;
    line-height: 1.5;
    letter-spacing: normal;
    word-spacing: normal;
    text-transform: none;
    text-decoration: none;
    text-indent: 0;
    list-style: none;
    -webkit-font-smoothing: antialiased;
  }

  /* Flash-free */
  #dt-sidebar { visibility:hidden; transition:none; }
  #dt-req-overlay,#dt-res-overlay,#dt-presets-overlay,#dt-save-preset-overlay { visibility:hidden; transition:none; opacity:0; pointer-events:none; }
  #dt-sidebar.dt-ready { visibility:visible; transition:transform 0.28s cubic-bezier(.4,0,.2,1); }
  #dt-req-overlay.dt-ready,#dt-res-overlay.dt-ready,#dt-presets-overlay.dt-ready,#dt-save-preset-overlay.dt-ready { visibility:visible; transition:opacity 0.18s ease; }
  #dt-req-overlay.dt-ready #dt-req-modal,#dt-res-overlay.dt-ready #dt-res-modal,#dt-presets-overlay.dt-ready #dt-presets-modal { transition:transform 0.22s cubic-bezier(.34,1.2,.64,1); }
  #dt-req-overlay.visible,#dt-res-overlay.visible,#dt-presets-overlay.visible,#dt-save-preset-overlay.visible { opacity:1; pointer-events:all; }

  /* Scoped to the script's own top-level elements — NOT :root. Generic names
     like --bg/--tx/--ac on :root collided with host pages' own CSS variables
     in both directions (we overrode theirs; theirs bled into us). --w moved
     to the dt-prefixed --dt-w, set on <html> by applyLayout(). */
  #dt-tab, #dt-sidebar, .dt-overlay, #dt-baseurl-fab, .dt-rec-kebab-menu, #dt-tip-portal {
    /* Light theme — brand-neutral, higher legibility. --mu/--fa raised so
       secondary/faint text clears WCAG AA on the surfaces they sit on. */
    --bg:#ffffff; --sf:#f5f6f8; --sf2:#eceef2;
    --bd:#e3e5ea; --bd2:#c5c9d2;
    --tx:#14161c; --tx2:#3d4250; --mu:#646b7d; --fa:#9aa0af;
    --ac:#3b6ef5; --ac-bg:#eef3ff; --ac-bd:#c2d3fc; --ac-tx:#ffffff;
    --gn:#12915a; --gn-bg:#e9faf1; --gn-bd:#b3ecce;
    --rd:#d63535; --rd-bg:#fdecec; --rd-bd:#f6c9c9;
    --am:#c47a06; --am-bg:#fef6e6; --am-bd:#f6dca3;
    --vi:#7a4be8; --vi-bg:#f3eefe; --vi-bd:#dcccf8; --vi-tx:#ffffff;
    --ring:rgba(59,110,245,.28);
    --shadow-sm:0 1px 2px rgba(20,22,28,.06);
    --shadow-md:0 6px 20px rgba(20,22,28,.10);
    --shadow-lg:0 24px 64px rgba(20,22,28,.20);
    --r-sm:6px; --r-md:9px; --r-lg:13px;
    --ease:cubic-bezier(.4,0,.2,1);
  }
  /* Dark theme token set — selectors repeated with IDs so specificity beats
     the scoped light defaults above. Muted/faint tokens were the main dark-mode
     readability problem (near-invisible labels, arrows, counts); they're now
     lifted well clear of the background so no secondary text disappears. */
  #dt-tab.dt-dark, #dt-sidebar.dt-dark, .dt-overlay.dt-dark, #dt-baseurl-fab.dt-dark, .dt-rec-kebab-menu.dt-dark, #dt-tip-portal.dt-dark {
    --bg:#16171b; --sf:#1f2127; --sf2:#292c34;
    --bd:#33363f; --bd2:#484c58;
    --tx:#eceef6; --tx2:#c3c7d6; --mu:#9599ab; --fa:#71768a;
    --ac:#6a9bff; --ac-bg:#1b2846; --ac-bd:#37538f; --ac-tx:#ffffff;
    --gn:#54c98a; --gn-bg:#16311f; --gn-bd:#2f5f3c;
    --rd:#ff6b64; --rd-bg:#3a1d1d; --rd-bd:#6a3232;
    --am:#f0bd4e; --am-bg:#33280f; --am-bd:#63501d;
    --vi:#b48cff; --vi-bg:#271d40; --vi-bd:#4d3a7a; --vi-tx:#14161c;
    --ring:rgba(106,155,255,.34);
    --shadow-sm:0 1px 2px rgba(0,0,0,.35);
    --shadow-md:0 6px 20px rgba(0,0,0,.45);
    --shadow-lg:0 24px 64px rgba(0,0,0,.60);
  }

  /* Pull tab */
  #dt-tab { position:fixed; top:50%; right:0; transform:translateY(-50%); z-index:999991; width:28px; height:96px; background:var(--bg); border:1px solid var(--bd); border-right:none; border-radius:10px 0 0 10px; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:-2px 0 10px rgba(0,0,0,.07); will-change:transform; transition:width .18s var(--ease),background .15s,border-color .15s; overflow:hidden; user-select:none; }
  #dt-tab.dt-tab-animate { transition:width .18s var(--ease),background .15s,border-color .15s,transform .28s cubic-bezier(.4,0,.2,1); }
  #dt-tab:hover { width:34px; background:var(--sf); border-color:var(--bd2); }
  #dt-tab.active { border-color:var(--ac-bd); background:var(--ac-bg); }
  #dt-tab-inner { display:flex; flex-direction:column; align-items:center; gap:7px; pointer-events:none; }
  #dt-tab-label { writing-mode:vertical-rl; text-orientation:mixed; font-family:'IBM Plex Mono',monospace; font-size:9px; font-weight:500; letter-spacing:.16em; color:var(--mu); text-transform:uppercase; transform:rotate(180deg); transition:color .15s; }
  #dt-tab:hover #dt-tab-label,#dt-tab.active #dt-tab-label { color:var(--ac); }
  #dt-tab-chevron { font-size:11px; color:var(--fa); transition:transform .25s var(--ease),color .15s; line-height:1; }
  #dt-tab.active #dt-tab-chevron { transform:scaleX(-1); color:var(--ac); }

  /* Sidebar */
  #dt-sidebar { position:fixed; top:0; right:0; bottom:0; z-index:999990; width:var(--dt-w,360px); will-change:transform; transform:translateX(var(--dt-w,360px)); background:var(--bg); display:flex; flex-direction:column; box-shadow:-4px 0 24px rgba(0,0,0,.10),-1px 0 0 var(--bd); overflow:hidden; }
  #dt-sidebar.open { transform:translateX(0); }

  /* Drag resize handle */
  #dt-sb-drag-handle { position:absolute; top:0; bottom:0; left:0; width:5px; cursor:ew-resize; z-index:10; background:transparent; transition:background .15s; }
  #dt-sb-drag-handle:hover,#dt-sb-drag-handle:active { background:var(--ac-bd); }

  /* Side toggle (Left/Right) */
  .dt-side-toggle { display:flex; border:1.5px solid var(--bd); border-radius:7px; overflow:hidden; flex-shrink:0; }
  .dt-side-btn { padding:5px 12px; font-size:11px; font-weight:500; background:transparent; border:none; color:var(--mu); cursor:pointer; transition:all .15s; }
  .dt-side-btn.active { background:var(--ac); color:var(--ac-tx,#fff); }
  .dt-head { padding:18px 18px 14px; border-bottom:1px solid var(--bd); flex-shrink:0; display:flex; align-items:center; gap:11px; }
  .dt-head-icon { width:32px; height:32px; background:var(--ac-bg); border:1px solid var(--ac-bd); border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:15px; }
  .dt-head-text { flex:1; }
  .dt-head-title { font-size:14px; font-weight:600; color:var(--tx); letter-spacing:-.01em; }
  .dt-head-sub { font-family:'IBM Plex Mono',monospace; font-size:9.5px; color:var(--mu); margin-top:1px; }
  .dt-head-close { width:28px; height:28px; border-radius:7px; background:transparent; border:1px solid var(--bd); color:var(--mu); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:14px; transition:all .15s; flex-shrink:0; }
  .dt-head-close:hover { background:var(--rd-bg); border-color:var(--rd-bd); color:var(--rd); }
  .dt-head-settings { width:28px; height:28px; border-radius:7px; background:transparent; border:1px solid var(--bd); color:var(--mu); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .15s; flex-shrink:0; }
  .dt-head-settings:hover { background:var(--ac-bg); border-color:var(--ac-bd); color:var(--ac); }
  .dt-head-settings.active { background:var(--ac-bg); border-color:var(--ac-bd); color:var(--ac); }
  .dt-nav { display:flex; border-bottom:1px solid var(--bd); background:var(--sf); flex-shrink:0; padding:0 14px; overflow-x:auto; scrollbar-width:none; -ms-overflow-style:none; }
  .dt-nav::-webkit-scrollbar { display:none; }
  .dt-nav-btn { display:inline-flex; align-items:center; gap:5px; padding:10px 9px 9px; font-size:12px; font-weight:500; color:var(--mu); cursor:pointer; background:none; border:none; border-bottom:2px solid transparent; margin-bottom:-1px; transition:color .15s,border-color .15s; flex-shrink:0; white-space:nowrap; }
  .dt-nav-btn .dt-ico { flex-shrink:0; opacity:.65; transition:opacity .15s; }
  .dt-nav-btn:hover .dt-ico, .dt-nav-btn.active .dt-ico { opacity:1; }
  .dt-nav-btn:hover { color:var(--tx2); }
  .dt-nav-btn.active { color:var(--ac); border-bottom-color:var(--ac); }
  .dt-scroll { flex:1; overflow-y:auto; }
  .dt-scroll::-webkit-scrollbar { width:4px; }
  .dt-scroll::-webkit-scrollbar-thumb { background:var(--bd); border-radius:4px; }
  .dt-panel { display:none; }
  .dt-panel.active { display:block; }
  .dt-section { padding:16px 18px; border-bottom:1px solid var(--bd); }
  .dt-section:last-child { border-bottom:none; }
  .dt-slabel { font-family:'IBM Plex Mono',monospace; font-size:9px; font-weight:500; letter-spacing:.14em; text-transform:uppercase; color:var(--mu); margin-bottom:13px; }
  .dt-row { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }

  /* Tooltip */
  .dt-tip { position:relative; display:inline-flex; align-items:center; }
  .dt-tip-icon { width:15px; height:15px; border-radius:50%; border:1.5px solid var(--bd2); color:var(--mu); font-size:9px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; cursor:default; flex-shrink:0; }
  /* Just a hidden data holder — the visible tooltip is rendered into #dt-tip-portal
     (see the portal rules below); the JS reads this element's innerHTML. */
  .dt-tip-text { display:none; }

  /* Appearance mode tabs */
  .dt-appearance-tabs { display:flex; gap:3px; background:var(--sf2); border-radius:8px; padding:3px; margin-bottom:14px; }
  .dt-appearance-tab { flex:1; padding:5px 2px; font-size:11px; font-weight:500; border:none; border-radius:6px; background:transparent; color:var(--mu); cursor:pointer; transition:all .15s; }
  .dt-appearance-tab.active { background:var(--bg); color:var(--tx); box-shadow:0 1px 4px rgba(0,0,0,.10); }

  /* Font select */
  .dt-font-select { width:100%; padding:7px 28px 7px 10px; border:1.5px solid var(--bd); border-radius:7px; background:var(--sf); color:var(--tx); font-size:13px; outline:none; cursor:pointer; appearance:none; -webkit-appearance:none; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1.5 3.5h9z'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 10px center; transition:border-color .15s; box-sizing:border-box; }
  .dt-font-select:focus { border-color:var(--ac); }
  .dt-font-select option { font-size:13px; background:var(--bg); color:var(--tx); }

  /* Slider with steppers */
  .dt-slider-row { display:flex; align-items:center; gap:6px; }
  .dt-slider-step { width:26px; height:26px; border:1.5px solid var(--bd); border-radius:5px; background:var(--sf); color:var(--mu); font-size:16px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all .15s; padding:0; }
  .dt-slider-step:hover { border-color:var(--ac); color:var(--ac); background:var(--ac-bg); }
  .dt-slider-val-input { width:52px; padding:4px 6px; border:1.5px solid var(--bd); border-radius:5px; background:var(--sf); color:var(--tx); font-size:12px; font-family:'IBM Plex Mono',monospace; text-align:center; outline:none; transition:border-color .15s; }
  .dt-slider-val-input:focus { border-color:var(--ac); }
  .dt-row:last-child { margin-bottom:0; }
  .dt-row-info { flex:1; min-width:0; }
  .dt-row-label { font-size:13px; font-weight:500; color:var(--tx); }
  .dt-row-sub { font-size:11px; color:var(--mu); margin-top:2px; line-height:1.5; }
  .dt-at-hint { transition:color .18s; }
  .dt-at-hint.on { color:var(--gn,#a6e3a1); }
  .dt-toggle { position:relative; width:40px; height:22px; cursor:pointer; flex-shrink:0; }
  .dt-toggle input { opacity:0; width:0; height:0; position:absolute; }
  .dt-toggle-track { position:absolute; inset:0; background:var(--sf2); border:1.5px solid var(--bd); border-radius:11px; transition:all .18s var(--ease); }
  .dt-toggle input:checked ~ .dt-toggle-track { background:var(--ac); border-color:var(--ac); }
  .dt-toggle-thumb { position:absolute; top:3px; left:3px; width:14px; height:14px; background:#fff; border-radius:50%; box-shadow:0 1px 3px rgba(0,0,0,.2); transition:left .18s var(--ease); }
  .dt-toggle input:checked ~ .dt-toggle-track .dt-toggle-thumb { left:20px; }
  .dt-method-grid { display:flex; flex-wrap:wrap; gap:5px; margin-top:2px; }
  .dt-method-check { display:none; }
  .dt-method-pill { padding:3px 10px; border-radius:20px; font-size:10px; font-weight:600; font-family:'IBM Plex Mono',monospace; letter-spacing:.06em; cursor:pointer; border:1.5px solid var(--bd); color:var(--mu); background:var(--sf); transition:all .15s; user-select:none; }
  .dt-method-check:checked + .dt-method-pill { color:#fff; border-color:transparent; }
  .dt-method-check[data-m="GET"]:checked + .dt-method-pill { background:#0891b2; }
  .dt-method-check[data-m="POST"]:checked + .dt-method-pill { background:#16a34a; }
  .dt-method-check[data-m="PUT"]:checked + .dt-method-pill { background:#2563eb; }
  .dt-method-check[data-m="PATCH"]:checked + .dt-method-pill { background:#7c3aed; }
  .dt-method-check[data-m="DELETE"]:checked + .dt-method-pill { background:#dc2626; }
  .dt-chip { font-family:'IBM Plex Mono',monospace; font-size:10px; font-weight:500; letter-spacing:.06em; padding:3px 9px; border-radius:20px; border:1px solid var(--bd); color:var(--mu); background:var(--sf); white-space:nowrap; }
  .dt-chip.on { background:var(--gn-bg); border-color:var(--gn-bd); color:var(--gn); }
  .dt-mode-group { display:flex; gap:6px; margin-top:12px; }
  .dt-mode-btn { flex:1; padding:8px; font-size:11.5px; font-weight:500; background:var(--sf); border:1.5px solid var(--bd); border-radius:7px; color:var(--mu); cursor:pointer; transition:all .15s; }
  .dt-mode-btn:hover { border-color:var(--bd2); color:var(--tx2); }
  .dt-mode-btn.active { background:var(--ac-bg); border-color:var(--ac-bd); color:var(--ac); }
  .dt-regex-wrap { max-height:0; overflow:hidden; opacity:0; transition:max-height .22s var(--ease),opacity .18s; }
  .dt-regex-wrap.visible { max-height:80px; opacity:1; margin-top:12px; }
  .dt-flabel { font-family:'IBM Plex Mono',monospace; font-size:9px; font-weight:500; letter-spacing:.12em; text-transform:uppercase; color:var(--mu); margin-bottom:6px; }
  .dt-regex-field { display:flex; align-items:center; background:var(--bg); border:1.5px solid var(--bd); border-radius:7px; padding:0 10px; gap:5px; transition:border-color .15s,box-shadow .15s; }
  .dt-regex-field:focus-within { border-color:var(--ac); box-shadow:0 0 0 3px var(--ac-bg); }
  .dt-regex-delim { font-family:'IBM Plex Mono',monospace; font-size:14px; font-weight:300; color:var(--fa); flex-shrink:0; }
  .dt-regex-input { flex:1; background:none; border:none; outline:none; font-family:'IBM Plex Mono',monospace; font-size:11.5px; color:var(--tx); padding:8px 0; caret-color:var(--ac); }
  .dt-regex-input::placeholder { color:var(--fa); }
  .dt-regex-dot { width:6px; height:6px; border-radius:50%; background:var(--bd); flex-shrink:0; transition:background .15s; }
  .dt-regex-dot.valid { background:var(--gn); }
  .dt-regex-dot.invalid { background:var(--rd); }
  .dt-about-hero { padding:24px 18px 18px; border-bottom:1px solid var(--bd); text-align:center; }
  .dt-about-icon { width:48px; height:48px; background:var(--ac-bg); border:1px solid var(--ac-bd); border-radius:13px; display:flex; align-items:center; justify-content:center; font-size:22px; margin:0 auto 10px; }
  .dt-about-title { font-size:16px; font-weight:600; color:var(--tx); margin-bottom:3px; }
  .dt-about-version { font-family:'IBM Plex Mono',monospace; font-size:10px; color:var(--mu); }
  .dt-feature-list { padding:14px 18px; }
  .dt-feature-item { display:flex; gap:11px; align-items:flex-start; padding:11px; border:1px solid var(--bd); border-radius:8px; margin-bottom:7px; background:var(--sf); }
  .dt-feature-item:last-child { margin-bottom:0; }
  .dt-feature-ico { font-size:15px; flex-shrink:0; margin-top:1px; }
  .dt-feature-name { font-size:12.5px; font-weight:600; color:var(--tx); margin-bottom:2px; }
  .dt-feature-desc { font-size:11px; color:var(--mu); line-height:1.55; }

  /* ── Sidebar Settings Panel ─────────────────────────────────────────────── */
  /* Theme swatches */
  .dt-theme-grid { display:flex; flex-wrap:wrap; gap:7px; }
  .dt-theme-swatch { cursor:pointer; border-radius:8px; overflow:hidden; border:2px solid transparent; transition:all .15s; flex-shrink:0; }
  .dt-theme-swatch.active { border-color:var(--ac); box-shadow:0 0 0 3px var(--ac-bg); }
  .dt-swatch-preview { width:60px; height:36px; display:flex; align-items:center; justify-content:center; }
  .dt-swatch-preview-inner { font-size:9px; font-family:'IBM Plex Mono',monospace; opacity:.8; }
  .dt-swatch-name { font-size:9px; font-weight:500; color:var(--tx2); text-align:center; padding:3px 0; background:var(--sf); border-top:1px solid var(--bd); }
  /* Font selector */
  .dt-font-list { display:flex; flex-direction:column; gap:5px; }
  .dt-font-opt { display:flex; align-items:center; gap:10px; padding:7px 10px; border:1px solid var(--bd); border-radius:7px; cursor:pointer; transition:all .15s; background:var(--bg); }
  .dt-font-opt:hover { border-color:var(--bd2); background:var(--sf); }
  .dt-font-opt.active { border-color:var(--ac-bd); background:var(--ac-bg); }
  .dt-font-opt-radio { width:14px; height:14px; border-radius:50%; border:1.5px solid var(--bd); flex-shrink:0; display:flex; align-items:center; justify-content:center; transition:all .15s; }
  .dt-font-opt.active .dt-font-opt-radio { border-color:var(--ac); background:var(--ac); }
  .dt-font-opt.active .dt-font-opt-radio::after { content:''; width:5px; height:5px; background:#fff; border-radius:50%; }
  .dt-font-opt-name { font-size:12px; color:var(--tx); flex:1; }
  .dt-font-opt-preview { font-size:10px; color:var(--mu); }
  /* Font size slider */
  .dt-size-slider { flex:1; appearance:none; height:4px; border-radius:2px; background:var(--sf2); outline:none; cursor:pointer; }
  .dt-size-slider::-webkit-slider-thumb { appearance:none; width:16px; height:16px; border-radius:50%; background:var(--ac); cursor:pointer; box-shadow:0 1px 4px var(--ring); }
  /* Custom colors */
  .dt-custom-colors { display:flex; flex-direction:column; gap:10px; }
  .dt-color-group { flex:1; }
  .dt-color-label { font-size:11px; color:var(--mu); margin-bottom:5px; }
  .dt-color-input-row { display:flex; gap:6px; align-items:center; }
  .dt-color-picker { width:32px; height:32px; border-radius:7px; border:1px solid var(--bd); cursor:pointer; padding:2px; background:var(--sf); }
  .dt-color-hex { flex:1; font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--tx); background:var(--sf); border:1px solid var(--bd); border-radius:6px; padding:6px 9px; outline:none; transition:border-color .15s; }
  .dt-color-hex:focus { border-color:var(--ac); }
  .dt-color-clear { font-size:10px; color:var(--mu); background:transparent; border:1px solid var(--bd); border-radius:5px; padding:4px 7px; cursor:pointer; transition:all .15s; }
  .dt-color-clear:hover { border-color:var(--rd-bd); color:var(--rd); }
  /* Preview box */
  /* Apply button */
  .dt-btn-reset { font-size:12px; font-weight:500; padding:8px 16px; border-radius:7px; cursor:pointer; background:transparent; border:1px solid var(--bd); color:var(--tx2); transition:all .15s; }
  .dt-btn-reset:hover { border-color:var(--bd2); }

  /* Modal overlay */
  .dt-overlay { position:fixed; inset:0; z-index:999993; background:rgba(0,0,0,.42); display:flex; align-items:center; justify-content:center; backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); pointer-events:none; }
  .dt-overlay.visible { pointer-events:all; }
  /* Sidebar stays above overlays so it remains clickable — but only while one is
     actually open. This used to apply unconditionally, which permanently parked
     the sidebar above everything else in the stack (including the kebab menu)
     even with no modal in sight, no matter how high the kebab menu's own
     z-index was set. */
  #dt-root:has(.dt-overlay.visible) #dt-sidebar { z-index:999995 !important; }
  #dt-root:has(.dt-overlay.visible) #dt-tab { z-index:999995 !important; }

  /* Modal — resizable, fixed initial size */
  .dt-modal { position:relative; z-index:1; width:700px; height:620px; min-width:500px; min-height:400px; max-width:98vw; max-height:96vh; background:var(--bg); border:1px solid var(--bd); border-radius:14px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,.18),0 4px 16px rgba(0,0,0,.08); transform:translateY(10px) scale(.98); resize:both; }
  .dt-overlay.visible .dt-modal { transform:translateY(0) scale(1); }
  .dt-modal-head { padding:16px 18px 14px; border-bottom:1px solid var(--bd); display:flex; align-items:flex-start; gap:12px; flex-shrink:0; background:var(--sf); }
  .dt-modal-icon { width:36px; height:36px; border-radius:9px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:16px; }
  .dt-modal-icon.req { background:var(--am-bg); border:1px solid var(--am-bd); }
  .dt-modal-icon.res { background:var(--vi-bg); border:1px solid var(--vi-bd); }
  .dt-modal-meta { flex:1; min-width:0; }
  .dt-modal-title { font-size:14px; font-weight:600; color:var(--tx); margin-bottom:3px; letter-spacing:-.01em; }
  .dt-modal-url { font-family:'IBM Plex Mono',monospace; font-size:10px; color:var(--mu); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dt-method-tag { padding:3px 9px; border-radius:5px; font-family:'IBM Plex Mono',monospace; font-size:9.5px; font-weight:600; letter-spacing:.08em; flex-shrink:0; }
  .dt-method-tag.GET    { background:#ecfeff; color:#0891b2; border:1px solid #a5f3fc; }
  .dt-method-tag.POST   { background:var(--gn-bg); color:var(--gn); border:1px solid var(--gn-bd); }
  .dt-method-tag.PUT    { background:var(--ac-bg); color:var(--ac); border:1px solid var(--ac-bd); }
  .dt-method-tag.PATCH  { background:var(--vi-bg); color:var(--vi); border:1px solid var(--vi-bd); }
  .dt-method-tag.DELETE { background:var(--rd-bg); color:var(--rd); border:1px solid var(--rd-bd); }

  .dt-modal-body { flex:1; overflow-y:auto; overflow-x:hidden; padding:0; display:flex; flex-direction:column; min-height:0; }
  .dt-modal-body::-webkit-scrollbar { width:4px; }
  .dt-modal-body::-webkit-scrollbar-thumb { background:var(--bd); border-radius:4px; }
  .dt-modal-inner { padding:16px 18px; display:flex; flex-direction:column; gap:14px; }
  .dt-payload-section { display:flex; flex-direction:column; min-height:200px; }

  /* Compact status pill in the modal header, sat next to the method tag. */
  .dt-res-status-pill { padding:3px 9px; border-radius:5px; font-family:'IBM Plex Mono',monospace; font-size:9.5px; font-weight:600; letter-spacing:.04em; flex-shrink:0; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dt-res-status-pill.ok  { background:var(--gn-bg); border:1px solid var(--gn-bd); color:var(--gn); }
  .dt-res-status-pill.err { background:var(--rd-bg); border:1px solid var(--rd-bd); color:var(--rd); }
  .dt-res-status-pill.oth { background:var(--am-bg); border:1px solid var(--am-bd); color:var(--am); }

  /* Response mode tab strip */
  .dt-res-tabs { display:flex; gap:0; margin-bottom:2px; border:1px solid var(--bd); border-radius:8px; overflow:hidden; flex-shrink:0; }
  .dt-res-tab { flex:1; padding:8px 10px; font-size:11px; font-weight:500; color:var(--mu); cursor:pointer; background:var(--sf); border:none; border-right:1px solid var(--bd); transition:all .15s; text-align:center; }
  .dt-res-tab:last-child { border-right:none; }
  .dt-res-tab:hover { color:var(--tx2); background:var(--sf2); }
  .dt-res-tab.active { background:var(--ac-bg); color:var(--ac); }

  /* Editor wrapper */
  .dt-editor-wrap { border:1px solid var(--bd); border-radius:9px; overflow:hidden; display:flex; flex-direction:column; flex:1; min-height:120px; resize:none; min-width:260px; }
  .dt-editor-outer { position:relative; flex:1; min-height:0; display:flex; flex-direction:column; }
  .dt-hl-overlay { position:absolute; top:0; left:0; right:0; bottom:0; pointer-events:none; line-height:1.7; padding:13px 15px; tab-size:2; white-space:pre; overflow:hidden; color:transparent; }
  .dt-hl-overlay mark { border-radius:2px; color:transparent; }
  .dt-editor { flex:1; width:100%; min-height:0; border:none; outline:none; resize:none; line-height:1.7; padding:13px 15px; tab-size:2; white-space:pre; overflow:auto; }
  .dt-editor-bar { display:flex; align-items:center; gap:5px; padding:7px 10px; flex-shrink:0; }
  .dt-editor-btn { font-family:'IBM Plex Mono',monospace; font-size:9.5px; padding:3px 9px; border-radius:4px; cursor:pointer; transition:all .12s; }
  .dt-editor-btn:disabled { opacity:.35; cursor:default; }
  .dt-search-toggle-btn { margin-left:auto; font-family:'IBM Plex Mono',monospace; font-size:9.5px; padding:3px 9px; border-radius:4px; cursor:pointer; transition:all .12s; display:flex; align-items:center; gap:5px; }
  .dt-json-badge { font-family:'IBM Plex Mono',monospace; font-size:9.5px; }

  /* Search bar */
  .dt-search-bar { display:flex; align-items:center; gap:6px; padding:6px 10px; flex-shrink:0; }
  .dt-search-bar.hidden { display:none; }
  .dt-search-wrap { display:flex; align-items:center; flex:1; border-radius:5px; padding:0 8px; gap:5px; transition:border-color .15s; }
  .dt-search-icon { font-size:11px; flex-shrink:0; }
  .dt-search-input { flex:1; background:none; border:none; outline:none; font-family:'IBM Plex Mono',monospace; font-size:11px; padding:5px 0; }
  .dt-search-count { font-family:'IBM Plex Mono',monospace; font-size:10px; white-space:nowrap; flex-shrink:0; min-width:46px; text-align:right; }
  .dt-snav { width:22px; height:22px; border-radius:4px; cursor:pointer; background:transparent; display:flex; align-items:center; justify-content:center; font-size:11px; transition:all .12s; flex-shrink:0; }
  .dt-sclose { width:20px; height:20px; border-radius:4px; cursor:pointer; background:transparent; border:none; font-size:13px; display:flex; align-items:center; justify-content:center; transition:color .12s; flex-shrink:0; }

  /* Headers */
  .dt-headers-section { }
  .dt-headers-toggle { display:flex; align-items:center; gap:7px; cursor:pointer; padding:8px 10px; background:var(--sf); border:1px solid var(--bd); border-radius:8px; transition:border-radius .15s; }
  .dt-headers-toggle.open { border-radius:8px 8px 0 0; }
  .dt-headers-arrow { font-size:10px; color:var(--fa); transition:transform .18s; flex-shrink:0; }
  .dt-headers-toggle.open .dt-headers-arrow { transform:rotate(90deg); }
  .dt-headers-label { font-family:'IBM Plex Mono',monospace; font-size:9px; font-weight:500; letter-spacing:.12em; text-transform:uppercase; color:var(--mu); }
  .dt-headers-count { margin-left:auto; font-family:'IBM Plex Mono',monospace; font-size:9px; color:var(--fa); }
  .dt-headers-body { display:none; border:1px solid var(--bd); border-top:none; border-radius:0 0 8px 8px; background:var(--bg); max-height:200px; overflow-y:auto; }
  .dt-headers-body.open { display:block; }
  .dt-headers-inner { padding:8px; display:flex; flex-direction:column; gap:4px; }
  .dt-header-row { display:flex; gap:10px; align-items:baseline; padding:5px 9px; border:1px solid var(--bd); border-radius:5px; background:var(--sf); }
  .dt-hkey { font-family:'IBM Plex Mono',monospace; font-size:10px; font-weight:500; color:var(--tx2); min-width:130px; flex-shrink:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dt-hval { font-family:'IBM Plex Mono',monospace; font-size:10px; font-weight:300; color:var(--mu); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }

  /* GET params */
  .dt-params-section { display:flex; flex-direction:column; min-height:0; }
  .dt-params-list { display:flex; flex-direction:column; gap:6px; margin-bottom:8px; }
  .dt-param-row { display:flex; gap:6px; align-items:center; }
  .dt-param-input { flex:1; background:var(--sf); border:1px solid var(--bd); border-radius:6px; padding:6px 9px; font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--tx); outline:none; transition:border-color .15s; }
  .dt-param-input:focus { border-color:var(--ac); box-shadow:0 0 0 3px var(--ac-bg); }
  .dt-param-input::placeholder { color:var(--fa); }
  .dt-param-eq { font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--fa); flex-shrink:0; }
  .dt-param-del { width:24px; height:24px; border-radius:5px; cursor:pointer; background:transparent; border:1px solid var(--bd); color:var(--fa); font-size:13px; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all .12s; }
  .dt-param-del:hover { border-color:var(--rd-bd); color:var(--rd); background:var(--rd-bg); }
  .dt-add-param { font-size:11px; font-weight:500; color:var(--ac); background:var(--ac-bg); border:1px solid var(--ac-bd); border-radius:6px; padding:6px 12px; cursor:pointer; transition:all .15s; width:fit-content; }
  .dt-add-param:hover { background:#dbeafe; }

  /* Param rows suggested from API docs but not yet in the request — greyed
     out and inert until the user clicks "+ Add" to activate them. */
  .dt-param-row-suggested .dt-param-input { opacity:.5; pointer-events:none; }
  .dt-param-row-suggested .dt-param-eq { opacity:.5; }
  .dt-param-add-suggested { font-size:10px; font-weight:600; color:var(--ac); background:var(--ac-bg); border:1px solid var(--ac-bd); border-radius:5px; padding:5px 9px; cursor:pointer; flex-shrink:0; transition:all .12s; white-space:nowrap; }
  .dt-param-add-suggested:hover { background:#dbeafe; }

  /* Documented body fields missing from the current JSON payload — click a
     chip to insert that key (with a typed default value) into the editor. */
  .dt-body-suggestions { margin-top:8px; }
  .dt-body-suggestions-row { display:flex; flex-wrap:wrap; gap:6px; }
  .dt-body-suggestion-chip { font-family:'IBM Plex Mono',monospace; font-size:10px; font-weight:500; letter-spacing:.04em; padding:4px 10px 4px 8px; border-radius:20px; border:1px dashed var(--bd); color:var(--mu); background:var(--sf); cursor:pointer; transition:all .15s; }
  .dt-body-suggestion-chip::before { content:'+ '; font-weight:700; }
  .dt-body-suggestion-chip:hover { border-style:solid; border-color:var(--ac-bd); color:var(--ac); background:var(--ac-bg); }

  /* Response transform — GUI path builder */
  .dt-transform-section { display:flex; flex-direction:column; gap:10px; flex:1; min-height:0; }
  .dt-transform-note { font-size:11px; color:var(--mu); padding:8px 10px; background:var(--vi-bg); border:1px solid var(--vi-bd); border-radius:7px; line-height:1.55; flex-shrink:0; }
  .dt-transform-cols { display:flex; gap:10px; flex:1; min-height:180px; }
  .dt-transform-pane { flex:1; display:flex; flex-direction:column; min-width:0; }
  .dt-transform-pane-label { font-family:'IBM Plex Mono',monospace; font-size:9px; font-weight:500; letter-spacing:.12em; text-transform:uppercase; color:var(--mu); margin-bottom:6px; flex-shrink:0; }
  .dt-tree { flex:1; overflow-y:auto; overflow-x:hidden; background:var(--sf); border:1px solid var(--bd); border-radius:8px; padding:8px; font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--tx2); }
  .dt-tree::-webkit-scrollbar { width:3px; }
  .dt-tree::-webkit-scrollbar-thumb { background:var(--bd); border-radius:3px; }
  .dt-tree-node { display:flex; align-items:center; gap:4px; padding:2px 4px; border-radius:4px; cursor:pointer; white-space:nowrap; transition:background .1s; }
  .dt-tree-node:hover { background:var(--sf2); }
  .dt-tree-node.selected { background:var(--ac-bg); color:var(--ac); }
  .dt-tree-arrow { font-size:9px; color:var(--fa); flex-shrink:0; width:10px; }
  .dt-tree-key { color:var(--tx); font-weight:500; }
  .dt-tree-type { font-size:9px; color:var(--fa); margin-left:4px; }
  .dt-tree-val { color:var(--mu); margin-left:4px; max-width:100px; overflow:hidden; text-overflow:ellipsis; }
  .dt-path-builder { display:flex; flex-direction:column; gap:8px; flex-shrink:0; }
  .dt-path-display { font-family:'IBM Plex Mono',monospace; font-size:10px; color:var(--vi); background:var(--vi-bg); border:1px solid var(--vi-bd); border-radius:6px; padding:7px 10px; word-break:break-all; min-height:32px; }
  .dt-path-actions { display:flex; gap:6px; flex-wrap:wrap; }
  .dt-path-btn { font-size:11px; font-weight:500; padding:6px 12px; border-radius:6px; cursor:pointer; transition:all .15s; border:1.5px solid; }
  .dt-path-btn-extract { background:var(--ac-bg); border-color:var(--ac-bd); color:var(--ac); }
  .dt-path-btn-extract:hover { background:#dbeafe; }
  .dt-path-btn-wrap { background:var(--gn-bg); border-color:var(--gn-bd); color:var(--gn); }
  .dt-path-btn-wrap:hover { background:#dcfce7; }
  .dt-custom-wrap-input { font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--tx); background:var(--sf); border:1px solid var(--bd); border-radius:6px; padding:6px 9px; outline:none; width:100%; transition:border-color .15s; }
  .dt-custom-wrap-input:focus { border-color:var(--ac); box-shadow:0 0 0 3px var(--ac-bg); }
  .dt-custom-wrap-input::placeholder { color:var(--fa); }

  /* JS Transform */
  .dt-code-section { display:flex; flex-direction:column; flex:1; min-height:0; gap:8px; }
  .dt-code-note { font-size:11px; color:var(--mu); line-height:1.55; }
  .dt-code-note code { font-family:'IBM Plex Mono',monospace; background:var(--sf); padding:1px 5px; border-radius:3px; font-size:10px; color:var(--vi); }
  .dt-transform-editor { flex:1; width:100%; min-height:80px; border:1px solid var(--bd); border-radius:8px; padding:10px 12px; font-family:'IBM Plex Mono',monospace; font-size:11.5px; color:var(--tx); background:var(--sf); outline:none; resize:none; line-height:1.6; tab-size:2; caret-color:var(--ac); transition:border-color .15s; }
  .dt-transform-editor:focus { border-color:var(--ac); box-shadow:0 0 0 3px var(--ac-bg); }
  .dt-transform-run-btn { font-size:11.5px; font-weight:500; padding:8px 16px; border-radius:7px; cursor:pointer; background:var(--vi-bg); border:1.5px solid var(--vi-bd); color:var(--vi); transition:all .15s; width:fit-content; flex-shrink:0; }
  .dt-transform-run-btn:hover { background:#ede9fe; }
  .dt-transform-err { font-family:'IBM Plex Mono',monospace; font-size:10px; color:var(--rd); background:var(--rd-bg); border:1px solid var(--rd-bd); border-radius:6px; padding:6px 10px; display:none; }
  .dt-transform-err.show { display:block; }

  /* Footer */
  .dt-modal-foot { padding:12px 18px; border-top:1px solid var(--bd); display:flex; align-items:center; gap:10px; flex-shrink:0; background:var(--sf); }
  .dt-modal-count { font-family:'IBM Plex Mono',monospace; font-size:9.5px; color:var(--mu); white-space:nowrap; }
  .dt-foot-btn { flex:1; padding:9px; font-size:12.5px; font-weight:500; border-radius:8px; cursor:pointer; border:1.5px solid; transition:all .15s; }
  /* No generic hover color here: it used to set color:var(--tx), which (at equal
     specificity, declared earlier) leaked into every variant that didn't restate
     its own color on hover — most visibly turning the solid Send button's white
     label near-black on light themes. Each variant styles its own hover below. */
  .dt-foot-btn:hover { border-color:var(--bd2); }
  .dt-foot-btn-abort { background:var(--bg); border-color:var(--bd); color:var(--tx2); }
  .dt-foot-btn-abort:hover { border-color:var(--rd-bd); color:var(--rd); background:var(--rd-bg); }
  /* Primary action — identical in the request AND response modal. The response
     modal's Apply used to carry a hardcoded violet (res-send) that didn't match
     the request modal's accent button on the default theme. */
  .dt-foot-btn-send { background:var(--ac); border-color:var(--ac); color:var(--ac-tx,#fff); }
  .dt-foot-btn-send:hover { filter:brightness(.92); box-shadow:0 4px 12px var(--ring); }

  /* Preview */
  .dt-res-preview-section { border-top:1px solid var(--bd); padding-top:12px; margin-top:4px; }
  .dt-preview-container { display:flex; gap:12px; align-items:stretch; }
  .dt-preview-pane { flex:1; border:1px solid var(--bd); border-radius:6px; overflow:hidden; display:flex; flex-direction:column; }
  .dt-preview-label { font-size:11px; font-weight:500; color:var(--mu); background:var(--sf); padding:6px 10px; border-bottom:1px solid var(--bd); flex-shrink:0; }
  .dt-preview-content { flex:1; padding:10px 12px; font-size:11px; overflow:auto; max-height:180px; word-break:break-all; white-space:pre-wrap; }
  .dt-preview-content.dt-editor-themed { background:var(--dt-ed-bg, var(--sf)); color:var(--dt-ed-text, var(--tx)); font-family:var(--dt-ed-font, 'IBM Plex Mono',monospace); font-size:var(--dt-ed-fs, 11px); }
  .dt-preview-arrow { padding:40px 4px; color:var(--mu); font-weight:bold; flex-shrink:0; align-self:center; }

  /* Presets overlay — must sit above res overlay (999993) */
  #dt-presets-overlay { z-index:999994; }
  .dt-presets-list { display:flex; flex-direction:column; gap:10px; }
  .dt-preset-item { display:flex; justify-content:space-between; align-items:center; padding:12px; background:var(--sf); border:1px solid var(--bd); border-radius:6px; gap:10px; transition:opacity .15s; }
  .dt-preset-disabled { opacity:.45; }
  .dt-preset-toggle { flex-shrink:0; width:34px; height:18px; }
  .dt-preset-toggle .dt-toggle-track { border-radius:9px; }
  .dt-preset-toggle .dt-toggle-thumb { top:2px; left:2px; width:12px; height:12px; }
  .dt-preset-toggle input:checked ~ .dt-toggle-track .dt-toggle-thumb { left:18px; }
  .dt-preset-info { flex:1; }
  .dt-preset-name { font-weight:500; color:var(--tx); font-size:13px; }
  .dt-preset-desc { font-size:11px; color:var(--mu); margin-top:4px; }
  .dt-preset-actions { display:flex; gap:6px; flex-shrink:0; }
  .dt-preset-btn { padding:6px 10px; font-size:11px; border-radius:4px; border:1px solid var(--bd); background:var(--bg); cursor:pointer; color:var(--mu); transition:all .15s; }
  .dt-preset-btn:hover { border-color:var(--ac); color:var(--ac); background:var(--ac-bg); }
  .dt-preset-btn.delete { color:var(--rd); }
  .dt-preset-btn.delete:hover { border-color:var(--rd); background:var(--rd-bg); }

  /* Preset editor panel */
  .dt-preset-name-input { width:100%; padding:8px 10px; border:1px solid var(--bd); border-radius:6px; background:var(--sf); color:var(--tx); font-size:13px; outline:none; box-sizing:border-box; transition:border-color .15s; }
  .dt-preset-name-input:focus { border-color:var(--ac); box-shadow:0 0 0 3px var(--ac-bg); }
  .dt-pe-patterns-list { display:flex; flex-direction:column; gap:6px; margin-bottom:8px; }
  .dt-pe-pattern-row { display:flex; align-items:center; gap:4px; }
  .dt-pe-pattern-row .dt-regex-input { flex:1; }
  .dt-pe-pattern-dot { width:7px; height:7px; border-radius:50%; background:var(--bd); flex-shrink:0; transition:background .15s; }
  .dt-pe-pattern-dot.valid { background:var(--gn); }
  .dt-pe-pattern-dot.invalid { background:var(--rd); }
  .dt-pe-pattern-remove { width:22px; height:22px; border:1px solid var(--bd); border-radius:4px; background:transparent; cursor:pointer; color:var(--mu); display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all .15s; padding:0; }
  .dt-pe-pattern-remove:hover { border-color:var(--rd); color:var(--rd); background:var(--rd-bg); }
  .dt-pe-add-pattern { display:inline-flex; align-items:center; gap:5px; padding:5px 10px; border:1px dashed var(--bd); border-radius:5px; background:transparent; color:var(--mu); font-size:11px; cursor:pointer; transition:all .15s; }
  .dt-pe-add-pattern:hover { border-color:var(--ac); color:var(--ac); background:var(--ac-bg); }

  /* Mini save preset overlay */
  .dt-mini-overlay { z-index:999996; }
  .dt-mini-modal { background:var(--bg); border:1px solid var(--bd); border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,.22); width:420px; max-width:95vw; display:flex; flex-direction:column; overflow:hidden; }
  .dt-mini-modal-head { display:flex; align-items:center; gap:8px; padding:14px 16px 10px; font-size:13px; font-weight:600; color:var(--tx); border-bottom:1px solid var(--bd); }
  .dt-mini-modal-body { padding:16px; display:flex; flex-direction:column; gap:10px; }

  /* Revert buttons */
  .dt-revert-btn { display:inline-flex; align-items:center; gap:4px; padding:3px 8px; font-size:11px; color:var(--mu); background:transparent; border:1px solid var(--bd); border-radius:5px; cursor:pointer; transition:all .15s; }
  .dt-revert-btn:hover { color:var(--am); border-color:var(--am-bd); background:var(--am-bg); }
  .dt-hrevert-btn { display:inline-flex; align-items:center; gap:4px; padding:2px 7px; font-size:10px; color:var(--mu); background:transparent; border:1px solid var(--bd); border-radius:4px; cursor:pointer; transition:all .15s; margin-left:auto; }
  .dt-hrevert-btn:hover { color:var(--am); border-color:var(--am-bd); background:var(--am-bg); }

  /* Editable headers */
  .dt-header-row-edit { display:flex; align-items:center; gap:4px; padding:3px 4px; border-radius:4px; }
  .dt-header-row-edit:hover { background:var(--sf); }
  .dt-hkey-input { font-family:'IBM Plex Mono',monospace; font-size:10px; font-weight:500; color:var(--tx2); width:130px; flex-shrink:0; background:transparent; border:1px solid transparent; border-radius:3px; padding:2px 5px; outline:none; transition:border-color .12s; }
  .dt-hval-input { font-family:'IBM Plex Mono',monospace; font-size:10px; color:var(--mu); flex:1; min-width:0; background:transparent; border:1px solid transparent; border-radius:3px; padding:2px 5px; outline:none; transition:border-color .12s; }
  .dt-hkey-input:focus,.dt-hval-input:focus { border-color:var(--ac); background:var(--sf); color:var(--tx); }
  .dt-hrow-del { width:18px; height:18px; border:none; background:transparent; cursor:pointer; color:var(--fa); flex-shrink:0; display:flex; align-items:center; justify-content:center; border-radius:3px; padding:0; transition:all .12s; }
  .dt-hrow-del:hover { color:var(--rd); background:var(--rd-bg); }
  .dt-hadd-btn { display:inline-flex; align-items:center; gap:5px; margin:4px 4px 0; padding:4px 8px; border:1px dashed var(--bd); border-radius:4px; background:transparent; color:var(--mu); font-size:10px; cursor:pointer; transition:all .15s; }
  .dt-hadd-btn:hover { border-color:var(--ac); color:var(--ac); background:var(--ac-bg); }
  .dt-transform-save-btn { padding:8px 12px; font-size:12px; border-radius:6px; border:1px solid var(--vi-bd); background:var(--vi-bg); color:var(--vi); cursor:pointer; transition:all .15s; font-weight:500; }
  .dt-transform-save-btn:hover { border-color:var(--vi); background:var(--vi); color:var(--vi-tx,#fff); box-shadow:0 2px 8px var(--vi-bd); }
  .dt-btn-presets { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:10px; background:var(--sf); border:1px solid var(--bd); border-radius:6px; cursor:pointer; color:var(--ac); font-size:12px; font-weight:500; transition:all .15s; width:100%; }
  .dt-btn-presets:hover { border-color:var(--ac-bd); background:var(--ac-bg); }
  /* ── Benchmark ──────────────────────────────────────────────────────────── */
  .dt-bench-method-sel { padding:6px 8px; border:1.5px solid var(--bd); border-radius:6px; background:var(--sf); color:var(--tx); font-size:12px; font-weight:600; font-family:'IBM Plex Mono',monospace; cursor:pointer; outline:none; flex-shrink:0; }
  .dt-bench-url-input { flex:1; padding:6px 10px; border:1.5px solid var(--bd); border-radius:6px; background:var(--sf); color:var(--tx); font-size:12px; outline:none; transition:border-color .15s,box-shadow .15s; min-width:0; }
  .dt-bench-url-input:focus { border-color:var(--ac); box-shadow:0 0 0 3px var(--ac-bg); }
  .dt-bench-body-ed { width:100%; height:100px; padding:8px 10px; border:1.5px solid var(--bd); border-radius:6px; background:var(--sf); color:var(--tx); font-size:11px; font-family:'IBM Plex Mono',monospace; outline:none; resize:vertical; transition:border-color .15s; box-sizing:border-box; }
  .dt-bench-body-ed:focus { border-color:var(--ac); box-shadow:0 0 0 3px var(--ac-bg); }

  /* Capture list */
  .dt-bench-capture-list { display:flex; flex-direction:column; gap:5px; max-height:220px; overflow-y:auto; margin-top:8px; }
  .dt-bench-capture-empty { font-size:11px; color:var(--mu); padding:20px 0; text-align:center; line-height:1.6; }
  .dt-bench-capture-item { display:flex; align-items:center; gap:8px; padding:7px 10px; background:var(--sf); border:1.5px solid var(--bd); border-radius:6px; cursor:pointer; transition:all .15s; }
  .dt-bench-capture-item:hover { border-color:var(--ac-bd); background:var(--ac-bg); }
  .dt-bench-capture-item.selected { border-color:var(--ac); background:var(--ac-bg); }
  .dt-bench-capture-method { font-family:'IBM Plex Mono',monospace; font-size:9px; font-weight:700; padding:2px 5px; border-radius:3px; color:#fff; flex-shrink:0; }
  .dt-bench-capture-url { font-size:11px; color:var(--tx2); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:'IBM Plex Mono',monospace; }
  .dt-bench-capture-status { font-size:10px; color:var(--mu); flex-shrink:0; }

  /* Selected pill */
  .dt-bench-sel-pill { display:flex; align-items:center; gap:8px; padding:8px 10px; background:var(--ac-bg); border:1.5px solid var(--ac-bd); border-radius:8px; }
  .dt-bench-sel-method { font-family:'IBM Plex Mono',monospace; font-size:9px; font-weight:700; padding:2px 6px; border-radius:3px; color:#fff; flex-shrink:0; }
  .dt-bench-sel-url { font-size:11px; color:var(--ac); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:'IBM Plex Mono',monospace; }
  .dt-bench-clear-sel { font-size:10px; color:var(--mu); background:transparent; border:1px solid var(--bd); border-radius:4px; padding:2px 7px; cursor:pointer; transition:all .15s; }
  .dt-bench-clear-sel:hover { color:var(--rd); border-color:var(--rd-bd); background:var(--rd-bg); }

  /* Config grid */
  .dt-bench-config-grid { display:grid; grid-template-columns:1fr 1fr 1fr auto; gap:10px; align-items:start; margin-bottom:14px; }
  .dt-bench-config-item { display:flex; flex-direction:column; }
  .dt-bench-num-input { padding:6px 8px; border:1.5px solid var(--bd); border-radius:6px; background:var(--sf); color:var(--tx); font-size:13px; font-family:'IBM Plex Mono',monospace; outline:none; width:100%; transition:border-color .15s; box-sizing:border-box; }
  .dt-bench-num-input:focus { border-color:var(--ac); box-shadow:0 0 0 3px var(--ac-bg); }

  /* Run button */
  .dt-bench-run-btn { display:flex; align-items:center; justify-content:center; gap:7px; width:100%; padding:10px; background:var(--ac); border:none; border-radius:8px; color:var(--ac-tx,#fff); font-size:13px; font-weight:600; cursor:pointer; transition:all .15s; }
  .dt-bench-run-btn:hover { filter:brightness(.92); box-shadow:0 4px 12px var(--ring); }
  .dt-bench-run-btn:disabled { background:var(--fa); cursor:not-allowed; box-shadow:none; }
  .dt-bench-run-btn.running { background:var(--rd); }
  .dt-bench-run-btn.running:hover { background:#b91c1c; }
  .dt-bench-run-btn.pending { background:var(--am); animation:dt-pulse .8s ease-in-out infinite; }
  @keyframes dt-pulse { 0%,100%{opacity:1;} 50%{opacity:.65;} }
  @keyframes dt-spin  { to { transform:rotate(360deg); } }

  /* Greyed-out dependent rows when master toggle is off */
  .dt-row-disabled { opacity:.42; pointer-events:none; user-select:none; transition:opacity .2s; }

  /* Progress */
  .dt-bench-progress { margin-bottom:12px; }
  .dt-bench-progress-bar { height:6px; background:var(--bd); border-radius:3px; overflow:hidden; margin-bottom:6px; position:relative; }
  .dt-bench-progress-fill { height:100%; background:var(--ac); border-radius:3px; width:0%; transition:width .25s ease; }
  .dt-bench-progress-label { font-size:11px; color:var(--mu); font-family:'IBM Plex Mono',monospace; }

  /* Stats grid */
  .dt-bench-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-bottom:12px; }
  .dt-bench-stat { background:var(--sf); border:1px solid var(--bd); border-radius:8px; padding:8px 10px; text-align:center; }
  .dt-bench-stat-val { font-size:16px; font-weight:700; color:var(--tx); font-family:'IBM Plex Mono',monospace; line-height:1.2; }
  .dt-bench-stat-val.good { color:var(--gn); }
  .dt-bench-stat-val.warn { color:var(--am); }
  .dt-bench-stat-val.bad  { color:var(--rd); }
  .dt-bench-stat-lbl { font-size:9px; color:var(--mu); text-transform:uppercase; letter-spacing:.1em; margin-top:3px; }

  /* Sparkline chart */
  .dt-bench-chart { width:100%; display:block; margin-bottom:10px; border-radius:6px; background:var(--sf); }

  /* Per-run list */
  .dt-bench-run-list { max-height:160px; overflow-y:auto; display:flex; flex-direction:column; gap:3px; }
  .dt-bench-run-row { display:flex; align-items:center; gap:8px; padding:4px 8px; border-radius:5px; font-size:11px; font-family:'IBM Plex Mono',monospace; }
  .dt-bench-run-row:nth-child(odd) { background:var(--sf); }
  .dt-bench-run-num { color:var(--mu); width:24px; flex-shrink:0; }
  .dt-bench-run-time { font-weight:600; flex:1; }
  .dt-bench-run-status { font-size:10px; padding:1px 5px; border-radius:3px; flex-shrink:0; }
  .dt-bench-run-status.ok  { background:var(--gn-bg); color:var(--gn); }
  .dt-bench-run-status.err { background:var(--rd-bg); color:var(--rd); }

  /* Copy / abort */
  .dt-bench-copy-btn { font-size:10px; color:var(--mu); background:transparent; border:1px solid var(--bd); border-radius:4px; padding:2px 8px; cursor:pointer; transition:all .15s; }
  .dt-bench-copy-btn:hover { color:var(--ac); border-color:var(--ac-bd); background:var(--ac-bg); }
  .dt-bench-clear-results-btn:hover { color:var(--rd) !important; border-color:var(--rd-bd) !important; background:var(--rd-bg) !important; }

  /* Last result accordion */
  .dt-bench-accordion { border:1.5px solid var(--bd); border-radius:8px; overflow:hidden; }
  .dt-bench-accordion-hd { display:flex; align-items:center; gap:8px; width:100%; padding:8px 10px; background:var(--sf); border:none; cursor:pointer; text-align:left; transition:background .15s; }
  .dt-bench-accordion-hd:hover { background:var(--sf2); }
  .dt-bench-accordion-label { font-size:11px; font-weight:600; color:var(--tx2); flex-shrink:0; }
  .dt-bench-accordion-pill { flex:1; min-width:0; display:flex; align-items:center; overflow:hidden; }
  .dt-bench-accordion-arrow { flex-shrink:0; color:var(--mu); transition:transform .2s; }
  .dt-bench-accordion-body { border-top:1px solid var(--bd); background:var(--bg); }
  .dt-bench-accordion-row { display:flex; gap:10px; padding:7px 10px; border-bottom:1px solid var(--bd); }
  .dt-bench-accordion-row:last-child { border-bottom:none; }
  .dt-bench-accordion-key { font-size:10px; font-weight:600; color:var(--mu); text-transform:uppercase; letter-spacing:.06em; flex-shrink:0; width:52px; padding-top:1px; }
  .dt-bench-accordion-val { font-size:11px; color:var(--tx); font-family:'IBM Plex Mono',monospace; word-break:break-all; flex:1; line-height:1.6; }

  /* Skip / Skip-All buttons in req modal footer */
  .dt-foot-btn-skip { background:var(--bg); border-color:var(--am-bd); color:var(--am); flex:0.7; }
  .dt-foot-btn-skip:hover { background:var(--am-bg); border-color:var(--am); color:var(--am); }
  .dt-foot-btn-skip-all { background:var(--bg); border-color:var(--bd); color:var(--mu); flex:0.7; font-size:11.5px; }
  .dt-foot-btn-skip-all:hover { background:var(--am-bg); border-color:var(--am-bd); color:var(--am); }

  /* Mock Fail button in req modal footer — answers with a mocked failure
     response instead of sending the request. */
  .dt-foot-btn-mock { background:var(--bg); border-color:var(--rd-bd); color:var(--rd); flex:0.7; }
  .dt-foot-btn-mock:hover { background:var(--rd-bg); border-color:var(--rd); color:var(--rd); }

  /* Mock failure response config (Network panel) */
  .dt-mock-status-input { width:64px; padding:5px 8px; border:1.5px solid var(--bd); border-radius:6px; background:var(--sf); color:var(--tx); font-family:'IBM Plex Mono',monospace; font-size:11.5px; text-align:center; outline:none; transition:border-color .15s; }
  .dt-mock-status-input:focus { border-color:var(--ac); box-shadow:0 0 0 3px var(--ac-bg); }
  .dt-mock-body-ed { width:100%; min-height:64px; box-sizing:border-box; padding:8px 10px; border:1.5px solid var(--bd); border-radius:7px; background:var(--sf); color:var(--tx); font-family:'IBM Plex Mono',monospace; font-size:11px; line-height:1.5; outline:none; resize:vertical; transition:border-color .15s; }
  .dt-mock-body-ed:focus { border-color:var(--ac); box-shadow:0 0 0 3px var(--ac-bg); }
  .dt-mock-body-ed::placeholder { color:var(--fa); }
  /* Non-JSON mock body — served as application/json, so it would read back as
     null for JSON consumers. Flagged, not blocked. */
  .dt-mock-body-ed.dt-mock-invalid, .dt-baseurl-mock-input.dt-mock-invalid { border-color:var(--rd); }
  .dt-mock-body-ed.dt-mock-invalid:focus, .dt-baseurl-mock-input.dt-mock-invalid:focus { box-shadow:0 0 0 3px var(--rd-bg); }

  /* Duplicate param button */
  .dt-param-dup { width:24px; height:24px; border-radius:5px; cursor:pointer; background:transparent; border:1px solid var(--bd); color:var(--fa); font-size:13px; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all .12s; }
  .dt-param-dup:hover { border-color:var(--ac-bd); color:var(--ac); background:var(--ac-bg); }

  /* Wrap toggle button active state */
  .dt-wrap-toggle-btn.active { color:var(--ac) !important; border-color:var(--ac-bd) !important; background:var(--ac-bg) !important; }

  /* Editor resize handle */
  .dt-editor-resize-handle { height:6px; cursor:ns-resize; background:transparent; border-top:1px solid var(--bd); flex-shrink:0; transition:background .15s; display:flex; align-items:center; justify-content:center; }
  .dt-editor-resize-handle:hover,.dt-editor-resize-handle:active { background:var(--ac-bd); }
  .dt-editor-resize-handle::after { content:''; display:block; width:24px; height:2px; background:var(--bd); border-radius:1px; }

  /* Base URL panel */
  .dt-baseurl-group { border:1.5px solid var(--bd); border-radius:9px; overflow:hidden; margin-bottom:10px; background:var(--bg); transition:border-color .15s; }
  .dt-baseurl-group-head { display:flex; align-items:center; gap:8px; padding:9px 12px; background:var(--sf); }
  .dt-baseurl-group-label-input { font-size:12px; font-weight:600; color:var(--tx); flex:1; min-width:0; background:transparent; border:none; outline:none; }
  .dt-baseurl-group-label-input::placeholder { color:var(--fa); font-weight:400; }
  .dt-baseurl-group-body { padding:10px 12px; display:flex; flex-direction:column; gap:8px; border-top:1px solid var(--bd); }
  .dt-baseurl-entry { display:flex; gap:6px; align-items:center; position:relative; }
  .dt-baseurl-entry-color { width:16px; height:16px; border-radius:50%; flex-shrink:0; cursor:pointer; border:1.5px solid var(--bd); transition:transform .15s; }
  .dt-baseurl-entry-color:hover { transform:scale(1.12); }
  .dt-baseurl-entry-label-input { font-size:11px; font-weight:500; color:var(--tx2); width:80px; flex-shrink:0; background:var(--sf); border:1px solid var(--bd); border-radius:5px; padding:5px 8px; outline:none; transition:border-color .15s; font-family:'IBM Plex Sans',sans-serif; }
  .dt-baseurl-entry-label-input:focus { border-color:var(--ac); }
  .dt-baseurl-entry-url { flex:1; font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--tx); background:var(--sf); border:1px solid var(--bd); border-radius:5px; padding:5px 8px; outline:none; transition:border-color .15s; min-width:0; }
  .dt-baseurl-entry-url:focus { border-color:var(--ac); }
  .dt-baseurl-entry-del { width:22px; height:22px; border:1px solid var(--bd); border-radius:4px; background:transparent; cursor:pointer; color:var(--mu); display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all .15s; padding:0; }
  .dt-baseurl-entry-del:hover { border-color:var(--rd); color:var(--rd); background:var(--rd-bg); }
  .dt-baseurl-group-foot { display:flex; gap:6px; align-items:center; padding:6px 12px 10px; flex-wrap:wrap; }
  .dt-baseurl-group-del { display:inline-flex; align-items:center; gap:4px; padding:3px 8px; font-size:11px; color:var(--rd); background:transparent; border:1px solid var(--rd-bd); border-radius:5px; cursor:pointer; transition:all .15s; }
  .dt-baseurl-group-del:hover { background:var(--rd-bg); }
  .dt-baseurl-group-add-url { display:inline-flex; align-items:center; gap:4px; padding:3px 8px; font-size:11px; color:var(--ac); background:var(--ac-bg); border:1px solid var(--ac-bd); border-radius:5px; cursor:pointer; transition:all .15s; }
  .dt-baseurl-group-add-url:hover { background:#dbeafe; }
  .dt-baseurl-match-row { display:flex; align-items:center; gap:6px; }
  .dt-baseurl-match-label { font-size:11px; color:var(--mu); flex-shrink:0; }
  /* Mock Fail body overrides (group textarea + per-entry toggle button) */
  .dt-baseurl-mock-input { width:100%; min-height:48px; box-sizing:border-box; padding:6px 8px; border:1px solid var(--bd); border-radius:5px; background:var(--sf); color:var(--tx); font-family:'IBM Plex Mono',monospace; font-size:10.5px; line-height:1.5; outline:none; resize:vertical; transition:border-color .15s; }
  .dt-baseurl-mock-input:focus { border-color:var(--ac); }
  .dt-baseurl-mock-input::placeholder { color:var(--fa); }
  .dt-baseurl-entry-mock { width:26px; height:22px; border:1px solid var(--bd); border-radius:4px; background:transparent; cursor:pointer; color:var(--mu); display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all .15s; padding:0; font-family:'IBM Plex Mono',monospace; font-size:8.5px; font-weight:700; letter-spacing:.02em; }
  .dt-baseurl-entry-mock:hover, .dt-baseurl-entry-mock.has-mock { border-color:var(--am-bd); color:var(--am); background:var(--am-bg); }
  .dt-baseurl-entry-mock-wrap { display:none; margin:0 0 2px 22px; }
  .dt-baseurl-entry-mock-wrap.open { display:block; }
  .dt-baseurl-color-strip { display:flex; gap:5px; padding:2px 0; }
  .dt-baseurl-entry .dt-baseurl-color-strip { position:absolute; top:26px; left:0; z-index:20; background:var(--bg); border:1px solid var(--bd); border-radius:8px; padding:6px 8px; box-shadow:0 4px 16px rgba(0,0,0,.16); }
  .dt-baseurl-color-dot { width:16px; height:16px; border-radius:50%; cursor:pointer; border:2px solid transparent; transition:all .15s; flex-shrink:0; }
  .dt-baseurl-color-dot.selected { border-color:var(--tx); box-shadow:0 0 0 2px var(--bg); }

  /* Base URL floating action button */
  /* z-index sits BELOW the sidebar (999990) so an open sidebar always covers the
     FAB rather than the FAB floating on top of it. applyLayout() also slides the
     FAB along the sidebar's inner edge when open (right = width + 24), so it stays
     visible and usable instead of being hidden — hence the right/left transition. */
  #dt-baseurl-fab { position:fixed; bottom:24px; right:24px; z-index:999988; display:flex; flex-direction:column; align-items:flex-end; gap:6px; transition:right .28s var(--ease), left .28s var(--ease); }
  .dt-baseurl-fab-btn { display:flex; align-items:center; gap:7px; padding:9px 14px; background:var(--ac); color:var(--ac-tx,#fff); border:none; border-radius:30px; cursor:pointer; font-size:12px; font-weight:600; box-shadow:0 4px 16px var(--ring); transition:transform .16s var(--ease), box-shadow .18s, filter .15s; white-space:nowrap; font-family:'IBM Plex Sans',sans-serif; }
  .dt-baseurl-fab-btn:hover { filter:brightness(1.08); box-shadow:0 6px 22px var(--ring); transform:translateY(-1px); }
  .dt-baseurl-fab-btn:active { transform:translateY(0) scale(.97); }
  .dt-baseurl-fab-btn svg { transition:transform .25s var(--ease); }
  #dt-baseurl-fab:has(.dt-baseurl-fab-menu.open) .dt-baseurl-fab-btn svg { transform:rotate(180deg); }
  /* Menu floats ABOVE the button (absolute → no layout shift) and opens upward.
     Reveal is driven by display:none ↔ .open{display:block} — a hard toggle with
     no specificity/transition ambiguity — with a keyframe entrance animation that
     replays every time it opens (transform-origin bottom-right, grows out of the
     button corner). Prior versions used an opacity+visibility transition that
     failed to reveal in some page contexts; display toggling is bulletproof. */
  .dt-baseurl-fab-menu { display:none; position:absolute; bottom:calc(100% + 10px); right:0; background:var(--bg); border:1px solid var(--bd); border-radius:12px; box-shadow:var(--shadow-lg); padding:6px; min-width:210px; max-width:320px; transform-origin:bottom right; }
  .dt-baseurl-fab-menu.open { display:block; animation:dt-fab-menu-in .2s var(--ease); }
  @keyframes dt-fab-menu-in { from { opacity:0; transform:translateY(10px) scale(.96); } to { opacity:1; transform:none; } }
  .dt-baseurl-fab-menu.open .dt-baseurl-fab-item { animation:dt-fab-item-in .24s var(--ease) backwards; }
  .dt-baseurl-fab-menu.open .dt-baseurl-fab-item:nth-child(2) { animation-delay:.03s; }
  .dt-baseurl-fab-menu.open .dt-baseurl-fab-item:nth-child(3) { animation-delay:.06s; }
  .dt-baseurl-fab-menu.open .dt-baseurl-fab-item:nth-child(4) { animation-delay:.09s; }
  .dt-baseurl-fab-menu.open .dt-baseurl-fab-item:nth-child(n+5) { animation-delay:.12s; }
  @keyframes dt-fab-item-in { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:none; } }
  .dt-baseurl-fab-item { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:7px; cursor:pointer; transition:background .15s; }
  .dt-baseurl-fab-item:hover { background:var(--sf); }
  .dt-baseurl-fab-item.active { background:var(--ac-bg); }
  .dt-baseurl-fab-dot { width:9px; height:9px; border-radius:50%; flex-shrink:0; }
  .dt-baseurl-fab-item-label { font-size:11px; font-weight:600; color:var(--tx2); flex-shrink:0; }
  .dt-baseurl-fab-item-url { font-family:'IBM Plex Mono',monospace; font-size:10px; color:var(--mu); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }

  /* ── API Recorder ──────────────────────────────────────────────────────── */
  .dt-rec-target-row { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
  .dt-rec-target-type { font-family:'IBM Plex Mono',monospace; font-size:8.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; padding:3px 6px; border-radius:4px; flex-shrink:0; }
  .dt-rec-target-type.manual { background:var(--sf2); color:var(--mu); }
  .dt-rec-target-type.baseurl { background:var(--ac-bg); color:var(--ac); border:1px solid var(--ac-bd); }
  .dt-rec-target-label { flex:1; min-width:0; font-size:11px; color:var(--tx2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dt-rec-target-toggle { width:30px; height:16px; flex-shrink:0; }
  .dt-rec-target-toggle .dt-toggle-track { border-radius:8px; }
  .dt-rec-target-toggle .dt-toggle-thumb { top:2px; left:2px; width:10px; height:10px; }
  .dt-rec-target-toggle input:checked ~ .dt-toggle-track .dt-toggle-thumb { left:16px; }

  .dt-rec-bucket { border:1.5px solid var(--bd); border-radius:9px; overflow:hidden; margin-bottom:10px; }
  .dt-rec-bucket-head { display:flex; align-items:center; gap:8px; padding:9px 12px; background:var(--sf); cursor:pointer; }
  .dt-rec-bucket-label { font-size:12px; font-weight:600; color:var(--tx); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dt-rec-bucket-count { font-family:'IBM Plex Mono',monospace; font-size:9.5px; color:var(--mu); background:var(--sf2); border-radius:10px; padding:2px 8px; flex-shrink:0; }
  .dt-rec-bucket-body { border-top:1px solid var(--bd); display:none; }
  .dt-rec-bucket.open .dt-rec-bucket-body { display:block; }
  .dt-rec-bucket-arrow { display:inline-block; transition:transform .15s; flex-shrink:0; color:var(--mu); font-size:9px; }
  .dt-rec-bucket.open .dt-rec-bucket-arrow { transform:rotate(90deg); }

  .dt-rec-kebab-btn { width:26px; height:26px; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:transparent; border:1px solid transparent; border-radius:6px; color:var(--mu); cursor:pointer; transition:all .15s; }
  .dt-rec-kebab-btn:hover { background:var(--sf2); border-color:var(--bd); color:var(--tx); }
  /* Rendered as a single shared "portal" element appended to <body> — NOT
     nested inside .dt-rec-bucket, which clips overflow for its rounded
     corners and would otherwise cut the dropdown off. */
  .dt-rec-kebab-menu { display:none; position:fixed; z-index:999996; background:var(--bg); border:1px solid var(--bd); border-radius:10px; box-shadow:0 8px 32px rgba(0,0,0,.18); padding:6px; min-width:175px; }
  .dt-rec-kebab-menu.open { display:block; }
  .dt-rec-kebab-item { display:block; width:100%; text-align:left; padding:8px 10px; border-radius:7px; cursor:pointer; transition:background .15s; background:none; border:none; font-size:11.5px; color:var(--tx2); font-family:'IBM Plex Sans',sans-serif; }
  .dt-rec-kebab-item:hover { background:var(--sf); color:var(--tx); }
  .dt-rec-kebab-item.danger:hover { background:var(--rd-bg); color:var(--rd); }
  .dt-rec-kebab-item.postman:hover { background:#fff1ec; color:#ff6c37; }
  .dt-rec-kebab-item:disabled { opacity:.42; cursor:default; }
  .dt-rec-kebab-item:disabled:hover { background:none; color:var(--tx2); }

  .dt-rec-endpoint { border-bottom:1px solid var(--bd); }
  .dt-rec-endpoint:last-child { border-bottom:none; }
  .dt-rec-endpoint-head { display:flex; align-items:center; gap:8px; padding:8px 12px; cursor:pointer; transition:background .12s; }
  .dt-rec-endpoint-head:hover { background:var(--sf); }
  .dt-rec-endpoint-method { font-family:'IBM Plex Mono',monospace; font-size:9px; font-weight:700; padding:2px 6px; border-radius:3px; color:#fff; flex-shrink:0; min-width:42px; text-align:center; }
  .dt-rec-endpoint-path { font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--tx2); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dt-rec-endpoint-count { font-size:10px; color:var(--fa); flex-shrink:0; }
  .dt-rec-endpoint-body { display:none; padding:0 12px 12px 12px; }
  .dt-rec-endpoint.open .dt-rec-endpoint-body { display:block; }
  .dt-rec-schema-block { margin-top:8px; }
  .dt-rec-schema-label { font-family:'IBM Plex Mono',monospace; font-size:9px; font-weight:500; letter-spacing:.1em; text-transform:uppercase; color:var(--mu); margin-bottom:4px; }
  .dt-rec-schema-pre { font-family:'IBM Plex Mono',monospace; font-size:10.5px; color:var(--tx); background:var(--sf); border:1px solid var(--bd); border-radius:6px; padding:8px 10px; white-space:pre-wrap; word-break:break-word; line-height:1.65; max-height:220px; overflow:auto; }
  .dt-rec-schema-pre .t-key { color:var(--ac); }
  .dt-rec-schema-pre .t-type { color:var(--vi); }
  .dt-rec-schema-pre .t-opt { color:var(--am); font-weight:700; cursor:help; }
  .dt-rec-endpoint-actions { display:flex; gap:6px; margin-top:10px; }
  .dt-rec-status-line { font-size:11px; color:var(--tx2); margin-bottom:6px; }

  /* Visually masks the Postman API key like a password field, WITHOUT using
     type="password" — that's what makes Chrome/most password managers offer to
     save it as a login. -webkit-text-security gives the same dots purely via
     CSS, so no credential heuristic ever triggers. (No effect in Firefox, which
     doesn't support the property — the field just shows plain text there.) */
  .dt-rec-secret-wrap { position:relative; }
  .dt-rec-secret-input { -webkit-text-security:disc; }
  .dt-rec-secret-input.dt-rec-secret-visible { -webkit-text-security:none; }
  .dt-rec-secret-toggle { position:absolute; right:5px; top:50%; transform:translateY(-50%); width:24px; height:24px; display:flex; align-items:center; justify-content:center; background:none; border:none; padding:0; cursor:pointer; color:var(--mu); border-radius:4px; transition:color .15s,background .15s; }
  .dt-rec-secret-toggle:hover { color:var(--ac); background:var(--ac-bg); }

  /* ── Network Monitor ───────────────────────────────────────────────────── */
  .dt-mon-loglist { border:1.5px solid var(--bd); border-radius:9px; overflow:hidden; }
  .dt-mon-row { border-bottom:1px solid var(--bd); }
  .dt-mon-row:last-child { border-bottom:none; }
  .dt-mon-row-head { display:flex; align-items:center; gap:8px; padding:8px 10px; cursor:pointer; transition:background .12s; }
  .dt-mon-row-head:hover { background:var(--sf); }
  .dt-mon-method { font-family:'IBM Plex Mono',monospace; font-size:9px; font-weight:700; padding:2px 6px; border-radius:3px; color:#fff; flex-shrink:0; min-width:42px; text-align:center; }
  .dt-mon-status { font-family:'IBM Plex Mono',monospace; font-size:10.5px; font-weight:700; flex-shrink:0; min-width:24px; text-align:right; }
  .dt-mon-url { font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--tx2); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dt-mon-time { font-size:9.5px; color:var(--mu); flex-shrink:0; }
  .dt-mon-detail { display:none; padding:0 10px 12px 10px; }
  .dt-mon-row.open .dt-mon-detail { display:block; }
  .dt-mon-meta { font-size:10.5px; color:var(--mu); margin-bottom:8px; }

  /* ══════════════════════════════════════════════════════════════════════════
     UI REBUILD LAYER (v11)
     Appended so it overrides the base rules above at equal specificity. Retunes
     typography (raises the too-small/too-thin floor), iconography, header/nav,
     the split request/response filters, portal tooltips, and dark-mode fixes.
     ══════════════════════════════════════════════════════════════════════════ */

  /* Inline SVG icons share the current text color and never shrink */
  .dt-ico { display:inline-block; flex-shrink:0; vertical-align:middle; }
  #dt-sidebar, .dt-overlay { -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; }

  /* ── Typography floor: nudge the smallest/thinnest text up so nothing is a
     strain to read, especially in dark mode. ─────────────────────────────── */
  .dt-slabel { font-size:9.5px; font-weight:600; color:var(--mu); display:flex; align-items:center; gap:6px; margin-bottom:12px; }
  .dt-slabel-ico { display:inline-flex; align-items:center; color:var(--ac); }
  .dt-flabel { font-size:9.5px; font-weight:600; color:var(--mu); }
  .dt-head-sub { font-size:10px; color:var(--mu); }
  .dt-modal-url { font-size:10.5px; color:var(--mu); }
  .dt-modal-count { font-size:10px; color:var(--mu); }
  .dt-headers-label { font-size:9.5px; font-weight:600; color:var(--mu); }
  .dt-headers-count { font-size:9.5px; color:var(--mu); font-weight:500; }
  .dt-hkey { font-size:10.5px; font-weight:600; color:var(--tx2); }
  .dt-hval { font-size:10.5px; font-weight:400; color:var(--tx2); }
  .dt-hkey-input { font-size:10.5px; font-weight:600; color:var(--tx2); }
  .dt-hval-input { font-size:10.5px; color:var(--tx2); }
  .dt-regex-delim { font-weight:400; color:var(--mu); }
  .dt-regex-input, .dt-search-input, .dt-param-input { font-size:12px; }
  .dt-editor-btn, .dt-search-toggle-btn, .dt-json-badge, .dt-search-count { font-size:10.5px; }
  .dt-tree { font-size:11.5px; color:var(--tx2); }
  .dt-tree-type { font-size:9.5px; color:var(--mu); }
  .dt-tree-val { color:var(--tx2); }
  .dt-mon-time { font-size:10px; color:var(--mu); }
  .dt-feature-desc { color:var(--tx2); }
  .dt-note { font-size:11.5px; color:var(--tx2); line-height:1.55; }
  .dt-note em { font-style:normal; font-weight:600; color:var(--tx); }
  .dt-note-tight { margin:-4px 0 12px; }

  /* ── Header & pull tab ─────────────────────────────────────────────────── */
  .dt-head { padding:16px 16px 14px; gap:12px; background:linear-gradient(180deg,var(--sf) 0%,var(--bg) 100%); }
  .dt-head-icon { width:34px; height:34px; border-radius:10px; color:var(--ac); background:var(--ac-bg); border:1px solid var(--ac-bd); }
  .dt-head-title { font-size:14.5px; font-weight:600; letter-spacing:-.01em; }
  .dt-head-close:hover, .dt-head-settings:hover { transform:translateY(-1px); }
  #dt-tab-chevron { display:inline-flex; color:var(--mu); }
  #dt-tab.active #dt-tab-chevron { color:var(--ac); }

  /* ── Nav ───────────────────────────────────────────────────────────────── */
  /* overflow-y:hidden — the tabs' -1px underline offset makes the strip 1px
     taller than its box, and with the default overflow that single pixel was
     wheel-scrollable: the whole tab row visibly nudged up/down instead of
     sliding sideways. Horizontal wheel-sliding is handled in bindUI(). */
  .dt-nav { padding:0 12px; gap:2px; overflow-y:hidden; }
  .dt-nav-btn { font-size:12.5px; font-weight:500; padding:11px 10px 10px; border-bottom:2.5px solid transparent; }

  /* ── Sections with request/response accent rails ───────────────────────── */
  .dt-section { padding:16px 18px; position:relative; }
  .dt-section-accent-req::before, .dt-section-accent-res::before {
    content:''; position:absolute; left:0; top:0; bottom:0; width:3px; border-radius:0 3px 3px 0;
  }
  .dt-section-accent-req::before { background:linear-gradient(180deg,var(--am),transparent 85%); }
  .dt-section-accent-res::before { background:linear-gradient(180deg,var(--vi),transparent 85%); }

  /* ── Split filter blocks (global / request / response) ─────────────────── */
  .dt-filter-block { background:var(--sf); border:1px solid var(--bd); border-radius:10px; padding:12px; }
  .dt-filter-block[data-ns="net"] { background:var(--ac-bg); border-color:var(--ac-bd); }
  .dt-filter-sub { font-family:'IBM Plex Mono',monospace; font-size:9.5px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--mu); margin-bottom:9px; }
  .dt-filter-block .dt-mode-group { margin-top:9px; }
  .dt-filter-block .dt-regex-wrap.visible { margin-top:9px; }
  .dt-method-pill { font-size:10.5px; padding:4px 11px; }
  .dt-mode-btn { font-size:12px; font-weight:600; padding:8px; }
  .dt-chip { font-size:10px; color:var(--tx2); }

  /* ── Collapsible per-interceptor filter disclosure ─────────────────────── */
  .dt-disclosure { margin-top:12px; border:1px solid var(--bd); border-radius:10px; overflow:hidden; background:var(--bg); }
  .dt-disclosure-hd { display:flex; align-items:center; gap:8px; width:100%; padding:9px 11px; background:var(--sf); border:none; cursor:pointer; text-align:left; font-size:12px; font-weight:500; color:var(--tx2); transition:background .15s; font-family:inherit; }
  .dt-disclosure-hd:hover { background:var(--sf2); color:var(--tx); }
  .dt-disclosure-arrow { display:inline-flex; color:var(--mu); transition:transform .18s var(--ease); }
  .dt-disclosure.open .dt-disclosure-arrow { transform:rotate(90deg); }
  .dt-disclosure-hint { margin-left:auto; font-family:'IBM Plex Mono',monospace; font-size:9.5px; color:var(--mu); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:150px; }
  .dt-disclosure-body { display:none; padding:12px; border-top:1px solid var(--bd); }
  .dt-disclosure.open .dt-disclosure-body { display:block; }
  .dt-disclosure .dt-filter-block { background:transparent; border:none; padding:0; }

  /* ── Toggles (slightly larger, crisper track) ──────────────────────────── */
  .dt-toggle-track { border-width:1.5px; }
  .dt-toggle input:checked ~ .dt-toggle-track { box-shadow:0 0 0 3px var(--ac-bg); }

  /* ── Editor bar buttons: consistent bordered chips with inline icons ────── */
  .dt-editor-bar { gap:6px; padding:8px 10px; border-top:1px solid var(--bd); background:var(--sf); }
  .dt-editor-btn { font-weight:500; color:var(--tx2); background:var(--bg); border:1px solid var(--bd); padding:4px 10px; border-radius:6px; }
  .dt-editor-btn:hover { border-color:var(--bd2); color:var(--tx); background:var(--sf2); }
  .dt-editor-btn-ico { display:inline-flex; align-items:center; gap:5px; }
  .dt-search-toggle-btn { color:var(--tx2); background:var(--bg); border:1px solid var(--bd); border-radius:6px; }
  .dt-search-toggle-btn.active { color:var(--ac); border-color:var(--ac-bd); background:var(--ac-bg); }
  .dt-snav, .dt-sclose { border:1px solid var(--bd); color:var(--mu); }
  .dt-snav:hover, .dt-sclose:hover { border-color:var(--ac-bd); color:var(--ac); background:var(--ac-bg); }
  .dt-search-icon { display:inline-flex; color:var(--mu); }

  /* ── Modal chrome ──────────────────────────────────────────────────────── */
  .dt-modal { border-radius:16px; box-shadow:var(--shadow-lg); }
  .dt-modal-head { padding:16px 18px; background:linear-gradient(180deg,var(--sf),var(--bg)); }
  .dt-modal-icon { width:38px; height:38px; border-radius:11px; }
  .dt-modal-icon.req { color:var(--am); }
  .dt-modal-icon.res { color:var(--vi); }
  .dt-foot-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; border-radius:9px; }
  .dt-foot-btn-send:hover { background:var(--ac); filter:brightness(1.08); border-color:var(--ac); color:var(--ac-tx,#fff); box-shadow:0 4px 14px var(--ring); }
  .dt-preview-arrow { color:var(--mu); }

  /* ── Portal tooltip: rendered at <html> level (outside the transformed
     sidebar) so position:fixed resolves against the viewport. Fixes the popover
     being pushed off-screen when the sidebar sits on the right. ──────────── */
  .dt-tip-icon { border-color:var(--bd2); color:var(--mu); font-size:10px; }
  .dt-tip:hover .dt-tip-icon { border-color:var(--ac); color:var(--ac); }
  #dt-tip-portal {
    position:fixed; z-index:2147483600; width:230px; max-width:230px;
    background:var(--sf2); color:var(--tx2); border:1px solid var(--bd);
    border-radius:9px; padding:10px 12px; font-size:11.5px; line-height:1.55;
    font-family:'IBM Plex Sans',-apple-system,sans-serif; box-shadow:var(--shadow-md);
    pointer-events:none; opacity:0; transform:translateY(-3px); transition:opacity .12s,transform .12s;
    display:none;
  }
  #dt-tip-portal.visible { display:block; opacity:1; transform:translateY(0); }

  /* ── About panel iconography ───────────────────────────────────────────── */
  .dt-about-icon { color:var(--ac); border-radius:15px; }
  .dt-feature-ico { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:8px; background:var(--ac-bg); border:1px solid var(--ac-bd); color:var(--ac); margin-top:0; }
  .dt-feature-item { border-radius:10px; }
  .dt-feature-name { color:var(--tx); }

  /* ── Dark-mode hover fixes: base rules hardcode light hover fills that look
     wrong on a dark surface. Re-point them at tokens. ────────────────────── */
  .dt-dark .dt-add-param:hover, .dt-dark .dt-param-add-suggested:hover,
  .dt-dark .dt-path-btn-extract:hover, .dt-dark .dt-baseurl-group-add-url:hover { background:var(--ac-bd); }
  .dt-dark .dt-path-btn-wrap:hover { background:var(--gn-bd); }
  .dt-dark .dt-transform-run-btn:hover { background:var(--vi-bd); }
  .dt-dark .dt-bench-run-btn:hover { filter:brightness(1.12); background:var(--ac); }

  /* ── Keyboard shortcuts settings ─────────────────────────────────────────── */
  .dt-kb-list { display:flex; flex-direction:column; gap:10px; }
  .dt-kb-row { display:flex; align-items:center; gap:10px; }
  .dt-kb-info { flex:1; min-width:0; }
  .dt-kb-input { flex-shrink:0; min-width:104px; min-height:30px; display:flex; align-items:center; justify-content:center; gap:2px; padding:4px 10px; border:1.5px solid var(--bd); border-radius:7px; background:var(--sf); cursor:pointer; transition:all .15s; }
  .dt-kb-input:hover { border-color:var(--bd2); background:var(--sf2); }
  .dt-kb-input.capturing { border-color:var(--ac); background:var(--ac-bg); box-shadow:0 0 0 3px var(--ring); }
  .dt-kb-hint { font-size:11px; font-style:normal; color:var(--mu); }
  .dt-kb-input.capturing .dt-kb-hint { color:var(--ac); }
  .dt-kbd { font-family:'IBM Plex Mono',monospace; font-size:10px; font-weight:600; line-height:1; color:var(--tx); background:var(--bg); border:1px solid var(--bd2); border-bottom-width:2px; border-radius:4px; padding:3px 5px; }
  .dt-kb-plus { font-size:10px; color:var(--mu); padding:0 1px; }
  .dt-kb-reset { flex-shrink:0; width:24px; height:24px; display:flex; align-items:center; justify-content:center; border:none; background:transparent; color:var(--mu); border-radius:6px; cursor:pointer; transition:all .15s; }
  .dt-kb-reset:hover { background:var(--rd-bg); color:var(--rd); }
  .dt-kb-reset-hidden { visibility:hidden; }

  /* ── Edit Memory: in-modal suggestion chips ──────────────────────────────── */
  .dt-edit-suggest { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:8px; padding:8px 10px; border:1px solid var(--vi-bd); border-radius:8px; background:var(--vi-bg); }
  .dt-es-label { width:100%; font-size:10px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:var(--vi); margin-bottom:2px; }
  .dt-es-chip { display:inline-flex; align-items:center; gap:8px; max-width:100%; padding:4px 4px 4px 10px; border:1px solid var(--vi-bd); border-radius:7px; background:var(--bg); color:var(--tx2); font-size:11px; cursor:pointer; transition:all .13s; }
  .dt-es-chip:hover { border-color:var(--vi); color:var(--tx); }
  .dt-es-chip-txt { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dt-es-apply { flex-shrink:0; font-size:10px; font-weight:600; color:#fff; background:var(--vi); border-radius:5px; padding:2px 7px; }

  /* ── Edit Memory: management list (Network panel) ─────────────────────────── */
  .dt-edit-mem-list { display:flex; flex-direction:column; gap:6px; max-height:240px; overflow-y:auto; }
  .dt-edit-mem-empty { font-size:11px; color:var(--mu); line-height:1.5; padding:6px 2px; }
  .dt-edit-mem-item { display:flex; align-items:flex-start; gap:8px; padding:8px 9px; border:1px solid var(--bd); border-radius:8px; background:var(--sf); }
  .dt-edit-mem-main { flex:1; min-width:0; }
  .dt-edit-mem-sum { font-size:12px; font-weight:500; color:var(--tx); line-height:1.35; word-break:break-word; }
  .dt-edit-mem-meta { display:flex; align-items:center; gap:5px; flex-wrap:wrap; font-size:10.5px; color:var(--mu); margin-top:3px; }
  .dt-edit-mem-path { font-family:'IBM Plex Mono',monospace; }
  .dt-edit-mem-ns { font-family:'IBM Plex Mono',monospace; font-size:9px; font-weight:700; letter-spacing:.05em; padding:1px 4px; border-radius:4px; }
  .dt-edit-mem-ns-req { color:var(--am); background:var(--am-bg); }
  .dt-edit-mem-ns-res { color:var(--vi); background:var(--vi-bg); }
  .dt-edit-mem-del { flex-shrink:0; width:24px; height:24px; display:flex; align-items:center; justify-content:center; border:none; background:transparent; color:var(--mu); border-radius:6px; cursor:pointer; transition:all .15s; }
  .dt-edit-mem-del:hover { background:var(--rd-bg); color:var(--rd); }
  .dt-edit-mem-clear { display:flex; align-items:center; justify-content:center; gap:6px; width:100%; margin-top:8px; padding:7px; border:1px solid var(--bd); border-radius:7px; background:transparent; color:var(--rd); font-size:11px; font-weight:500; cursor:pointer; transition:all .15s; }
  .dt-edit-mem-clear:hover { background:var(--rd-bg); border-color:var(--rd-bd); }

  /* ── Intercept queue navigation (request modal foot) ─────────────────────── */
  .dt-qnav { flex:0 0 auto; width:24px; height:24px; display:flex; align-items:center; justify-content:center; border:1px solid var(--bd); background:var(--sf); color:var(--tx2); border-radius:6px; cursor:pointer; padding:0; transition:all .15s; }
  .dt-qnav:hover { border-color:var(--ac-bd); color:var(--ac); background:var(--ac-bg); }

  /* ── Sidebar palette picker ───────────────────────────────────────────────── */
  .dt-sb-palette-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(66px,1fr)); gap:6px; }
  .dt-sb-palette { display:flex; flex-direction:column; align-items:center; gap:4px; padding:5px 4px; background:var(--sf); border:1.5px solid var(--bd); border-radius:8px; cursor:pointer; transition:all .15s; }
  .dt-sb-palette:hover { border-color:var(--ac-bd); }
  .dt-sb-palette.active { border-color:var(--ac); background:var(--ac-bg); }
  .dt-sb-palette-chip { display:flex; width:100%; height:22px; border-radius:5px; overflow:hidden; border:1px solid var(--bd); }
  .dt-sb-palette-half { flex:1; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:700; font-family:'IBM Plex Mono',monospace; }
  .dt-sb-palette-name { font-size:9.5px; color:var(--tx2); max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  /* ── Form Autofill plugin ─────────────────────────────────────────────────── */
  .dt-ff-empty { font-size:11px; color:var(--mu); padding:14px 0; text-align:center; font-style:italic; }
  .dt-ff-item { display:flex; align-items:center; gap:8px; padding:8px 10px; margin-bottom:5px; background:var(--sf); border:1.5px solid var(--bd); border-radius:7px; cursor:pointer; transition:all .15s; }
  .dt-ff-item:hover { border-color:var(--ac-bd); background:var(--ac-bg); }
  .dt-ff-item.selected { border-color:var(--ac); background:var(--ac-bg); }
  .dt-ff-item-main { flex:1; min-width:0; }
  .dt-ff-item-name { font-size:12px; font-weight:600; color:var(--tx); font-family:'IBM Plex Mono',monospace; word-break:break-all; }
  .dt-ff-item-meta { font-size:10.5px; color:var(--mu); margin-top:2px; }
  .dt-ff-item-cta { flex-shrink:0; font-size:10px; font-weight:600; color:var(--ac); }
  .dt-ff-hint { font-size:10px; color:var(--mu); line-height:1.5; font-family:'IBM Plex Mono',monospace; word-break:break-word; }
  .dt-ff-field { border:1px solid var(--bd); border-radius:7px; background:var(--sf); padding:7px 9px; margin-bottom:6px; }
  .dt-ff-field-head { display:flex; align-items:center; gap:8px; }
  .dt-ff-field-name { flex:1; min-width:0; font-size:11.5px; font-weight:500; color:var(--tx); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dt-ff-badge { flex-shrink:0; font-size:9px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; padding:1px 5px; border-radius:4px; color:var(--tx2); background:var(--sf2); border:1px solid var(--bd); font-family:'IBM Plex Mono',monospace; }
  .dt-ff-field-body { margin-top:7px; display:flex; flex-direction:column; gap:5px; }
  .dt-ff-val-row { display:flex; align-items:center; gap:6px; }
  .dt-ff-val-wrap { flex:1; min-width:0; display:flex; }
  .dt-ff-input, .dt-ff-select { flex:1; min-width:0; width:100%; padding:5px 8px; border:1.5px solid var(--bd); border-radius:6px; background:var(--sf); color:var(--tx); font-size:11px; font-family:'IBM Plex Mono',monospace; outline:none; transition:border-color .15s; box-sizing:border-box; }
  .dt-ff-input:focus, .dt-ff-select:focus { border-color:var(--ac); box-shadow:0 0 0 3px var(--ac-bg); }
  .dt-ff-select { cursor:pointer; }
  .dt-ff-cond-row { display:flex; align-items:center; gap:4px; }
  .dt-ff-cond-row .dt-ff-cond-param { flex:1; }
  .dt-ff-cond-row .dt-ff-cond-match { flex:1; }
  .dt-ff-cond-txt { flex-shrink:0; font-size:10px; color:var(--mu); font-family:'IBM Plex Mono',monospace; }
  .dt-ff-add-cond { align-self:flex-start; border:none; background:transparent; color:var(--ac); font-size:10.5px; font-weight:500; cursor:pointer; padding:2px 0; }
  .dt-ff-add-cond:hover { text-decoration:underline; }
  .dt-ff-cond-del { flex-shrink:0; width:20px; height:20px; display:flex; align-items:center; justify-content:center; border:none; background:transparent; color:var(--mu); border-radius:5px; cursor:pointer; transition:all .15s; }
  .dt-ff-cond-del:hover { background:var(--rd-bg); color:var(--rd); }
  /* Show/hide: the core's overlay visibility rules are ID-scoped to the four
     static overlays, so this runtime-created one needs its own — without them
     it stays painted (but click-through) after .visible is removed. */
  #dt-ff-overlay { visibility:hidden; opacity:0; pointer-events:none; transition:opacity .18s ease; }
  #dt-ff-overlay.visible { visibility:visible; opacity:1; pointer-events:all; }
  #dt-ff-modal { width:640px; height:auto; min-height:340px; max-height:92vh; }
  .dt-ff-modal-toggles { display:flex; gap:24px; margin-bottom:10px; padding:9px 12px; background:var(--sf); border:1px solid var(--bd); border-radius:8px; }
  .dt-ff-modal-toggles .dt-row { flex:1; margin:0; }
  .dt-ff-modal-close { flex-shrink:0; width:28px; height:28px; display:flex; align-items:center; justify-content:center; border:none; background:transparent; color:var(--mu); border-radius:7px; cursor:pointer; transition:all .15s; }
  .dt-ff-modal-close:hover { background:var(--sf2); color:var(--tx); }
  .dt-ff-foot-neutral { background:transparent; border-color:var(--bd); color:var(--tx2); flex:0 0 auto; padding-left:16px; padding-right:16px; }
  .dt-ff-foot-neutral:hover { border-color:var(--ac-bd); color:var(--ac); background:var(--ac-bg); }
  #dt-ff-overlay .dt-modal-count { flex:1; text-align:left; color:var(--mu); }
  #dt-ff-overlay .dt-foot-btn-send { flex:0 0 auto; padding-left:18px; padding-right:18px; }

  /* ── Hotkey toast ─────────────────────────────────────────────────────────── */
  #dt-hotkey-toast { position:fixed; z-index:2147483646; bottom:24px; left:50%; transform:translateX(-50%) translateY(10px); display:flex; align-items:center; gap:9px; padding:10px 16px; border-radius:10px; background:rgba(22,23,27,.94); color:#f4f5fa; font-family:'IBM Plex Sans',system-ui,sans-serif; font-size:13px; font-weight:500; letter-spacing:.01em; box-shadow:0 8px 30px rgba(0,0,0,.35); backdrop-filter:blur(6px); opacity:0; pointer-events:none; transition:opacity .18s var(--ease,ease),transform .18s var(--ease,ease); }
  #dt-hotkey-toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
  .dt-hotkey-toast-dot { width:8px; height:8px; border-radius:50%; background:#71768a; box-shadow:0 0 0 3px rgba(113,118,138,.22); flex-shrink:0; }
  .dt-hotkey-toast-dot.on { background:#54c98a; box-shadow:0 0 0 3px rgba(84,201,138,.28); }
`;
