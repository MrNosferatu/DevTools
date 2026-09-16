// ==UserScript==
// @name         DevTools Sidebar — Form Autofill Plugin
// @namespace    http://tampermonkey.net/
// @version      3.6.24
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
    if (el.tagName === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      return 'text'; // date/time/number/etc all accept a rendered template string
    }
    // Custom (non-native) controls: classify by ARIA role / popup semantics.
    const role = (el.getAttribute('role') || '').toLowerCase();
    const pop = (el.getAttribute('aria-haspopup') || '').toLowerCase();
    if (role === 'switch' || role === 'checkbox') return 'checkbox';
    if (role === 'radio') return 'radio';
    if (role === 'combobox' || role === 'listbox' || pop === 'menu' || pop === 'listbox' || pop === 'true') return 'menu';
    return 'text'; // textbox / spinbutton / contenteditable
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
        .filter(c => !c.contains(el) && !el.contains(c) && !c.querySelector('input,select,textarea') && c.textContent.trim());
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

  // Search / command-palette / autocomplete controls that look like inputs but
  // aren't data-entry form fields. Matched against name/id/placeholder/aria.
  const SEARCHY = /(^|[\s._\-\[])(search|filter|query|lookup|find|autocomplete|combobox|command|palette)([\s._\-\]]|$)|^q$/i;
  function ffVisible(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.closest('[aria-hidden="true"],[hidden]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    let cs; try { cs = (el.ownerDocument.defaultView || window).getComputedStyle(el); } catch { return true; }
    if (!cs) return true;
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') !== 0;
  }
  function ffSearchLike(el) {
    const t = (el.type || '').toLowerCase();
    if (t === 'search') return true;
    const role = el.getAttribute('role');
    if (role === 'searchbox' || role === 'combobox') return true;
    if (el.closest('[role="search"]')) return true;
    const hay = [el.name, el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('aria-keyshortcuts')].filter(Boolean).join(' ');
    return SEARCHY.test(hay);
  }
  // A DOM control worth offering for autofill. Skips the sidebar's own inputs
  // (dt-* ids), non-fillable types, and anything invisible/disabled. With
  // opts.excludeSearch it also drops search/command-palette boxes — applied to
  // standalone inputs, where those controls usually aren't part of a real form.
  function ffFillable(el, opts) {
    opts = opts || {};
    if (SKIP_TYPES.includes((el.type || '').toLowerCase())) return false;
    if (el.closest('[id^="dt-"]')) return false;
    if (!ffVisible(el)) return false;
    if (opts.excludeSearch && ffSearchLike(el)) return false;
    return true;
  }

  // Custom (non-native) controls that act as form fields on modern sites:
  // contenteditable, ARIA widgets, and menu/dropdown trigger buttons (which
  // have no <input>/<select> and no options in the DOM until opened).
  const CUSTOM_SEL = [
    '[contenteditable=""]', '[contenteditable="true"]',
    '[role="textbox"]', '[role="combobox"]', '[role="listbox"]', '[role="spinbutton"]',
    '[role="switch"]', '[role="checkbox"]', '[role="radio"]',
    '[aria-haspopup="menu"]', '[aria-haspopup="listbox"]', '[aria-haspopup="dialog"]', '[aria-haspopup="true"]',
  ].join(',');

  // HTML validation constraints on a native <input>, snapshotted so fills can
  // clamp/truncate to them and the editor can hint them.
  function readConstraints(el) {
    const c = {}, t = (el.type || '').toLowerCase();
    if (el.hasAttribute('min')) c.min = el.getAttribute('min');
    if (el.hasAttribute('max')) c.max = el.getAttribute('max');
    if (el.hasAttribute('step')) c.step = el.getAttribute('step');
    if (typeof el.maxLength === 'number' && el.maxLength > 0) c.maxLength = el.maxLength;
    if (el.hasAttribute('pattern')) c.pattern = el.getAttribute('pattern');
    if (el.required) c.required = true;
    if (['number', 'range', 'email', 'url', 'tel', 'date', 'time'].includes(t)) c.type = t;
    return Object.keys(c).length ? c : null;
  }

  function collectFields(root, opts) {
    const native = [...root.querySelectorAll('input,select,textarea')];
    const custom = [...root.querySelectorAll(CUSTOM_SEL)];
    let els = [...native, ...custom].filter(el => ffFillable(el, opts));
    // Keep the innermost control: drop any element that is an ancestor of
    // another kept one (e.g. a combobox wrapper around its real <input>).
    els = els.filter(el => !els.some(o => o !== el && el.contains(o)));
    const fields = [];
    const radioGroups = {};
    els.forEach((el, i) => {
      const isNative = el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';
      const type = classify(el);
      if (type === 'radio' && isNative) {
        const name = el.name || '@radio' + i;
        const opt = { value: el.value, label: optionLabelFor(el) };
        if (radioGroups[name]) { radioGroups[name].els.push(el); radioGroups[name].options.push(opt); return; }
        const fd = { key: 'r:' + name, label: nearbyLabelText(el) || name, type, inputType: 'radio', els: [el], options: [opt] };
        radioGroups[name] = fd;
        fields.push(fd);
        return;
      }
      const key = el.name ? 'n:' + el.name : el.id ? 'i:' + el.id : isNative ? '@' + i : 'c:' + ffSelector(el);
      fields.push({
        key,
        label: labelFor(el),
        type,
        inputType: !isNative ? (type === 'menu' ? 'menu' : (el.getAttribute('role') || 'custom'))
          : el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text').toLowerCase(),
        el,
        custom: !isNative,
        constraints: (isNative && el.tagName === 'INPUT') ? readConstraints(el) : null,
        options: (type === 'select' && isNative)
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

  // Short, reasonably stable CSS selector for a container — the persisted key
  // for click-picked forms (so they re-detect on later visits).
  function ffSelector(el) {
    if (!el || el === document.body || el.nodeType !== 1) return 'body';
    const parts = [];
    let node = el;
    for (let d = 0; node && node.nodeType === 1 && node !== document.body && d < 6; d++) {
      if (node.id) { parts.unshift('#' + (window.CSS && CSS.escape ? CSS.escape(node.id) : node.id)); break; }
      let sel = node.tagName.toLowerCase();
      const nm = node.getAttribute && node.getAttribute('name');
      if (nm) { parts.unshift(sel + `[name="${nm}"]`); break; }
      const parent = node.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter(c => c.tagName === node.tagName);
        if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(sel);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }
  // Nearest ancestor that reads like a distinct form/group — used to cluster
  // standalone inputs into labeled buckets instead of one big page list.
  const GROUP_SEL = 'form,fieldset,[role="form"],[role="group"],dialog,[role="dialog"],section,[class*="form"],[class*="modal"],[class*="dialog"]';
  function ffContainerLabel(c) {
    if (!c) return '';
    const aria = c.getAttribute && c.getAttribute('aria-label');
    if (aria && aria.trim()) return cleanLabel(aria);
    const heading = c.querySelector && c.querySelector('legend,h1,h2,h3,h4,[class*="title"],[class*="heading"]');
    if (heading && heading.textContent.trim()) return cleanLabel(heading.textContent);
    if (c.id) return '#' + c.id;
    if (c.getAttribute && c.getAttribute('name')) return c.getAttribute('name');
    return '';
  }

  // ── Merged form groups ──────────────────────────────────────────────────────
  // One logical form is often split across several containers (multi-step
  // wizards, side-by-side cards, a modal plus the page behind it), so detection
  // reports it as several separate forms and every field has to be configured
  // one bucket at a time. A merge config (key "merge:<id>") names the detection
  // keys of its members and is presented as ONE detected form. Member field
  // keys are namespaced "<memberKey>»<fieldKey>" so same-named fields coming
  // from different members stay distinct, and so a member can be split back out
  // later without losing its settings.
  const MERGE_SEP = '\u00BB';
  const isMergeKey = k => typeof k === 'string' && k.indexOf('merge:') === 0;
  const mergedKey = (memberKey, fieldKey) => memberKey + MERGE_SEP + fieldKey;
  function splitMergedKey(k) {
    const i = String(k).indexOf(MERGE_SEP);
    return i < 0 ? { member: '', field: k } : { member: k.slice(0, i), field: k.slice(i + 1) };
  }
  // Fold every saved merge group for this host into the detection result: the
  // members it found are removed and replaced by a single combined entry.
  // Members that aren't on this page are simply skipped, so a partially present
  // group still works.
  function applyMerges(out) {
    const merges = hostForms().filter(f => isMergeKey(f.key) && (f.members || []).length);
    if (!merges.length) return out;
    const byKey = new Map(out.map(d => [d.key, d]));
    const consumed = new Set();
    const groups = [];
    merges.forEach(cfg => {
      const fields = [];
      // Members can overlap and hand us the SAME element twice — a picked
      // container wrapping a real <form>, or one pick nested in another. Only
      // the first member to claim an element keeps it, so the group fills it
      // once instead of writing it twice with the last config winning. Member
      // order is stable, so which one wins is deterministic.
      const owner = new Map();   // element -> label of the member that claimed it
      const dupes = new Map();   // namespaced key -> label of the claiming member
      (cfg.members || []).forEach(m => {
        const det = byKey.get(m.key);
        if (!det || consumed.has(m.key)) return;
        consumed.add(m.key);
        const label = m.label || det.label;
        det.fields.forEach(fd => {
          const els = fd.els || (fd.el ? [fd.el] : []);
          const key = mergedKey(m.key, fd.key);
          // Fully covered by an earlier member → skip. A partial overlap (some
          // radios shared) is left alone rather than half-dropped.
          if (els.length && els.every(e => owner.has(e))) {
            dupes.set(key, owner.get(els[0]));
            return;
          }
          els.forEach(e => { if (!owner.has(e)) owner.set(e, label); });
          fields.push({ ...fd, key, group: label });
        });
      });
      if (fields.length) groups.push({ key: cfg.key, label: cfg.label, fields, merged: true, memberCount: (cfg.members || []).length, dupes });
    });
    return [...groups, ...out.filter(d => !consumed.has(d.key))];
  }

  function detectPageForms() {
    const out = [];
    [...document.querySelectorAll('form')].forEach((f, i) => {
      if (f.closest('[id^="dt-"]')) return;
      const fields = collectFields(f); // real <form>: keep every field, incl. search
      if (fields.length) out.push({ key: formKeyOf(f, i), label: formLabelOf(f, i), fields });
    });
    // Standalone inputs outside any <form> (common in SPAs): drop search/command
    // UI, then cluster by nearest form-ish container so each real group is
    // offered separately instead of one giant, mixed page bucket.
    const loose = collectFields(document, { excludeSearch: true })
      .filter(fd => !(fd.els || [fd.el]).some(e => e.closest('form')));
    if (loose.length) {
      const clusters = new Map();
      loose.forEach(fd => {
        const anchor = fd.els ? fd.els[0] : fd.el;
        const c = anchor.closest(GROUP_SEL);
        const ck = c || '__page__';
        if (!clusters.has(ck)) clusters.set(ck, { container: c, fields: [] });
        clusters.get(ck).fields.push(fd);
      });
      let gi = 0;
      clusters.forEach(({ container, fields }) => {
        if (container) out.push({ key: 'grp:' + ffSelector(container), label: ffContainerLabel(container) || ('Form group ' + (++gi)), fields });
        else out.push({ key: 'page', label: 'Page fields (no <form>)', fields });
      });
    }
    // Click-picked forms saved for this host: resolve their container selector so
    // they re-detect (and auto-fill) later even where the heuristics miss them.
    // A picked form is only ever found this way, so the keys must be collected
    // from grouped members too — grouping absorbs (and deletes) a member's own
    // config, and without this the picked container would stop resolving and
    // the whole group would come back empty.
    const picked = new Map();
    hostForms().forEach(cfg => {
      if (cfg.key && cfg.key.indexOf('pick:') === 0) picked.set(cfg.key, cfg.label);
      (cfg.members || []).forEach(m => {
        if (m.key && m.key.indexOf('pick:') === 0 && !picked.has(m.key)) picked.set(m.key, m.label);
      });
    });
    picked.forEach((label, key) => {
      if (out.some(o => o.key === key)) return;
      let c = null; try { c = document.querySelector(key.slice(5)); } catch {}
      if (!c) return;
      const fields = collectFields(c);
      if (fields.length) out.push({ key, label: label || ffContainerLabel(c) || 'Picked form', fields });
    });
    return applyMerges(out);
  }

  // ── Click-to-pick a form/field on the page (most accurate detection) ────────
  // Heuristics can't always tell a data-entry form from filter/search UI, so let
  // the user point at the real thing. Hover highlights the nearest form-ish
  // container; click configures its fields; Esc cancels.
  let _pickActive = false;
  function ffPickTarget(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.closest('[id^="dt-"]')) return null; // never our own sidebar/overlay
    return el.closest(GROUP_SEL)
      || (el.querySelector && el.querySelector('input,select,textarea') ? el : null)
      || (el.closest && el.closest('div,section,li') )
      || el;
  }
  function startFormPick() {
    if (_pickActive) return;
    _pickActive = true;
    const doc = document, root = doc.documentElement;
    const box = doc.createElement('div');
    box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #4c8dff;background:rgba(76,141,255,.15);border-radius:4px;display:none';
    const hint = doc.createElement('div');
    hint.textContent = 'Click a form or field to configure · Esc to cancel';
    hint.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:14px;transform:translateX(-50%);background:#111;color:#fff;font:600 12px/1 system-ui,sans-serif;padding:8px 13px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.35);pointer-events:none';
    root.appendChild(box); root.appendChild(hint);
    let target = null;
    const onMove = e => {
      target = ffPickTarget(e.target);
      if (!target) { box.style.display = 'none'; return; }
      const r = target.getBoundingClientRect();
      box.style.display = 'block';
      box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
      box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    };
    const cleanup = () => {
      _pickActive = false;
      doc.removeEventListener('mousemove', onMove, true);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('keydown', onKey, true);
      box.remove(); hint.remove();
    };
    const onClick = e => {
      if (e.target && e.target.closest && e.target.closest('[id^="dt-"]')) return; // let sidebar clicks through
      e.preventDefault(); e.stopPropagation();
      const el = target; cleanup();
      if (el) finishFormPick(el);
    };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); cleanup(); } };
    doc.addEventListener('mousemove', onMove, true);
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKey, true);
  }
  function finishFormPick(container) {
    const fields = collectFields(container);
    renderDetected();
    if (!fields.length) return;
    openEditor({ key: 'pick:' + ffSelector(container), label: ffContainerLabel(container) || 'Picked form', fields });
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

  // Clamp/truncate a rendered value to a native input's HTML constraints so a
  // fill never violates min/max/step/maxlength (best-effort; pattern/type are
  // left to the page to reject).
  function applyConstraints(el, value, c) {
    if (!c) return value;
    let v = String(value);
    if (c.maxLength && v.length > c.maxLength) v = v.slice(0, c.maxLength);
    const t = (el.type || '').toLowerCase();
    if (t === 'number' || t === 'range') {
      let n = parseFloat(v);
      if (!isNaN(n)) {
        if (c.min !== undefined && c.min !== '' && n < +c.min) n = +c.min;
        if (c.max !== undefined && c.max !== '' && n > +c.max) n = +c.max;
        v = String(n);
      }
    }
    return v;
  }

  function setContentEditable(el, value) {
    try {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) { console.warn('[DevTools] contenteditable fill failed', e); }
  }

  // Best-effort fill for custom widgets. Reliable for contenteditable and
  // ARIA toggles; menu/dropdown fill (see selectFromMenu) is inherently
  // site-dependent and may silently fail.
  function fillCustom(lf, value) {
    const el = lf.el;
    if (lf.type === 'checkbox') {
      const want = value === 'checked';
      const on = el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true';
      if (on !== want) { try { el.click(); } catch {} }
      return;
    }
    if (lf.type === 'radio') { try { el.click(); } catch {} return; }
    if (lf.type === 'menu') { selectFromMenu(el, value); return; }
    setContentEditable(el, value); // role=textbox / contenteditable
  }

  // Open a custom dropdown and click the option whose visible text matches
  // `want`. There's no standard contract for these, so this pattern-matches the
  // common ones (a visible menu/listbox popup with option-ish children) and
  // gives up quietly if nothing matches within a short window.
  function selectFromMenu(trigger, want) {
    const target = String(want).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!target) return;
    try { trigger.click(); } catch { return; }
    let tries = 0;
    const attempt = () => {
      const menus = [...document.querySelectorAll('[role="menu"],[role="listbox"],[class*="menu"],[class*="dropdown"],[class*="option"],[class*="popover"],[class*="popper"]')]
        .filter(m => !m.closest('[id^="dt-"]') && m.offsetParent !== null);
      const scopes = menus.length ? menus : [document];
      for (const m of scopes) {
        const opt = [...m.querySelectorAll('[role="option"],[role="menuitem"],[role="menuitemradio"],li,a,button,[class*="option"],[class*="item"]')]
          .find(o => o.offsetParent !== null && !o.closest('[id^="dt-"]') && (o.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === target);
        if (opt) { try { opt.click(); } catch {} return; }
      }
      if (++tries < 10) setTimeout(attempt, 90);
      else { try { trigger.click(); } catch {} } // close the popup we opened
    };
    setTimeout(attempt, 70);
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
        if (lf.custom) {
          fillCustom(lf, (lf.type === 'text' || lf.type === 'menu') ? renderTemplate(raw) : raw);
        } else if (lf.type === 'text') {
          setNativeValue(lf.el, applyConstraints(lf.el, renderTemplate(raw), lf.constraints));
        } else if (lf.type === 'select') {
          setNativeValue(lf.el, raw);
        } else if (lf.type === 'checkbox') {
          setNativeChecked(lf.el, raw === 'checked');
        } else if (lf.type === 'radio') {
          const target = els.find(e => e.value === raw);
          if (!target) return;
          setNativeChecked(target, true);
        }
        els.forEach(e => { if (e && e.dataset) e.dataset.dtFfFilled = '1'; });
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
        <div class="dt-row-sub" style="margin-bottom:4px;color:var(--mu);font-size:calc(11px*var(--dt-fs,1))">When enabled, configured forms on matching pages are filled automatically on load.</div>
      </div>
      <div class="dt-section">
        <div class="dt-slabel" style="display:flex;align-items:center;justify-content:space-between">
          Forms on this page
          <span style="display:flex;gap:6px">
            <button class="dt-pe-add-pattern" id="dt-ff-pick" style="margin:0" title="Click an element on the page to configure it as a form — the most reliable way when auto-detect misses or over-matches">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 2l3 8 1.4-3.1L9.5 5.6 2 2z"/></svg>
              Pick
            </button>
            <button class="dt-pe-add-pattern" id="dt-ff-refresh" style="margin:0">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10.5 6a4.5 4.5 0 1 1-1.3-3.2"/><path d="M10.7 1v2.3H8.4"/></svg>
              Refresh
            </button>
          </span>
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
  let selected = new Set(); // detection keys ticked for grouping

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
    const pickBtn = $('dt-ff-pick');
    if (pickBtn) pickBtn.addEventListener('click', () => startFormPick());
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
    // Forget ticks whose form left the page (SPA navigation, closed modal, ...)
    selected = new Set([...selected].filter(k => detected.some(d => d.key === k)));
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
        <label class="dt-ff-selbox" title="Tick two or more forms, then Group them into one config">
          <input type="checkbox" class="dt-ff-sel" ${selected.has(det.key) ? 'checked' : ''}>
        </label>
        <div class="dt-ff-item-main">
          <div class="dt-ff-item-name">${escHtml(det.label)}${det.merged ? ' <span class="dt-ff-badge">group</span>' : ''}</div>
          <div class="dt-ff-item-meta">${det.fields.length} field${det.fields.length === 1 ? '' : 's'}${det.merged ? ` · ${det.memberCount} form${det.memberCount === 1 ? '' : 's'}` : ''}${cfg ? ' · <span style="color:var(--ac)">configured</span>' : ''}</div>
        </div>
        ${det.merged ? '<button class="dt-ff-ungroup" title="Split this group back into its separate forms, keeping each one\u2019s field settings">Ungroup</button>' : ''}
        <span class="dt-ff-item-cta">${cfg ? 'Edit' : 'Configure'}</span>
      `;
      const chk = el.querySelector('.dt-ff-sel');
      // The row itself opens the editor, so the tick box must not bubble.
      el.querySelector('.dt-ff-selbox').addEventListener('click', e => e.stopPropagation());
      chk.addEventListener('change', e => {
        if (e.target.checked) selected.add(det.key); else selected.delete(det.key);
        renderGroupBar();
      });
      const un = el.querySelector('.dt-ff-ungroup');
      if (un) un.addEventListener('click', e => { e.stopPropagation(); ungroupForm(findCfg(det.key)); });
      el.addEventListener('click', () => openEditor(det));
      list.appendChild(el);
    });
    const bar = document.createElement('div');
    bar.id = 'dt-ff-groupbar';
    bar.className = 'dt-ff-groupbar';
    list.appendChild(bar);
    renderGroupBar();
  }

  // Action bar under the detected list — only present once something is ticked.
  function renderGroupBar() {
    const bar = $('dt-ff-groupbar');
    if (!bar) return;
    const n = selected.size;
    if (!n) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
    bar.style.display = '';
    bar.innerHTML = `
      <span class="dt-ff-groupbar-txt">${n} selected</span>
      <button class="dt-ff-groupbar-clear" type="button">Clear</button>
      <button class="dt-ff-groupbar-go" type="button" ${n < 2 ? 'disabled title="Tick at least two forms"' : ''}>Group into one form</button>
    `;
    bar.querySelector('.dt-ff-groupbar-clear').addEventListener('click', () => { selected.clear(); renderDetected(); });
    const go = bar.querySelector('.dt-ff-groupbar-go');
    if (!go.disabled) go.addEventListener('click', () => groupSelected());
  }

  // ── Group / ungroup ─────────────────────────────────────────────────────────
  // Expand a detection key into the member list it contributes: an existing
  // group contributes its own members (so groups nest flat), anything else
  // contributes itself.
  function membersOf(key) {
    const cfg = findCfg(key);
    if (cfg && (cfg.members || []).length) return cfg.members.map(m => ({ ...m }));
    const det = detected.find(d => d.key === key);
    return [{ key, label: (det && det.label) || key }];
  }
  // Move an already-saved config's field settings into the group being built,
  // then drop the now-redundant config. Keys from a plain form get namespaced;
  // keys from a group are already namespaced and carry over as-is.
  function absorbConfig(key, target) {
    const old = findCfg(key);
    if (!old) return;
    const wasGroup = (old.members || []).length > 0;
    (old.fields || []).forEach(fc => {
      const k = wasGroup ? fc.key : mergedKey(key, fc.key);
      if (target.fields.some(f => f.key === k)) return;
      target.fields.push({ ...fc, key: k, group: fc.group || old.label });
    });
    state.formfill.forms = state.formfill.forms.filter(f => f.id !== old.id);
  }

  function groupSelected() {
    // Keep the on-page order so the group reads top-to-bottom like the page.
    const keys = detected.map(d => d.key).filter(k => selected.has(k));
    if (keys.length < 2) return;
    const members = [];
    keys.forEach(k => membersOf(k).forEach(m => { if (!members.some(x => x.key === m.key)) members.push(m); }));
    const id = Date.now();
    const cfg = {
      id, host: location.host, key: 'merge:' + id,
      label: members.map(m => m.label).join(' + ').slice(0, 80),
      enabled: true, autoRun: true, members, fields: [],
    };
    // Absorb before pushing so findCfg() inside absorbConfig can't see the new
    // group and eat its own fields.
    keys.forEach(k => absorbConfig(k, cfg));
    state.formfill.forms.push(cfg);
    saveFormsNow();
    selected.clear();
    // Re-detect so the members collapse into the new group, then open it.
    detected = detectPageForms();
    const det = detected.find(d => d.key === cfg.key);
    editingId = cfg.id;
    renderDetected();
    renderSaved();
    if (det) openEditor(det); else openModal();
  }

  // Split a group back into one config per member, un-namespacing field keys so
  // each member keeps exactly the settings it contributed.
  function ungroupForm(cfg) {
    if (!cfg || !(cfg.members || []).length) return;
    let seq = 0;
    cfg.members.forEach(m => {
      const own = (cfg.fields || []).filter(fc => splitMergedKey(fc.key).member === m.key);
      // A picked form is only detectable while a config names it, so it always
      // gets one back — even empty. Heuristic members re-detect on their own,
      // so skip those to avoid littering the saved list.
      if (!own.length && m.key.indexOf('pick:') !== 0) return;
      let t = findCfg(m.key);
      if (!t) {
        t = { id: Date.now() + (++seq), host: location.host, key: m.key, label: m.label, enabled: cfg.enabled, autoRun: cfg.autoRun !== false, fields: [] };
        state.formfill.forms.push(t);
      }
      own.forEach(fc => {
        const k = splitMergedKey(fc.key).field;
        if (t.fields.some(f => f.key === k)) return;
        const copy = { ...fc, key: k };
        delete copy.group;
        t.fields.push(copy);
      });
    });
    state.formfill.forms = state.formfill.forms.filter(f => f.id !== cfg.id);
    saveFormsNow();
    if (editingId === cfg.id) closeModal(); // also re-renders both lists
    else { renderDetected(); renderSaved(); }
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
      if (lf.group) fc.group = lf.group; // which member of a group it came from
    });
    // Newly detected fields are appended, which would scatter a group's members
    // across the editor. Re-order by member so each subheading appears once.
    if ((cfg.members || []).length) {
      const rank = new Map(cfg.members.map((m, i) => [m.key, i]));
      const pos = new Map(cfg.fields.map((f, i) => [f, i]));
      cfg.fields.sort((a, b) => {
        const ra = rank.has(splitMergedKey(a.key).member) ? rank.get(splitMergedKey(a.key).member) : 1e6;
        const rb = rank.has(splitMergedKey(b.key).member) ? rank.get(splitMergedKey(b.key).member) : 1e6;
        return ra - rb || pos.get(a) - pos.get(b);
      });
    }
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

  // A muted one-liner under a field: its native validation constraints, and/or
  // a note that a custom control is filled best-effort.
  function fieldHint(fc) {
    const parts = [];
    if (fc.custom && fc.type === 'menu') parts.push('custom dropdown — best-effort (selects the option matching the label)');
    else if (fc.custom) parts.push('custom control — best-effort fill');
    const c = fc.constraints;
    if (c) {
      if (c.type) parts.push('type ' + c.type);
      if (c.min !== undefined) parts.push('min ' + c.min);
      if (c.max !== undefined) parts.push('max ' + c.max);
      if (c.step !== undefined) parts.push('step ' + c.step);
      if (c.maxLength) parts.push('maxlength ' + c.maxLength);
      if (c.pattern) parts.push('pattern ' + c.pattern);
      if (c.required) parts.push('required');
    }
    return parts.join(' · ');
  }

  // Shared default/condition value editor: text-ish fields get a template
  // input, enumerated fields (select/radio/checkbox) get their options as a
  // dropdown — per the field metadata snapshot.
  function valueEditorHtml(fc, current, extraCls) {
    if (fc.type === 'menu') {
      return `<input class="dt-ff-input ${extraCls}" value="${escHtml(current || '')}" placeholder="option label to select, e.g. Manga (best-effort)" spellcheck="false" autocomplete="off">`;
    }
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
      status.textContent = det ? 'No fields enabled above'
        : (cfg.members || []).length ? 'None of this group\u2019s forms are on this page'
        : 'Form not found on this page';
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
    const members = cfg.members || [];
    $('dt-ff-modal-title').textContent = cfg.label;
    $('dt-ff-modal-sub').textContent = `${cfg.host} · ${cfg.fields.length} field${cfg.fields.length === 1 ? '' : 's'}`
      + (members.length ? ` · ${members.length} grouped forms` : '');
    cont.innerHTML = `
      ${members.length ? `
      <div class="dt-ff-group-box">
        <div class="dt-ff-val-row" style="margin-bottom:7px">
          <span class="dt-ff-cond-txt">Name</span>
          <div class="dt-ff-val-wrap"><input class="dt-ff-input" id="dt-ff-group-label" value="${escHtml(cfg.label || '')}" placeholder="Group name" spellcheck="false" autocomplete="off"></div>
        </div>
        <div class="dt-ff-group-members">${members.map((m, i) =>
          `<span class="dt-ff-chip" title="${escHtml(m.key)}">${escHtml(m.label || m.key)}<button class="dt-ff-chip-x" data-i="${i}" title="Remove this form from the group">&times;</button></span>`
        ).join('')}</div>
      </div>` : ''}
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
    const labelIn = $('dt-ff-group-label');
    if (labelIn) labelIn.addEventListener('input', e => {
      cfg.label = e.target.value;
      $('dt-ff-modal-title').textContent = cfg.label;
      saveFormsSoon();
    });
    cont.querySelectorAll('.dt-ff-chip-x').forEach(btn => btn.addEventListener('click', () => {
      const m = members[+btn.dataset.i];
      if (!m) return;
      // Dropping the last-but-one member leaves a group of one, which is just
      // the member itself — ungroup entirely instead.
      if (members.length <= 2) { ungroupForm(cfg); return; }
      // Hand this member's fields back to a standalone config for it.
      const own = (cfg.fields || []).filter(fc => splitMergedKey(fc.key).member === m.key);
      if (own.length || m.key.indexOf('pick:') === 0) {
        let t = findCfg(m.key);
        if (!t) { t = { id: Date.now(), host: location.host, key: m.key, label: m.label, enabled: cfg.enabled, autoRun: cfg.autoRun !== false, fields: [] }; state.formfill.forms.push(t); }
        own.forEach(fc => {
          const k = splitMergedKey(fc.key).field;
          if (t.fields.some(f => f.key === k)) return;
          const copy = { ...fc, key: k };
          delete copy.group;
          t.fields.push(copy);
        });
      }
      cfg.members = members.filter(x => x.key !== m.key);
      cfg.fields = (cfg.fields || []).filter(fc => splitMergedKey(fc.key).member !== m.key);
      saveFormsNow();
      renderEditor();
      renderDetected();
      renderSaved();
    }));
    renderFields(cfg);
  }

  function renderFields(cfg) {
    const cont = $('dt-ff-fields');
    if (!cont) return;
    // Fields a group dropped as duplicates of an earlier member: still listed,
    // but flagged, so an enabled-looking field that never fills is explained.
    const detGroup = detected.find(d => d.key === cfg.key);
    const dupes = (detGroup && detGroup.dupes) || new Map();
    cont.innerHTML = '';
    // In a group, fields stay in member order and get a subheading each time the
    // source form changes, so it still reads as the separate forms it came from.
    let lastGroup = null;
    cfg.fields.forEach(fc => {
      if ((cfg.members || []).length && (fc.group || '') !== lastGroup) {
        lastGroup = fc.group || '';
        const h = document.createElement('div');
        h.className = 'dt-ff-group-head';
        h.textContent = lastGroup || 'Ungrouped';
        cont.appendChild(h);
      }
      const row = document.createElement('div');
      const dupOf = dupes.get(fc.key);
      row.className = 'dt-ff-field' + (dupOf ? ' dt-ff-field-dup' : '');
      const hint = fieldHint(fc);
      row.innerHTML = `
        <div class="dt-ff-field-head">
          <label class="dt-toggle" style="width:34px;height:18px;flex-shrink:0" title="${fc.fill ? 'Autofill enabled' : 'Autofill disabled'}">
            <input type="checkbox" class="dt-ff-fill-chk" ${fc.fill ? 'checked' : ''}>
            <div class="dt-toggle-track" style="border-radius:9px"><div class="dt-toggle-thumb" style="top:2px;left:2px;width:12px;height:12px"></div></div>
          </label>
          <span class="dt-ff-field-name" title="${escHtml(fc.key)}">${escHtml(fc.label || fc.key)}</span>
          <span class="dt-ff-badge">${escHtml(fc.inputType || fc.type)}</span>
        </div>
        ${dupOf ? `<div class="dt-ff-dup-note">Same field as in \u201C${escHtml(dupOf)}\u201D \u2014 filled there, ignored here</div>` : ''}
        <div class="dt-ff-field-body" style="${fc.fill ? '' : 'display:none'}">
          ${hint ? `<div class="dt-ff-hint" style="margin-bottom:8px">${escHtml(hint)}</div>` : ''}
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
      const textLike = fc.type === 'text' || fc.type === 'menu';
      valEl.addEventListener(textLike ? 'input' : 'change', e => {
        fc.value = e.target.value;
        textLike ? saveFormsSoon() : saveFormsNow();
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
      const condTextLike = fc.type === 'text' || fc.type === 'menu';
      valWrap.querySelector('.dt-ff-cond-val').addEventListener(condTextLike ? 'input' : 'change', e => {
        c.value = e.target.value;
        condTextLike ? saveFormsSoon() : saveFormsNow();
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
          <div class="dt-ff-item-name">${escHtml(cfg.label)}${(cfg.members || []).length ? ' <span class="dt-ff-badge">group</span>' : ''}</div>
          <div class="dt-ff-item-meta">${cfg.fields.filter(f => f.fill).length}/${cfg.fields.length} fields set${(cfg.members || []).length ? ` · ${cfg.members.length} forms` : ''}${onPage ? '' : ' · <span style="color:var(--mu)">not on this page</span>'}</div>
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
