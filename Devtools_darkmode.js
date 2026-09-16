// ==UserScript==
// @name         DevTools Sidebar — Smart Dark Engine
// @namespace    http://tampermonkey.net/
// @version      3.6.22
// @description  Color-rewriting dark mode used by the Force Dark toggle. Must be @required before the main script.
// @author       MrNosferatu
// ==/UserScript==

// ─── Why not just `filter: invert(1) hue-rotate(180deg)`? ────────────────────
// That's the legacy "Filter" engine, and it has two unfixable problems:
//  1. Media can't be restored. The usual trick re-inverts <img>/<video> under
//     the inverted page, but filter intermediates are clamped to [0,1], so
//     saturated colours don't survive the round trip (pure red comes back as
//     rgb(171,62,62), yellow as beige). No counter-filter can undo that.
//  2. It's all-or-nothing: every icon, logo and SVG is either inverted or
//     re-inverted, whether that suits it or not.
//
// This engine instead leaves pixels alone and rewrites COLOURS:
//  • Every readable stylesheet rule is mirrored into one override sheet with
//    only its colour declarations, transformed in OKLCH (lightness remapped
//    per role — background / text / border — while hue is kept). Mirrors keep
//    each rule's selector, @media/@supports/@layer wrapper and !important
//    flag, so the page's own cascade order is preserved. Cross-origin sheets
//    are fetched (via the optional `fetchExternal` hook) and parsed.
//  • CSS variables get typed twins (--dt-bg-x / --dt-fg-x / --dt-bd-x) and
//    var() usages are rewritten to prefer the twin matching the property.
//  • Inline styles and SVG/HTML colour attributes (fill, stroke, bgcolor, …)
//    get per-element rules.
//  • Images and inline SVGs are CLASSIFIED instead of blanket-filtered:
//      - monochrome dark icons (transparent background) → inverted to light
//      - dark colourful transparent logos               → lightness-adapted
//      - multi-colour SVGs (logos, illustrations)       → paint left untouched
//      - photos, opaque images, video, canvas           → untouched
//  • A MutationObserver + CSSOM patches (insertRule & co., used by CSS-in-JS)
//    keep it current as the page changes.
//
// Usage: const engine = DT_createDarkEngine({ window, fetch, fetchExternal });
//        engine.enable(); engine.disable(); engine.isEnabled();
function DT_createDarkEngine(options) {
  const win = (options && options.window) || window;
  const doc = win.document;
  const pageFetch = (options && options.fetch) || null;          // un-intercepted fetch
  const fetchExternal = (options && options.fetchExternal) || null; // (url, 'text'|'dataurl') → Promise<string>

  const ATTR_ID = 'data-dt-dark-id';     // element has inline/attribute colour rules
  const ATTR_KEEP = 'data-dt-dark-keep'; // multi-colour SVG: leave its paint alone
  const ATTR_IMG = 'data-dt-dark-img';   // image treatment: invert | adapt
  const SVG_NS = 'http://www.w3.org/2000/svg';

  let active = false;

  // ─── Colour parsing ─────────────────────────────────────────────────────────
  const canvas = doc.createElement('canvas');
  canvas.width = canvas.height = 1;
  const cctx = canvas.getContext('2d', { willReadFrequently: true });
  const NOT_COLOR = new Set(['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'none', 'auto']);
  const parseCache = new Map();
  // → [r, g, b, a] (0-255, alpha 0-1) or null. The canvas does the parsing, so
  // named colours, hsl(), hwb(), oklch() … all work without a hand-written parser.
  function parseColor(str) {
    const key = str.trim().toLowerCase();
    if (parseCache.has(key)) return parseCache.get(key);
    let out = null;
    if (key && !NOT_COLOR.has(key) && !/var\(|calc\(|env\(|attr\(|currentcolor/.test(key)) {
      cctx.fillStyle = '#010203'; cctx.fillStyle = key;
      let v = cctx.fillStyle;
      if (v === '#010203') { cctx.fillStyle = '#030201'; cctx.fillStyle = key; if (cctx.fillStyle === '#030201') v = null; }
      if (v) {
        let m;
        if ((m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v))) out = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), 1];
        else if ((m = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/i.exec(v))) out = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
        else {
          // Serialized in another colour space (e.g. oklch) — rasterize one pixel.
          cctx.clearRect(0, 0, 1, 1); cctx.fillRect(0, 0, 1, 1);
          const p = cctx.getImageData(0, 0, 1, 1).data;
          out = p[3] ? [Math.round(p[0] * 255 / p[3]), Math.round(p[1] * 255 / p[3]), Math.round(p[2] * 255 / p[3]), p[3] / 255] : [0, 0, 0, 0];
        }
      }
    }
    if (parseCache.size > 20000) parseCache.clear();
    parseCache.set(key, out);
    return out;
  }

  // ─── OKLab / OKLCH ─────────────────────────────────────────────────────────
  const toLin = c => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const toGamma = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  function rgbToOklch(rgb) {
    const r = toLin(rgb[0]), g = toLin(rgb[1]), b = toLin(rgb[2]);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    return [L, Math.hypot(A, B), Math.atan2(B, A)];
  }
  function oklchToLinear(L, C, h) {
    const A = C * Math.cos(h), B = C * Math.sin(h);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
  }
  const inGamut = lin => lin.every(v => v >= -1e-4 && v <= 1 + 1e-4);
  // Out-of-gamut results keep lightness and hue and give up chroma — never clip
  // channels, which would shift the hue (the filter engine's failure mode).
  function oklchToRgb(L, C, h) {
    let lin = oklchToLinear(L, C, h);
    if (!inGamut(lin)) {
      let lo = 0, hi = C;
      for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (inGamut(oklchToLinear(L, mid, h))) lo = mid; else hi = mid; }
      lin = oklchToLinear(L, lo, h);
    }
    return lin.map(v => Math.round(Math.min(255, Math.max(0, toGamma(Math.min(1, Math.max(0, v)))))));
  }

  // ─── Colour roles ──────────────────────────────────────────────────────────
  // Lightness maps per role (OKLab L, 0 = black, 1 = white). Light surfaces go
  // dark and dark surfaces stay dark; text always ends up light; borders land
  // in between. Hue is preserved; background chroma is toned down a little so
  // big coloured panels don't glare.
  const ROLE_L = {
    bg: L => (L < 0.5 ? 0.12 + L * 0.52 : 0.38 - (L - 0.5) * 0.36),
    fg: L => (L < 0.5 ? 0.93 - L * 0.46 : 0.70 + (L - 0.5) * 0.46),
    bd: L => (L < 0.5 ? 0.50 - L * 0.20 : 0.40 - (L - 0.5) * 0.20),
  };
  const ROLE_C = { bg: 0.85, fg: 1, bd: 0.8 };
  // Vivid backgrounds (buttons, badges, brand bars) would lose their identity if
  // pushed as dark as neutral surfaces, so the more chroma a background has the
  // more of its own lightness it keeps (capped so white text still reads on it).
  function bgLightness(L, C) {
    const base = ROLE_L.bg(L);
    const k = Math.min(1, Math.max(0, (C - 0.04) / 0.1));
    return base + (Math.min(L, 0.5) - base) * k;
  }
  const roleCache = new Map();
  function roleColor(rgba, role) {
    const key = role + rgba.join(',');
    let out = roleCache.get(key);
    if (out) return out;
    const [L, C, h] = rgbToOklch(rgba);
    const [r, g, b] = oklchToRgb(role === 'bg' ? bgLightness(L, C) : ROLE_L[role](L), C * ROLE_C[role], h);
    out = rgba[3] < 1 ? `rgba(${r}, ${g}, ${b}, ${+rgba[3].toFixed(3)})` : `rgb(${r}, ${g}, ${b})`;
    if (roleCache.size > 20000) roleCache.clear();
    roleCache.set(key, out);
    return out;
  }

  // ─── CSS value rewriting ───────────────────────────────────────────────────
  const COLOR_FN = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)$/i;
  const IDENT = /-?[a-zA-Z_][\w-]*/y;
  const HEX = /#[0-9a-fA-F]{3,8}(?![\w-])/y;
  function matchParen(s, open) { // index just past the ')' matching s[open] === '('
    let depth = 0;
    for (let i = open; i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'") { i = skipQuote(s, i) - 1; continue; }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) return i + 1;
    }
    return s.length;
  }
  function skipQuote(s, i) { const q = s[i]; for (let j = i + 1; j < s.length; j++) { if (s[j] === '\\') j++; else if (s[j] === q) return j + 1; } return s.length; }
  function topLevelComma(s) {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'") { i = skipQuote(s, i) - 1; continue; }
      if (c === '(') depth++; else if (c === ')') depth--; else if (c === ',' && depth === 0) return i;
    }
    return -1;
  }
  function absoluteUrl(inner, base) {
    const raw = inner.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!raw || /^(?:data:|blob:|#|[a-z][\w+.-]*:\/\/)/i.test(raw)) return `url(${inner})`;
    try { return `url(${JSON.stringify(new URL(raw, base).href)})`; } catch { return `url(${inner})`; }
  }
  // Rewrites every colour (and var() reference) in `value` for `role`. Returns
  // the SAME string when nothing colour-related changed, so callers can skip it.
  function rewriteValue(value, role, base) {
    let out = '', changed = false, i = 0;
    const n = value.length;
    while (i < n) {
      const c = value[i];
      if (c === '"' || c === "'") { const j = skipQuote(value, i); out += value.slice(i, j); i = j; continue; }
      if (c === '#') {
        HEX.lastIndex = i;
        const m = HEX.exec(value);
        if (m && [4, 5, 7, 9].includes(m[0].length)) {
          const rgba = parseColor(m[0]);
          if (rgba) { out += roleColor(rgba, role); changed = true; i += m[0].length; continue; }
        }
      }
      if (/[a-zA-Z_-]/.test(c) && (i === 0 || !/[\w-]/.test(value[i - 1]))) {
        IDENT.lastIndex = i;
        const m = IDENT.exec(value);
        if (m) {
          const word = m[0], after = i + word.length;
          if (value[after] === '(') {
            const close = matchParen(value, after);
            const lower = word.toLowerCase();
            if (lower === 'url') { out += base ? absoluteUrl(value.slice(after + 1, close - 1), base) : value.slice(i, close); i = close; continue; }
            if (lower === 'var') {
              const inner = value.slice(after + 1, close - 1);
              const comma = topLevelComma(inner);
              const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
              if (/^--[\w-]+$/.test(name)) {
                const fallback = comma < 0 ? '' : ',' + rewriteValue(inner.slice(comma + 1), role, base);
                out += `var(--dt-${role}-${name.slice(2)}, var(${name}${fallback}))`;
                changed = true; i = close; continue;
              }
            }
            if (COLOR_FN.test(word)) {
              const src = value.slice(i, close);
              const rgba = /var\(/i.test(src) ? null : parseColor(src);
              if (rgba) { out += roleColor(rgba, role); changed = true; } else out += src;
              i = close; continue;
            }
            out += word + '('; i = after + 1; continue; // gradients, color-mix(), calc()…: rewrite inside
          }
          const rgba = NOT_COLOR.has(word.toLowerCase()) ? null : parseColor(word);
          if (rgba) { out += roleColor(rgba, role); changed = true; } else out += word;
          i = after; continue;
        }
      }
      out += c; i++;
    }
    return changed ? out : value;
  }

  // ─── Declarations ──────────────────────────────────────────────────────────
  const PROP_ROLE = {
    'background-color': 'bg', 'background-image': 'bg', 'box-shadow': 'bg', 'text-shadow': 'bg',
    'color': 'fg', 'caret-color': 'fg', 'text-decoration-color': 'fg', 'text-emphasis-color': 'fg',
    '-webkit-text-fill-color': 'fg', '-webkit-text-stroke-color': 'fg', 'fill': 'fg', 'stroke': 'fg',
    'stop-color': 'fg', 'flood-color': 'fg', 'lighting-color': 'fg',
    'border-top-color': 'bd', 'border-right-color': 'bd', 'border-bottom-color': 'bd', 'border-left-color': 'bd',
    'border-block-start-color': 'bd', 'border-block-end-color': 'bd', 'border-inline-start-color': 'bd', 'border-inline-end-color': 'bd',
    'outline-color': 'bd', 'column-rule-color': 'bd',
  };
  // A shorthand that contains var() leaves its longhands empty in the CSSOM
  // ("pending substitution") — only the shorthand itself carries the value.
  const SHORTHAND_ROLE = [
    ['background', 'bg'], ['border', 'bd'], ['border-color', 'bd'], ['border-top', 'bd'], ['border-right', 'bd'],
    ['border-bottom', 'bd'], ['border-left', 'bd'], ['border-block', 'bd'], ['border-inline', 'bd'],
    ['outline', 'bd'], ['text-decoration', 'fg'], ['column-rule', 'bd'],
  ];
  const PAINT = new Set(['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color']);

  // → { normal, paint } declaration strings. Paint (SVG) declarations are kept
  // apart so they can be excluded inside multi-colour SVGs.
  function rewriteDecls(style, base, forceImportant) {
    let normal = '', paint = '', pending = false;
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      const imp = forceImportant || style.getPropertyPriority(prop) === 'important' ? ' !important' : '';
      if (prop.charCodeAt(0) === 45 && prop.charCodeAt(1) === 45) { // custom property
        const v = style.getPropertyValue(prop);
        if (!v || v.length > 800) continue;
        for (const role of ['bg', 'fg', 'bd']) {
          const o = rewriteValue(v, role, base);
          if (o !== v) normal += `--dt-${role}-${prop.slice(2)}:${o}${imp};`;
        }
        continue;
      }
      const role = PROP_ROLE[prop];
      if (!role) continue;
      const v = style.getPropertyValue(prop);
      if (!v) { pending = true; continue; }
      const o = rewriteValue(v, role, base);
      if (o === v) continue;
      if (PAINT.has(prop)) paint += `${prop}:${o}${imp};`; else normal += `${prop}:${o}${imp};`;
    }
    if (pending) {
      for (const [sh, role] of SHORTHAND_ROLE) {
        const v = style.getPropertyValue(sh);
        if (!v || !v.includes('var(')) continue;
        const o = rewriteValue(v, role, base);
        if (o !== v) normal += `${sh}:${o}${forceImportant || style.getPropertyPriority(sh) === 'important' ? ' !important' : ''};`;
      }
    }
    return { normal, paint };
  }

  // ─── Rules ─────────────────────────────────────────────────────────────────
  const PSEUDO_ELEMENT = /::|:(?:before|after|first-line|first-letter)\b|:-(?:webkit|moz|ms)-/i;
  const NOT_KEEP = `:not([${ATTR_KEEP}],[${ATTR_KEEP}] *)`;

  function groupHeader(rule) {
    if (rule.media && 'mediaText' in rule.media && !rule.styleSheet) return `@media ${rule.media.mediaText}`;
    const kind = rule.constructor && rule.constructor.name;
    if (kind === 'CSSSupportsRule') return `@supports ${rule.conditionText}`;
    if (kind === 'CSSLayerBlockRule') return `@layer${rule.name ? ' ' + rule.name : ''}`;
    const text = rule.cssText || '';
    const brace = text.indexOf('{');
    return brace > 0 ? text.slice(0, brace).trim() : null;
  }

  function rewriteRules(rules, base, nested) {
    let out = '';
    for (let r = 0; r < rules.length; r++) {
      const rule = rules[r];
      try {
        if ('selectorText' in rule && rule.style) {
          const { normal, paint } = rewriteDecls(rule.style, base, false);
          const children = rule.cssRules && rule.cssRules.length ? rewriteRules(rule.cssRules, base, true) : '';
          const sel = rule.selectorText;
          if (nested || PSEUDO_ELEMENT.test(sel)) {
            if (normal || paint || children) out += `${sel}{${normal}${paint}${children}}`;
          } else {
            if (normal || children) out += `${sel}{${normal}${children}}`;
            if (paint) out += `:is(${sel})${NOT_KEEP}{${paint}}`;
          }
        } else if (rule.style && !('selectorText' in rule) && !('keyText' in rule)) {
          // CSSNestedDeclarations (declarations after nested rules)
          const { normal, paint } = rewriteDecls(rule.style, base, false);
          out += normal + paint;
        } else if (rule.styleSheet) { // @import
          const inner = sheetCss(rule.styleSheet, rule.href && new URL(rule.href, base).href);
          const media = rule.media && rule.media.mediaText;
          if (inner) out += media ? `@media ${media}{${inner}}` : inner;
        } else if (rule.cssRules && typeof rule.appendRule === 'function') { // @keyframes
          let frames = '', any = false;
          for (let k = 0; k < rule.cssRules.length; k++) {
            const frame = rule.cssRules[k];
            let decls = '';
            for (let i = 0; i < frame.style.length; i++) {
              const prop = frame.style[i];
              const v = frame.style.getPropertyValue(prop);
              const o = PROP_ROLE[prop] ? rewriteValue(v, PROP_ROLE[prop], base) : v;
              if (o !== v) any = true;
              decls += `${prop}:${o};`;
            }
            frames += `${frame.keyText}{${decls}}`;
          }
          if (any) out += `@keyframes ${rule.name}{${frames}}`;
        } else if (rule.cssRules) {
          const header = groupHeader(rule);
          const inner = header ? rewriteRules(rule.cssRules, base, nested) : '';
          if (inner) out += `${header}{${inner}}`;
        }
      } catch (e) { /* one odd rule never breaks the whole sheet */ }
    }
    return out;
  }

  // ─── Stylesheets ───────────────────────────────────────────────────────────
  const sheetCache = new WeakMap(); // CSSStyleSheet → { len, css }
  const dirtySheets = new WeakSet();
  const external = new Map();       // href → { css }
  let overrideSheet = null, fallbackStyle = null;

  function sheetCss(sheet, hrefHint) {
    if (sheet === overrideSheet) return '';
    let rules = null;
    try { rules = sheet.cssRules; } catch { /* cross-origin */ }
    const href = sheet.href || hrefHint || null;
    if (!rules) return href ? externalCss(href) : '';
    const cached = sheetCache.get(sheet);
    if (cached && cached.len === rules.length && !dirtySheets.has(sheet)) return cached.css;
    dirtySheets.delete(sheet);
    const css = rewriteRules(rules, href || doc.baseURI, false);
    sheetCache.set(sheet, { len: rules.length, css });
    return css;
  }

  function fetchText(url) {
    if (fetchExternal) return fetchExternal(url, 'text');
    if (!pageFetch) return Promise.reject(new Error('no fetch'));
    return pageFetch(url, { credentials: 'omit', mode: 'cors' }).then(r => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))));
  }
  function externalCss(href) {
    const hit = external.get(href);
    if (hit) return hit.css;
    const entry = { css: '' };
    external.set(href, entry);
    fetchText(href)
      .then(text => parseExternal(text, href, 0))
      .then(css => { entry.css = css; scheduleRebuild(); })
      .catch(() => {});
    return '';
  }
  async function parseExternal(text, href, depth) {
    let css = '';
    // Constructed sheets ignore @import, so follow them by hand (a few levels).
    const imports = [];
    text.replace(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?\s*([^;]*);/gi, (_, u, media) => { imports.push([u, media.trim()]); return _; });
    if (depth < 3) {
      for (const [u, media] of imports) {
        try {
          const abs = new URL(u, href).href;
          const inner = await parseExternal(await fetchText(abs), abs, depth + 1);
          css += media ? `@media ${media}{${inner}}` : inner;
        } catch {}
      }
    }
    const sheet = new win.CSSStyleSheet();
    await sheet.replace(text.replace(/@import[^;]*;/gi, ''));
    return css + rewriteRules(sheet.cssRules, href, false);
  }

  // ─── Per-element rules (inline styles, colour attributes) ──────────────────
  let idSeq = 0;
  const elementRules = new Map(); // id → css
  const COLOR_ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color'];
  const ELEMENT_SEL = '[style],[fill],[stroke],[stop-color],[flood-color],[lighting-color],[bgcolor],font[color]';

  function scanElement(el) {
    const sel = () => `[${ATTR_ID}="${id}"]`;
    let id = el.getAttribute(ATTR_ID), css = '';
    const inKeep = el.namespaceURI === SVG_NS && !!el.closest(`[${ATTR_KEEP}]`);
    if (!id) id = String(++idSeq);
    if (el.hasAttribute('style') && el.style && el.style.length) {
      // Inline styles beat normal stylesheet rules, so their mirrors are !important.
      const { normal, paint } = rewriteDecls(el.style, doc.baseURI, true);
      const decls = normal + (inKeep ? '' : paint);
      if (decls) css += `${sel()}{${decls}}`;
    }
    // Presentation attributes lose to any CSS rule, so :where() (zero
    // specificity) is enough to override them without beating page rules.
    let attrDecls = '';
    if (el.namespaceURI === SVG_NS && !inKeep) {
      for (const a of COLOR_ATTRS) {
        const v = el.getAttribute(a);
        if (!v) continue;
        const o = rewriteValue(v, 'fg', null);
        if (o !== v) attrDecls += `${a}:${o};`;
      }
    }
    const bgcolor = el.getAttribute('bgcolor');
    if (bgcolor) { const o = rewriteValue(bgcolor, 'bg', null); if (o !== bgcolor) attrDecls += `background-color:${o};`; }
    if (el.localName === 'font' && el.getAttribute('color')) { const v = el.getAttribute('color'); const o = rewriteValue(v, 'fg', null); if (o !== v) attrDecls += `color:${o};`; }
    if (attrDecls) css += `:where(${sel()}){${attrDecls}}`;

    if (css) {
      if (!el.hasAttribute(ATTR_ID)) el.setAttribute(ATTR_ID, id);
      if (elementRules.get(id) !== css) { elementRules.set(id, css); scheduleRebuild(); }
    } else if (el.hasAttribute(ATTR_ID)) {
      elementRules.delete(id);
      el.removeAttribute(ATTR_ID);
      scheduleRebuild();
    }
  }

  // ─── SVG classification ────────────────────────────────────────────────────
  // Monochrome icons get their paint rewritten like text (dark glyph → light).
  // Multi-colour artwork is marked "keep" so logos/illustrations stay true.
  function svgIsArtwork(svg) {
    if (svg.querySelector('image,linearGradient,radialGradient,pattern,foreignObject')) return true;
    const hues = new Set(), levels = new Set();
    const shapes = svg.querySelectorAll('path,circle,rect,ellipse,polygon,polyline,line,text');
    for (let i = 0; i < shapes.length && i < 200; i++) {
      const cs = win.getComputedStyle(shapes[i]);
      for (const v of [cs.fill, cs.stroke]) {
        if (!v || v === 'none') continue;
        if (v.startsWith('url(')) return true;
        const rgba = parseColor(v);
        if (!rgba || rgba[3] < 0.1) continue;
        const [L, C, h] = rgbToOklch(rgba);
        if (C > 0.05) hues.add(Math.round((((h * 180) / Math.PI + 360) % 360) / 40));
        levels.add(Math.round(L * 4));
      }
      if (hues.size >= 2) return true;
    }
    return hues.size >= 1 && levels.size >= 3;
  }

  // ─── Image classification ──────────────────────────────────────────────────
  const imageKind = new Map(); // url → Promise<'invert'|'adapt'|null>

  function samplePixels(img) {
    // A fresh canvas every time: drawing one cross-origin image taints a canvas
    // permanently, which would make every later sample on it fail too.
    const c = doc.createElement('canvas');
    c.width = c.height = 32;
    const sctx = c.getContext('2d', { willReadFrequently: true });
    try {
      sctx.drawImage(img, 0, 0, 32, 32);
      return sctx.getImageData(0, 0, 32, 32).data;
    } catch { return null; } // tainted (cross-origin) or undecodable
  }
  function decideImage(px) {
    let transparent = 0, opaque = 0, saturated = 0, sumL = 0;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (a < 26) { transparent++; continue; }
      if (a < 128) continue;
      opaque++;
      const [L, C] = rgbToOklch([px[i], px[i + 1], px[i + 2]]);
      sumL += L;
      if (C > 0.06) saturated++;
    }
    if (opaque < 10 || transparent / 1024 < 0.15) return null; // opaque → photo/screenshot: leave it
    const meanL = sumL / opaque;
    if (saturated / opaque < 0.15 && meanL < 0.5) return 'invert'; // dark monochrome glyph
    if (meanL < 0.35) return 'adapt';                              // dark colourful logo
    return null;
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = src;
    });
  }
  function classifyUrl(url, el) {
    let p = imageKind.get(url);
    if (!p) {
      p = (async () => {
        let px = el && el.localName === 'img' && el.complete ? samplePixels(el) : null;
        if (!px && /^(?:data:|blob:)/i.test(url)) px = samplePixels(await loadImage(url));
        if (!px) {
          let sameOrigin = false;
          try { sameOrigin = new URL(url, doc.baseURI).origin === win.location.origin; } catch {}
          if (sameOrigin) px = samplePixels(await loadImage(url));
          else if (fetchExternal) px = samplePixels(await loadImage(await fetchExternal(url, 'dataurl')));
        }
        return px ? decideImage(px) : null;
      })().catch(() => null);
      imageKind.set(url, p);
    }
    return p;
  }
  function setImageKind(el, kind) {
    if (!active) return;
    if (kind) { if (el.getAttribute(ATTR_IMG) !== kind) el.setAttribute(ATTR_IMG, kind); }
    else if (el.hasAttribute(ATTR_IMG)) el.removeAttribute(ATTR_IMG);
  }
  // Only small images (icons, logos) are classified; anything bigger is content.
  function considerImage(img, w, h) {
    const url = img.currentSrc || img.src;
    if (!url || !img.complete || !img.naturalWidth) return;
    const isSvg = /\.svg(?:[?#]|$)|^data:image\/svg/i.test(url);
    if (Math.max(w, h) > (isSvg ? 512 : 128)) { setImageKind(img, null); return; }
    classifyUrl(url, img).then(kind => setImageKind(img, kind));
  }
  function considerBackgroundIcon(el, bgImage, w, h) {
    if (!w || !h || Math.max(w, h) > 128 || el.textContent.trim()) return;
    const m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(bgImage);
    if (!m) return;
    let url; try { url = new URL(m[1], doc.baseURI).href; } catch { return; }
    classifyUrl(url, null).then(kind => setImageKind(el, kind));
  }

  // ─── Scanning ──────────────────────────────────────────────────────────────
  const pendingRoots = new Set();   // added subtrees: scan everything inside
  const pendingSingles = new Set(); // attribute changes: scan just that element
  let scanTimer = null;
  function queueScan(node, single) {
    (single ? pendingSingles : pendingRoots).add(node);
    if (!scanTimer) scanTimer = setTimeout(runScan, 60);
  }
  function outermostSvg(el) { let s = el.closest('svg'); while (s && s.parentElement && s.parentElement.closest('svg')) s = s.parentElement.closest('svg'); return s; }

  function runScan() {
    scanTimer = null;
    if (!active) { pendingRoots.clear(); pendingSingles.clear(); return; }
    const roots = [...pendingRoots], singles = [...pendingSingles];
    pendingRoots.clear(); pendingSingles.clear();
    const elements = new Set(), svgs = new Set(), imgs = new Set(), leaves = [];
    const visit = el => {
      if (el.id === 'dt-host') return; // the sidebar lives in its own shadow root
      if (el.matches(ELEMENT_SEL) || el.hasAttribute(ATTR_ID)) elements.add(el);
        if (el.namespaceURI === SVG_NS) { const s = outermostSvg(el); if (s) svgs.add(s); }
        else if (el.localName === 'img') imgs.add(el);
      else if (!el.childElementCount && leaves.length < 2000 && el.localName !== 'script' && el.localName !== 'style') leaves.push(el);
    };
    for (const root of roots) {
      if (!root.isConnected || root.nodeType !== 1) continue;
      visit(root);
      root.querySelectorAll('*').forEach(visit);
    }
    for (const el of singles) if (el.isConnected && el.nodeType === 1) visit(el);
    // Read phase (computed styles, layout) first, then write — avoids
    // interleaving style recalcs with attribute writes.
    const keepChanges = [];
    for (const svg of svgs) { const keep = svgIsArtwork(svg); if (keep !== svg.hasAttribute(ATTR_KEEP)) keepChanges.push([svg, keep]); }
    const imgSizes = [...imgs].map(img => [img, img.clientWidth || img.width, img.clientHeight || img.height]);
    const bgIcons = [];
    for (const el of leaves) {
      const bg = win.getComputedStyle(el).backgroundImage;
      if (bg && bg.includes('url(')) bgIcons.push([el, bg, el.clientWidth, el.clientHeight]);
    }
    for (const [svg, keep] of keepChanges) {
      if (keep) svg.setAttribute(ATTR_KEEP, ''); else svg.removeAttribute(ATTR_KEEP);
      svg.querySelectorAll(ELEMENT_SEL).forEach(el => elements.add(el));
      scheduleRebuild();
    }
    for (const el of elements) scanElement(el);
    for (const [img, w, h] of imgSizes) considerImage(img, w, h);
    for (const [el, bg, w, h] of bgIcons) considerBackgroundIcon(el, bg, w, h);
  }

  // ─── Output ────────────────────────────────────────────────────────────────
  function baseCss() {
    const c = (v, role) => roleColor(parseColor(v), role);
    return `:where(html){background-color:${c('#fff', 'bg')};color:${c('#000', 'fg')};color-scheme:dark}`
      + `:where(a:link){color:${c('#0000ee', 'fg')}}:where(a:visited){color:${c('#551a8b', 'fg')}}`
      + `:where(mark){background-color:${c('#ff0', 'bg')};color:${c('#000', 'fg')}}`
      + `:where(html) [${ATTR_IMG}="invert"]{filter:invert(.9)}`
      + `:where(html) [${ATTR_IMG}="adapt"]{filter:invert(.9) hue-rotate(180deg)}`;
  }

  let rebuildTimer = null, lastRebuild = 0, lastCss = '', lastSheetSig = '';
  function scheduleRebuild() {
    if (!active || rebuildTimer) return;
    // Coalesce bursts (CSS-in-JS can insert thousands of rules): at most ~8/s.
    const wait = Math.max(16, 120 - (Date.now() - lastRebuild));
    rebuildTimer = setTimeout(rebuild, wait);
  }
  function pageSheets() {
    const list = [];
    for (const s of doc.styleSheets) list.push(s);
    try { for (const s of doc.adoptedStyleSheets || []) if (s !== overrideSheet) list.push(s); } catch {}
    return list;
  }
  function rebuild() {
    rebuildTimer = null;
    if (!active) return;
    lastRebuild = Date.now();
    let css = baseCss();
    const sheets = pageSheets();
    for (const sheet of sheets) {
      if (sheet.disabled || (sheet.ownerNode && sheet.ownerNode === fallbackStyle)) continue;
      let part = sheetCss(sheet);
      const media = sheet.media && sheet.media.mediaText;
      if (part && media && media !== 'all') part = `@media ${media}{${part}}`;
      css += part;
    }
    for (const rule of elementRules.values()) css += rule;
    lastSheetSig = sheetSignature(sheets);
    if (css !== lastCss) { lastCss = css; writeOverride(css); }
    ensureLast();
  }
  function writeOverride(css) {
    if (overrideSheet) {
      try { overrideSheet.replaceSync(css); return; } catch {}
    }
    if (!fallbackStyle) { fallbackStyle = doc.createElement('style'); fallbackStyle.id = 'dt-dark-engine'; }
    fallbackStyle.textContent = css;
  }
  // The override must come after every page sheet to win cascade ties. Adopted
  // sheets apply after all <style>/<link> sheets, so being LAST in
  // document.adoptedStyleSheets does that (and sidesteps style-src CSP).
  function ensureLast() {
    if (overrideSheet) {
      try {
        const list = doc.adoptedStyleSheets;
        if (list[list.length - 1] !== overrideSheet) doc.adoptedStyleSheets = [...list].filter(s => s !== overrideSheet).concat(overrideSheet);
        return;
      } catch { overrideSheet = null; writeOverride(lastCss); }
    }
    if (fallbackStyle && doc.documentElement && doc.documentElement.lastElementChild !== fallbackStyle) doc.documentElement.appendChild(fallbackStyle);
  }
  function sheetSignature(sheets) {
    let sig = '';
    for (const s of sheets) { let len = -1; try { len = s.cssRules.length; } catch {} sig += (s.href || 'i') + ':' + len + '|'; }
    return sig;
  }

  // ─── Change tracking ───────────────────────────────────────────────────────
  // CSS-in-JS libraries (emotion, styled-components, …) add rules through the
  // CSSOM without touching the DOM, so watch those methods too.
  function patchCssom() {
    const mark = sheet => { if (active && sheet && sheet !== overrideSheet) { dirtySheets.add(sheet); scheduleRebuild(); } };
    const patch = (proto, names, sheetOf) => {
      if (!proto || proto.__dtDarkPatched) return;
      for (const name of names) {
        const orig = proto[name];
        if (typeof orig !== 'function') continue;
        proto[name] = function () {
          const result = orig.apply(this, arguments);
          mark(sheetOf(this));
          if (result && typeof result.then === 'function') result.then(() => mark(sheetOf(this)), () => {});
          return result;
        };
      }
      Object.defineProperty(proto, '__dtDarkPatched', { value: true });
    };
    patch(win.CSSStyleSheet && win.CSSStyleSheet.prototype, ['insertRule', 'deleteRule', 'addRule', 'removeRule', 'replace', 'replaceSync'], s => s);
    patch(win.CSSGroupingRule && win.CSSGroupingRule.prototype, ['insertRule', 'deleteRule'], r => r.parentStyleSheet);
  }

  let observer = null, pollTimer = null, gcTimer = null;
  function onMutations(mutations) {
    let sheetsChanged = false;
    for (const m of mutations) {
      const t = m.target;
      if (m.type === 'childList') {
        if (t.localName === 'style') sheetsChanged = true;
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.localName === 'style' || n.localName === 'link') sheetsChanged = true;
          if (n.id !== 'dt-host') queueScan(n);
        }
        for (const n of m.removedNodes) if (n.localName === 'style' || n.localName === 'link') sheetsChanged = true;
      } else if (m.type === 'characterData') {
        if (t.parentNode && t.parentNode.localName === 'style') sheetsChanged = true;
      } else if (m.type === 'attributes') {
        if ((t.localName === 'link' || t.localName === 'style') && /^(?:media|disabled|rel|href)$/.test(m.attributeName)) sheetsChanged = true;
        else queueScan(t, true);
      }
    }
    if (sheetsChanged) scheduleRebuild();
  }
  function onLoad(e) {
    const t = e.target;
    if (!t || !t.localName) return;
    if (t.localName === 'link') scheduleRebuild();
    else if (t.localName === 'img') queueScan(t, true);
  }

  function enable() {
    if (active) return;
    active = true;
    try { overrideSheet = overrideSheet || new win.CSSStyleSheet(); } catch { overrideSheet = null; }
    lastCss = '';
    writeOverride(baseCss()); // dark canvas immediately — no white flash while sheets are processed
    ensureLast();
    patchCssom();
    observer = new win.MutationObserver(onMutations);
    observer.observe(doc, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['style', 'fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'bgcolor', 'color', 'src', 'srcset', 'media', 'disabled', 'rel', 'href'],
    });
    doc.addEventListener('load', onLoad, true);
    // Safety net for changes nothing notifies about (adoptedStyleSheets pushes,
    // a page resetting the adopted list, sheets swapped via CSSOM).
    pollTimer = setInterval(() => {
      ensureLast();
      if (sheetSignature(pageSheets()) !== lastSheetSig) scheduleRebuild();
    }, 1000);
    // Drop rules for elements that left the page.
    gcTimer = setInterval(() => {
      if (!elementRules.size) return;
      const live = new Set([...doc.querySelectorAll(`[${ATTR_ID}]`)].map(el => el.getAttribute(ATTR_ID)));
      let dropped = false;
      for (const id of elementRules.keys()) if (!live.has(id)) { elementRules.delete(id); dropped = true; }
      if (dropped) scheduleRebuild();
    }, 10000);
    if (doc.documentElement) queueScan(doc.documentElement);
    scheduleRebuild();
  }

  function disable() {
    if (!active) return;
    active = false;
    if (observer) observer.disconnect();
    observer = null;
    doc.removeEventListener('load', onLoad, true);
    clearInterval(pollTimer); clearInterval(gcTimer); clearTimeout(rebuildTimer); clearTimeout(scanTimer);
    rebuildTimer = scanTimer = null;
    pendingRoots.clear(); pendingSingles.clear();
    if (overrideSheet) { try { doc.adoptedStyleSheets = [...doc.adoptedStyleSheets].filter(s => s !== overrideSheet); } catch {} }
    if (fallbackStyle) fallbackStyle.remove();
    for (const el of doc.querySelectorAll(`[${ATTR_ID}],[${ATTR_KEEP}],[${ATTR_IMG}]`)) {
      el.removeAttribute(ATTR_ID); el.removeAttribute(ATTR_KEEP); el.removeAttribute(ATTR_IMG);
    }
    elementRules.clear();
    lastCss = '';
  }

  return { enable, disable, isEnabled: () => active, rescan: () => { if (active) { queueScan(doc.documentElement); scheduleRebuild(); } } };
}
