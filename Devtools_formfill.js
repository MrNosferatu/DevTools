// ==UserScript==
// @name         DevTools Sidebar — Form Autofill Plugin
// @namespace    http://tampermonkey.net/
// @version      3.6.7
// @description  Form Autofill plugin for DevTools Sidebar — detect forms on the page, configure per-field fill values (fixed text, dynamic tokens, or defaults for selects/radios/checkboxes), with URL-param conditions, and fill them automatically on load.
// @author       MrNosferatu
// ==/UserScript==

// Registers a factory rather than running immediately — see Devtools_plugins.js.
DT_registerPlugin(function createFormFillPlugin(ctx) {
  const { Store, state, $, $1, root, escHtml } = ctx;

  // Input types that can never be meaningfully autofilled from the panel.
  const SKIP_TYPES = ['hidden', 'submit', 'button', 'reset', 'image', 'file'];

  // ─── Page form detection ─────────────────────────────────────────────────────
  // Field/form keys are stable identifiers persisted in the saved config, so a
  // config keeps applying across visits: prefer name/id, fall back to position.
  function classify(el) {
    if (el.tagName === 'SELECT') return 'select';
    if (el.tagName === 'TEXTAREA') return 'text';
    const t = (el.type || 'text').toLowerCase();
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    return 'text'; // date/time/number/etc all accept a rendered template string
  }

  function cleanLabel(t) {
    t = String(t).replace(/\s+/g, ' ').trim().replace(/[:*]\s*$/, '').trim();
    return t.length > 60 ? t.slice(0, 57) + '…' : t;
  }

  // Semantically-associated label: <label for=...> or a wrapping <label>.
  function explicitLabelText(el) {
    if (el.id) {
      const lab = document.querySelector(`label[for="${window.CSS && window.CSS.escape ? window.CSS.escape(el.id) : el.id}"]`);
      if (lab && lab.textContent.trim()) return cleanLabel(lab.textContent);
    }
    const wrap = el.closest('label');
    if (wrap && wrap.textContent.trim()) return cleanLabel(wrap.textContent);
    return '';
  }

  // Fallback for inputs with no semantic label: a label/span/legend sitting in
  // the same container (e.g. <div><span>Username</span><input></div>). Walks up
  // a few wrapper levels, but bails as soon as an ancestor holds OTHER fields —
  // any text found there could belong to a different field. Same-name radios
  // don't count as "other" so a group can share its container's label/legend.
  function nearbyLabelText(el) {
    let node = el;
    for (let depth = 0; depth < 3; depth++) {
      const parent = node.parentElement;
      if (!parent || parent.tagName === 'FORM' || parent.tagName === 'BODY') break;
      const others = [...parent.querySelectorAll('input,select,textarea')]
        .filter(c => c !== el && !((el.type || '').toLowerCase() === 'radio' && c.name && c.name === el.name));
      if (others.length) break;
      const cands = [...parent.querySelectorAll('label,span,legend')]
        .filter(c => !c.contains(el) && !c.querySelector('input,select,textarea') && c.textContent.trim());
      // Prefer text that appears BEFORE the input (the usual label position),
      // but accept trailing text too (common for checkboxes).
      const before = cands.find(c => c.compareDocumentPosition(el) & 4 /* el follows c */);
      const pick = before || cands[0];
      if (pick) return cleanLabel(pick.textContent);
      node = parent;
    }
    return '';
  }

  function labelFor(el) {
    return explicitLabelText(el)
      || el.getAttribute('aria-label')
      || nearbyLabelText(el)
      || el.placeholder || el.name || el.id || el.tagName.toLowerCase();
  }

  // A single radio option: the group-level fallbacks (name/nearby container
  // text) would stamp every option with the same label, so use only the
  // option's own label or its value.
  function optionLabelFor(el) {
    return explicitLabelText(el) || el.getAttribute('aria-label') || el.value;
  }

  function collectFields(root) {
    // Never pick up the sidebar's own inputs (or the FAB/modals) — everything
    // this userscript injects lives under dt-* ids.
    const els = [...root.querySelectorAll('input,select,textarea')].filter(el =>
      !SKIP_TYPES.includes((el.type || '').toLowerCase()) &&
      !el.closest('[id^="dt-"]'));
    const fields = [];
    const radioGroups = {};
    els.forEach((el, i) => {
      const type = classify(el);
      if (type === 'radio') {
        const name = el.name || '@radio' + i;
        const opt = { value: el.value, label: optionLabelFor(el) };
        if (radioGroups[name]) { radioGroups[name].els.push(el); radioGroups[name].options.push(opt); return; }
        const fd = { key: 'r:' + name, label: nearbyLabelText(el) || name, type, inputType: 'radio', els: [el], options: [opt] };
        radioGroups[name] = fd;
        fields.push(fd);
        return;
      }
      const key = el.name ? 'n:' + el.name : el.id ? 'i:' + el.id : '@' + i;
      fields.push({
        key,
        label: labelFor(el),
        type,
        inputType: el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text').toLowerCase(),
        el,
        options: type === 'select'
          ? [...el.options].map(o => ({ value: o.value, label: (o.textContent || '').trim() || o.value }))
          : type === 'checkbox'
            ? [{ value: 'checked', label: 'Checked' }, { value: 'unchecked', label: 'Unchecked' }]
            : null,
      });
    });
    return fields;
  }

  function formKeyOf(form, idx) {
    if (form.id) return 'id:' + form.id;
    const name = form.getAttribute('name');
    if (name) return 'nm:' + name;
    let action = '';
    try { action = new URL(form.getAttribute('action') || '', location.href).pathname; } catch { /* keep '' */ }
    return 'ix:' + idx + ':' + action;
  }

  function formLabelOf(form, idx) {
    if (form.id) return '#' + form.id;
    const name = form.getAttribute('name');
    if (name) return name;
    const action = (form.getAttribute('action') || '').split('?')[0];
    if (action) return action.split('/').filter(Boolean).pop() || action;
    return 'Form #' + (idx + 1);
  }

  function detectPageForms() {
    const out = [];
    [...document.querySelectorAll('form')].forEach((f, i) => {
      if (f.closest('[id^="dt-"]')) return;
      const fields = collectFields(f);
      if (fields.length) out.push({ key: formKeyOf(f, i), label: formLabelOf(f, i), fields });
    });
    // Standalone inputs outside any <form> (common in SPAs) are grouped as one
    // synthetic "page" form so they're configurable too.
    const loose = collectFields(document).filter(fd => !(fd.els || [fd.el]).some(e => e.closest('form')));
    if (loose.length) out.push({ key: 'page', label: 'Page fields (no <form>)', fields: loose });
    return out;
  }

  // ─── Template engine ─────────────────────────────────────────────────────────
  // Text values are templates mixing fixed text and {{tokens}}, e.g.
  //   prefix-{{date(mm-yy)}}-{{random}}
  function formatDate(d, fmt) {
    const p = (n, w) => String(n).padStart(w, '0');
    return String(fmt).replace(/yyyy|yy|mm|dd|hh|ii|ss/gi, tok => {
      switch (tok.toLowerCase()) {
        case 'yyyy': return String(d.getFullYear());
        case 'yy':   return p(d.getFullYear() % 100, 2);
        case 'mm':   return p(d.getMonth() + 1, 2);
        case 'dd':   return p(d.getDate(), 2);
        case 'hh':   return p(d.getHours(), 2);
        case 'ii':   return p(d.getMinutes(), 2);
        case 'ss':   return p(d.getSeconds(), 2);
        default:     return tok;
      }
    });
  }

  function randomStr(len, chars) {
    let s = '';
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function renderTemplate(tpl) {
    const now = new Date();
    return String(tpl).replace(/\{\{\s*([a-zA-Z]+)\s*(?:\(([^)]*)\))?\s*\}\}/g, (all, fn, arg) => {
      arg = (arg || '').trim();
      switch (fn.toLowerCase()) {
        case 'date':
        case 'time':      return formatDate(now, arg || (fn.toLowerCase() === 'time' ? 'hh:ii' : 'yyyy-mm-dd'));
        case 'random':    return randomStr(Math.max(1, parseInt(arg, 10) || 6), 'abcdefghijklmnopqrstuvwxyz0123456789');
        case 'randnum':   return randomStr(Math.max(1, parseInt(arg, 10) || 4), '0123456789');
        case 'uuid':      return (crypto.randomUUID ? crypto.randomUUID()
                            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                                const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
                              }));
        case 'timestamp': return String(Date.now());
        case 'param':     return new URLSearchParams(location.search).get(arg) || '';
        case 'counter': {
          const n = Store.get('formfill.counter', 0) + 1;
          Store.set('formfill.counter', n);
          return String(n);
        }
        default: return all; // unknown token — leave visible so the user notices
      }
    });
  }

  const TOKENS_HINT = '{{date(dd-mm-yyyy)}} · {{time(hh:ii)}} · {{random}} / {{random(8)}} · {{randnum(4)}} · {{uuid}} · {{timestamp}} · {{counter}} · {{param(name)}}';
  const COND_HINT = "expr conditions are JS with param('a'), field('nameOrId'), url, path, host, date, now — e.g. field('type')=='c' || date.getDate()%2==1";

  // ─── Value resolution (conditions) ──────────────────────────────────────────
  // Each field has a default value plus optional conditions; the first matching
  // condition overrides the default. Two kinds (older configs have no `kind`
  // and default to 'param'):
  //  - param: URL param is present, and (if a match value is set) equals it.
  //  - expr:  free JS expression with page helpers — covers "input A has value
  //           c", "day of month is odd", and anything else.

  // Current value of another input on the page, looked up by name or id.
  // Radio groups resolve to the checked option's value, checkboxes to a bool.
  function pageFieldValue(ref) {
    if (!ref) return '';
    const esc = window.CSS && window.CSS.escape ? window.CSS.escape(ref) : ref;
    const els = [...document.querySelectorAll(`[name="${esc}"], #${esc}`)]
      .filter(el => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !el.closest('[id^="dt-"]'));
    if (!els.length) return '';
    if ((els[0].type || '').toLowerCase() === 'radio') {
      const checked = els.find(e => e.checked);
      return checked ? checked.value : '';
    }
    if ((els[0].type || '').toLowerCase() === 'checkbox') return els[0].checked;
    return els[0].value;
  }

  // Evaluates a user-authored condition expression. This is the user's own
  // config running in their own browser (devtools territory), so new Function
  // is fine; any error just means "condition doesn't match".
  function evalCondExpr(expr) {
    if (!expr || !expr.trim()) return false;
    try {
      const usp = new URLSearchParams(location.search);
      const helpers = {
        param: n => usp.get(n),
        field: pageFieldValue,
        url: location.href,
        path: location.pathname,
        host: location.host,
        date: new Date(),
        now: Date.now(),
      };
      const fn = new Function(...Object.keys(helpers), `return (${expr});`);
      return !!fn(...Object.values(helpers));
    } catch (e) {
      console.warn('[DevTools] Form fill condition expression failed:', expr, e);
      return false;
    }
  }

  function condMatches(c) {
    if ((c.kind || 'param') === 'expr') return evalCondExpr(c.expr);
    const usp = new URLSearchParams(location.search);
    if (!c.param || !usp.has(c.param)) return false;
    if (c.match != null && c.match !== '' && usp.get(c.param) !== c.match) return false;
    return true;
  }

  function resolveValue(fieldCfg) {
    for (const c of (fieldCfg.conditions || [])) {
      if (condMatches(c)) return c.value;
    }
    return fieldCfg.value;
  }

  // ─── Filling ─────────────────────────────────────────────────────────────────
  // Values are set through the native prototype setters + input/change events so
  // framework-controlled inputs (React/Vue/Angular) register the change instead
  // of silently reverting it on next render.
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setNativeChecked(el, checked) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
    if (setter) setter.call(el, checked); else el.checked = checked;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Fills one saved form config against its live detected counterpart.
  // Auto-run passes force=false so late-retry passes never re-fill a field the
  // user may have already edited; "Fill now" passes force=true.
  function fillForm(cfg, det, force) {
    let filled = 0;
    (cfg.fields || []).forEach(fc => {
      if (!fc.fill) return;
      const lf = det.fields.find(f => f.key === fc.key);
      if (!lf) return;
      const els = lf.els || [lf.el];
      if (!force && els.some(e => e.dataset.dtFfFilled)) return;
      const raw = resolveValue(fc);
      if (raw == null || raw === '') return;
      try {
        if (lf.type === 'text') {
          setNativeValue(lf.el, renderTemplate(raw));
        } else if (lf.type === 'select') {
          setNativeValue(lf.el, raw);
        } else if (lf.type === 'checkbox') {
          setNativeChecked(lf.el, raw === 'checked');
        } else if (lf.type === 'radio') {
          const target = els.find(e => e.value === raw);
          if (!target) return;
          setNativeChecked(target, true);
        }
        els.forEach(e => { e.dataset.dtFfFilled = '1'; });
        filled++;
      } catch (e) {
        console.warn('[DevTools] Form fill failed for field', fc.key, e);
      }
    });
    return filled;
  }

  function hostForms() {
    return state.formfill.forms.filter(f => f.host === location.host);
  }

  function runAutoFill() {
    if (!state.formfill.enabled) return;
    const cfgs = hostForms().filter(f => f.enabled && f.autoRun !== false);
    if (!cfgs.length) return;
    const detected = detectPageForms();
    cfgs.forEach(cfg => {
      const det = detected.find(d => d.key === cfg.key);
      if (det) fillForm(cfg, det, false);
    });
  }

  // ─── Panel HTML ──────────────────────────────────────────────────────────────
  function buildFormFillPanel() {
    return `
      <div class="dt-section">
        <div class="dt-slabel">Form Autofill</div>
        <div class="dt-row" style="margin-bottom:10px">
          <div class="dt-row-label" style="display:flex;align-items:center;gap:5px">Enable globally</div>
          <label class="dt-toggle"><input type="checkbox" id="dt-ff-enabled"><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
        </div>
        <div class="dt-row-sub" style="margin-bottom:4px;color:var(--mu);font-size:11px">When enabled, configured forms on matching pages are filled automatically on load.</div>
      </div>
      <div class="dt-section">
        <div class="dt-slabel" style="display:flex;align-items:center;justify-content:space-between">
          Forms on this page
          <button class="dt-pe-add-pattern" id="dt-ff-refresh" style="margin:0">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10.5 6a4.5 4.5 0 1 1-1.3-3.2"/><path d="M10.7 1v2.3H8.4"/></svg>
            Refresh
          </button>
        </div>
        <div id="dt-ff-detected"></div>
      </div>
      <div class="dt-section" id="dt-ff-saved-section" style="display:none">
        <div class="dt-slabel">Saved forms for this site</div>
        <div id="dt-ff-saved"></div>
      </div>
    `;
  }

  // ─── Panel logic ─────────────────────────────────────────────────────────────
  let detected = [];      // last detection result (holds live element refs)
  let editingId = null;   // id of the config open in the editor

  // Debounced persistence for rapid typing in template/condition inputs —
  // Store.set serializes the whole forms array synchronously (see the identical
  // pattern in Devtools_baseurl.js).
  let _saveTimer = null;
  function saveFormsSoon() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      Store.set('formfill.forms', state.formfill.forms);
    }, 300);
  }
  function saveFormsNow() {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    Store.set('formfill.forms', state.formfill.forms);
  }

  function findCfg(key) {
    return state.formfill.forms.find(f => f.host === location.host && f.key === key);
  }

  function initFormFillPanel() {
    const enabledChk = $('dt-ff-enabled');
    if (!enabledChk) return;
    enabledChk.checked = state.formfill.enabled;
    enabledChk.addEventListener('change', e => {
      state.formfill.enabled = e.target.checked;
      Store.set('formfill.enabled', state.formfill.enabled);
    });
    $('dt-ff-refresh').addEventListener('click', renderDetected);
    // Re-detect whenever the user opens this panel — pages mutate constantly.
    const navBtn = $1('.dt-nav-btn[data-panel="formfill"]');
    if (navBtn) navBtn.addEventListener('click', renderDetected);
    renderDetected();
    renderSaved();

    // Auto-fill on load. The sidebar injects at document-start, so retry a few
    // times to catch forms rendered late by SPAs.
    const schedule = () => [300, 1200, 3000].forEach(t => setTimeout(runAutoFill, t));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
    else schedule();
  }

  function renderDetected() {
    const list = $('dt-ff-detected');
    if (!list) return;
    detected = detectPageForms();
    list.innerHTML = '';
    if (!detected.length) {
      list.innerHTML = '<div class="dt-ff-empty">No fillable forms found on this page.</div>';
      return;
    }
    detected.forEach(det => {
      const cfg = findCfg(det.key);
      const el = document.createElement('div');
      el.className = 'dt-ff-item' + (cfg && cfg.id === editingId ? ' selected' : '');
      el.innerHTML = `
        <div class="dt-ff-item-main">
          <div class="dt-ff-item-name">${escHtml(det.label)}</div>
          <div class="dt-ff-item-meta">${det.fields.length} field${det.fields.length === 1 ? '' : 's'}${cfg ? ' · <span style="color:var(--ac)">configured</span>' : ''}</div>
        </div>
        <span class="dt-ff-item-cta">${cfg ? 'Edit' : 'Configure'}</span>
      `;
      el.addEventListener('click', () => openEditor(det));
      list.appendChild(el);
    });
  }

  // Opens (creating or merging a saved config for) the given detected form.
  // Field metadata (label/type/options) is snapshotted into the config so the
  // editor also works later on pages where the form isn't currently present.
  function openEditor(det) {
    let cfg = findCfg(det.key);
    if (!cfg) {
      cfg = { id: Date.now(), host: location.host, key: det.key, label: det.label, enabled: true, autoRun: true, fields: [] };
      state.formfill.forms.push(cfg);
    }
    det.fields.forEach(lf => {
      let fc = cfg.fields.find(f => f.key === lf.key);
      if (!fc) {
        fc = { key: lf.key, fill: false, value: '', conditions: [] };
        cfg.fields.push(fc);
      }
      // refresh snapshot meta from the live DOM
      fc.label = lf.label;
      fc.type = lf.type;
      fc.inputType = lf.inputType;
      fc.options = lf.options;
    });
    saveFormsNow();
    editingId = cfg.id;
    renderDetected();
    renderSaved();
    openModal();
  }

  function templatePlaceholder(fc) {
    switch (fc.inputType) {
      case 'date':           return 'e.g. {{date(yyyy-mm-dd)}}';
      case 'time':           return 'e.g. {{time(hh:ii)}}';
      case 'datetime-local': return 'e.g. {{date(yyyy-mm-dd)}}T{{time(hh:ii)}}';
      case 'month':          return 'e.g. {{date(yyyy-mm)}}';
      case 'number':         return 'e.g. {{randnum(3)}}';
      default:               return 'e.g. prefix-{{date(mm-yy)}}-{{random}}';
    }
  }

  // Shared default/condition value editor: text-ish fields get a template
  // input, enumerated fields (select/radio/checkbox) get their options as a
  // dropdown — per the field metadata snapshot.
  function valueEditorHtml(fc, current, extraCls) {
    if (fc.type === 'text') {
      return `<input class="dt-ff-input ${extraCls}" value="${escHtml(current || '')}" placeholder="${escHtml(templatePlaceholder(fc))}" spellcheck="false" autocomplete="off">`;
    }
    const opts = (fc.options || []).map(o =>
      `<option value="${escHtml(o.value)}"${o.value === current ? ' selected' : ''}>${escHtml(o.label || o.value)}</option>`).join('');
    return `<select class="dt-ff-select ${extraCls}"><option value=""${!current ? ' selected' : ''}>— select —</option>${opts}</select>`;
  }

  // ─── Config modal ────────────────────────────────────────────────────────────
  // Field configuration opens in a centered modal (same shell as the request
  // interceptor modal) instead of being crammed into the narrow sidebar.
  // Created lazily since most pages never open it; the static HTML template
  // isn't extendable by plugins.
  let overlayEl = null;
  function ensureModal() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.id = 'dt-ff-overlay';
    overlayEl.className = 'dt-overlay';
    overlayEl.innerHTML = `
      <div class="dt-modal" id="dt-ff-modal">
        <div class="dt-modal-head">
          <div class="dt-modal-icon req">${ctx.icon('zap', 18, 1.9)}</div>
          <div class="dt-modal-meta">
            <div class="dt-modal-title" id="dt-ff-modal-title">Form Autofill</div>
            <div class="dt-modal-url" id="dt-ff-modal-sub"></div>
          </div>
          <button class="dt-ff-modal-close" id="dt-ff-modal-close" title="Close">${ctx.icon('x', 15, 2)}</button>
        </div>
        <div class="dt-modal-body"><div class="dt-modal-inner" id="dt-ff-editor"></div></div>
        <div class="dt-modal-foot">
          <button class="dt-foot-btn dt-ff-foot-neutral" id="dt-ff-fillnow">Fill now</button>
          <span class="dt-modal-count" id="dt-ff-fill-status"></span>
          <button class="dt-foot-btn dt-foot-btn-send" id="dt-ff-modal-done"><span>Done</span></button>
        </div>
      </div>`;
    root().appendChild(overlayEl);
    overlayEl.addEventListener('click', e => { if (e.target === overlayEl) closeModal(); });
    overlayEl.querySelector('#dt-ff-modal-close').addEventListener('click', closeModal);
    overlayEl.querySelector('#dt-ff-modal-done').addEventListener('click', closeModal);
    overlayEl.querySelector('#dt-ff-fillnow').addEventListener('click', () => {
      const cfg = state.formfill.forms.find(f => f.id === editingId);
      const status = $('dt-ff-fill-status');
      if (!cfg || !status) return;
      detected = detectPageForms();
      const det = detected.find(d => d.key === cfg.key);
      // Filled something → close so the user sees the result; otherwise stay
      // open and explain why nothing happened.
      if (det && fillForm(cfg, det, true) > 0) { closeModal(); return; }
      status.textContent = det ? 'No fields enabled above' : 'Form not found on this page';
      clearTimeout(ensureModal._statusTimer);
      ensureModal._statusTimer = setTimeout(() => { const s = $('dt-ff-fill-status'); if (s) s.textContent = ''; }, 2500);
    });
    return overlayEl;
  }

  // The core themes a fixed list of elements (sidebar, static overlays); this
  // overlay is created at runtime, so mirror the sidebar's theme class and any
  // custom-appearance token overrides on open instead.
  function syncModalTheme() {
    const sb = $('dt-sidebar');
    if (!sb || !overlayEl) return;
    overlayEl.classList.toggle('dt-dark', sb.classList.contains('dt-dark'));
    ['--bg', '--sf', '--sf2', '--tx', '--tx2', '--bd', '--bd2', '--mu', '--fa', '--ac', '--ac-bg', '--ac-bd', '--ac-tx', '--ring'].forEach(v => {
      const val = sb.style.getPropertyValue(v);
      if (val) overlayEl.style.setProperty(v, val); else overlayEl.style.removeProperty(v);
    });
  }

  function openModal() {
    ensureModal();
    syncModalTheme();
    renderEditor();
    overlayEl.classList.add('visible');
  }

  function closeModal() {
    if (overlayEl) overlayEl.classList.remove('visible');
    editingId = null;
    // "configured" badges and enabled-field counts may have changed
    renderDetected();
    renderSaved();
  }

  function renderEditor() {
    const cont = $('dt-ff-editor');
    const cfg = state.formfill.forms.find(f => f.id === editingId);
    if (!cont || !cfg) return;
    $('dt-ff-modal-title').textContent = cfg.label;
    $('dt-ff-modal-sub').textContent = `${cfg.host} · ${cfg.fields.length} field${cfg.fields.length === 1 ? '' : 's'}`;
    cont.innerHTML = `
      <div class="dt-ff-modal-toggles">
        <div class="dt-row">
          <div class="dt-row-label">Enable this form</div>
          <label class="dt-toggle"><input type="checkbox" id="dt-ff-form-enabled" ${cfg.enabled ? 'checked' : ''}><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
        </div>
        <div class="dt-row">
          <div class="dt-row-label">Auto-fill on page load</div>
          <label class="dt-toggle"><input type="checkbox" id="dt-ff-form-autorun" ${cfg.autoRun !== false ? 'checked' : ''}><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
        </div>
      </div>
      <div class="dt-ff-hint" title="${escHtml(TOKENS_HINT)}">Tokens: ${escHtml(TOKENS_HINT)}</div>
      <div class="dt-ff-hint" style="margin-bottom:12px" title="${escHtml(COND_HINT)}">Conditions: ${escHtml(COND_HINT)}</div>
      <div id="dt-ff-fields"></div>
    `;
    $('dt-ff-form-enabled').addEventListener('change', e => { cfg.enabled = e.target.checked; saveFormsNow(); renderSaved(); });
    $('dt-ff-form-autorun').addEventListener('change', e => { cfg.autoRun = e.target.checked; saveFormsNow(); });
    renderFields(cfg);
  }

  function renderFields(cfg) {
    const cont = $('dt-ff-fields');
    if (!cont) return;
    cont.innerHTML = '';
    cfg.fields.forEach(fc => {
      const row = document.createElement('div');
      row.className = 'dt-ff-field';
      row.innerHTML = `
        <div class="dt-ff-field-head">
          <label class="dt-toggle" style="width:34px;height:18px;flex-shrink:0" title="${fc.fill ? 'Autofill enabled' : 'Autofill disabled'}">
            <input type="checkbox" class="dt-ff-fill-chk" ${fc.fill ? 'checked' : ''}>
            <div class="dt-toggle-track" style="border-radius:9px"><div class="dt-toggle-thumb" style="top:2px;left:2px;width:12px;height:12px"></div></div>
          </label>
          <span class="dt-ff-field-name" title="${escHtml(fc.key)}">${escHtml(fc.label || fc.key)}</span>
          <span class="dt-ff-badge">${escHtml(fc.inputType || fc.type)}</span>
        </div>
        <div class="dt-ff-field-body" style="${fc.fill ? '' : 'display:none'}">
          <div class="dt-ff-val-row">
            <span class="dt-ff-cond-txt">Default</span>
            <div class="dt-ff-val-wrap"></div>
          </div>
          <div class="dt-ff-conds"></div>
          <button class="dt-ff-add-cond">+ Add URL condition</button>
        </div>
      `;
      const body = row.querySelector('.dt-ff-field-body');

      row.querySelector('.dt-ff-fill-chk').addEventListener('change', e => {
        fc.fill = e.target.checked;
        body.style.display = fc.fill ? '' : 'none';
        saveFormsNow();
      });

      const valWrap = row.querySelector('.dt-ff-val-wrap');
      valWrap.innerHTML = valueEditorHtml(fc, fc.value, 'dt-ff-val');
      const valEl = valWrap.querySelector('.dt-ff-val');
      valEl.addEventListener(fc.type === 'text' ? 'input' : 'change', e => {
        fc.value = e.target.value;
        fc.type === 'text' ? saveFormsSoon() : saveFormsNow();
      });

      const condsCont = row.querySelector('.dt-ff-conds');
      renderConds(fc, condsCont);
      row.querySelector('.dt-ff-add-cond').addEventListener('click', () => {
        (fc.conditions = fc.conditions || []).push({ param: '', match: '', value: '' });
        saveFormsNow();
        renderConds(fc, condsCont);
      });

      cont.appendChild(row);
    });
  }

  // Condition rows, first match wins. Two kinds:
  //  - "if ?<param> = <value> → <value>"; empty match means "param present".
  //  - "if <JS expression> → <value>" for anything broader (other inputs'
  //    values via field('name'), dates, URL parts, ...).
  function renderConds(fc, cont) {
    cont.innerHTML = '';
    (fc.conditions || []).forEach((c, ci) => {
      const kind = c.kind || 'param';
      const row = document.createElement('div');
      row.className = 'dt-ff-cond-row';
      row.innerHTML = `
        <span class="dt-ff-cond-txt">if</span>
        <select class="dt-ff-select dt-ff-cond-kind" style="flex:0 0 auto;width:auto" title="Condition kind">
          <option value="param"${kind === 'param' ? ' selected' : ''}>URL ?</option>
          <option value="expr"${kind === 'expr' ? ' selected' : ''}>expr</option>
        </select>
        ${kind === 'param' ? `
          <input class="dt-ff-input dt-ff-cond-param" value="${escHtml(c.param || '')}" placeholder="param" spellcheck="false" autocomplete="off">
          <span class="dt-ff-cond-txt">=</span>
          <input class="dt-ff-input dt-ff-cond-match" value="${escHtml(c.match || '')}" placeholder="any" spellcheck="false" autocomplete="off">
        ` : `
          <input class="dt-ff-input dt-ff-cond-expr" style="flex:2" value="${escHtml(c.expr || '')}" placeholder="field('a')=='c' &amp;&amp; date.getDate()%2==1" spellcheck="false" autocomplete="off">
        `}
        <span class="dt-ff-cond-txt">&rarr;</span>
        <div class="dt-ff-cond-val-wrap" style="flex:1.4;min-width:0"></div>
        <button class="dt-ff-cond-del" title="Remove condition">
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.7"><line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/></svg>
        </button>
      `;
      row.querySelector('.dt-ff-cond-kind').addEventListener('change', e => {
        c.kind = e.target.value;
        saveFormsNow();
        renderConds(fc, cont);
      });
      const paramIn = row.querySelector('.dt-ff-cond-param');
      if (paramIn) paramIn.addEventListener('input', e => { c.param = e.target.value.trim(); saveFormsSoon(); });
      const matchIn = row.querySelector('.dt-ff-cond-match');
      if (matchIn) matchIn.addEventListener('input', e => { c.match = e.target.value; saveFormsSoon(); });
      const exprIn = row.querySelector('.dt-ff-cond-expr');
      if (exprIn) exprIn.addEventListener('input', e => { c.expr = e.target.value; saveFormsSoon(); });
      const valWrap = row.querySelector('.dt-ff-cond-val-wrap');
      valWrap.innerHTML = valueEditorHtml(fc, c.value, 'dt-ff-cond-val');
      valWrap.querySelector('.dt-ff-cond-val').addEventListener(fc.type === 'text' ? 'input' : 'change', e => {
        c.value = e.target.value;
        fc.type === 'text' ? saveFormsSoon() : saveFormsNow();
      });
      row.querySelector('.dt-ff-cond-del').addEventListener('click', () => {
        fc.conditions.splice(ci, 1);
        saveFormsNow();
        renderConds(fc, cont);
      });
      cont.appendChild(row);
    });
  }

  function renderSaved() {
    const section = $('dt-ff-saved-section');
    const cont = $('dt-ff-saved');
    if (!section || !cont) return;
    const forms = hostForms();
    section.style.display = forms.length ? '' : 'none';
    cont.innerHTML = '';
    forms.forEach(cfg => {
      const onPage = detected.some(d => d.key === cfg.key);
      const el = document.createElement('div');
      el.className = 'dt-ff-item' + (cfg.id === editingId ? ' selected' : '');
      el.innerHTML = `
        <div class="dt-ff-item-main">
          <div class="dt-ff-item-name">${escHtml(cfg.label)}</div>
          <div class="dt-ff-item-meta">${cfg.fields.filter(f => f.fill).length}/${cfg.fields.length} fields set${onPage ? '' : ' · <span style="color:var(--mu)">not on this page</span>'}</div>
        </div>
        <label class="dt-toggle" style="width:34px;height:18px;flex-shrink:0" title="${cfg.enabled ? 'Enabled' : 'Disabled'}">
          <input type="checkbox" class="dt-ff-saved-enabled" ${cfg.enabled ? 'checked' : ''}>
          <div class="dt-toggle-track" style="border-radius:9px"><div class="dt-toggle-thumb" style="top:2px;left:2px;width:12px;height:12px"></div></div>
        </label>
        <button class="dt-ff-cond-del dt-ff-saved-del" title="Delete saved config">
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.7"><line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/></svg>
        </button>
      `;
      el.querySelector('.dt-ff-item-main').addEventListener('click', () => {
        editingId = cfg.id;
        openModal();
      });
      el.querySelector('.dt-ff-saved-enabled').addEventListener('change', e => {
        cfg.enabled = e.target.checked;
        saveFormsNow();
      });
      el.querySelector('.dt-ff-saved-del').addEventListener('click', () => {
        state.formfill.forms = state.formfill.forms.filter(f => f.id !== cfg.id);
        saveFormsNow();
        if (editingId === cfg.id) closeModal(); // also re-renders both lists
        else { renderDetected(); renderSaved(); }
      });
      cont.appendChild(el);
    });
  }

  function getDefaultState() {
    return {
      enabled: Store.get('formfill.enabled', false),
      forms: Store.get('formfill.forms', []),
    };
  }

  const storageSyncHandlers = {
    'formfill.enabled': () => {
      state.formfill.enabled = Store.get('formfill.enabled', false);
      const chk = $('dt-ff-enabled');
      if (chk) chk.checked = state.formfill.enabled;
    },
    'formfill.forms': () => {
      state.formfill.forms = Store.get('formfill.forms', []);
      if (editingId && !state.formfill.forms.some(f => f.id === editingId)) editingId = null;
      renderDetected();
      renderEditor();
      renderSaved();
    },
  };

  return {
    id: 'formfill',
    navLabel: 'Form Autofill',
    navIcon: 'checkSquare',
    buildPanel: buildFormFillPanel,
    initPanel: initFormFillPanel,
    getDefaultState,
    storageSyncHandlers,
  };
});
