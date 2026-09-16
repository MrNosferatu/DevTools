// DevTools Sidebar — extension storage bridge (ISOLATED world content script).
//
// The sidebar itself runs in the page's MAIN world (it has to, to patch the
// page's real fetch/XHR), where extension APIs like chrome.storage don't exist.
// This script runs in the extension's isolated world, owns chrome.storage, and
// talks to the main-world bundle over a private MessageChannel:
//
//   bridge → page window : { __dtExtBridge: 'port' } + transferred MessagePort
//   bridge → main (port) : { type: 'init', data }        full storage snapshot
//                          { type: 'changed', changes }  writes from OTHER tabs
//                          { type: 'toggle' }            toolbar button clicked
//                          { type: 'fetchResult', id, ok, data|error }
//   main → bridge (port) : { type: 'set', key, value }
//                          { type: 'fetch', id, url, kind: 'text'|'dataurl' }
//
// Only the port handoff crosses window.postMessage; settings (e.g. the Postman
// API key) travel over the port, and the main-world listener, registered at
// document_start before any page script, swallows the handoff message.
(() => {
  if (window.top !== window.self) return;
  const api = globalThis.browser ?? globalThis.chrome;

  // Last known stored value per key (JSON), and the values THIS tab wrote that
  // storage.onChanged hasn't echoed back yet. An echo of our own write is local;
  // anything else is a remote change (another tab) and is forwarded — this is
  // what GM_addValueChangeListener's `remote` flag meant.
  const known = {};
  const pendingWrites = {};
  // chrome.storage hands objects back with their keys SORTED, so a plain
  // JSON.stringify of our own write never equals its echo — every save looked
  // like another tab's change and the page reloaded a stale copy over newer
  // in-memory state. Compare with keys sorted on both sides.
  const canonical = v => JSON.stringify(v, (_, val) => (val && typeof val === 'object' && !Array.isArray(val)
    ? Object.keys(val).sort().reduce((o, k) => { o[k] = val[k]; return o; }, {})
    : val));
  let port = null;
  let snapshot = null;

  function connect() {
    if (port || !snapshot) return;
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = e => {
      const m = e.data;
      if (m && m.type === 'fetch') { relayFetch(m); return; }
      if (!m || m.type !== 'set' || typeof m.key !== 'string') return;
      const json = canonical(m.value);
      if (known[m.key] === json) return; // no-op write: storage would emit no change event
      known[m.key] = json;
      (pendingWrites[m.key] ||= []).push(json);
      api.storage.local.set({ [m.key]: m.value });
    };
    port.postMessage({ type: 'init', data: snapshot });
    window.postMessage({ __dtExtBridge: 'port' }, '*', [channel.port2]);
  }

  // Cross-origin fetches for the dark engine. The background does the request
  // (no cookies); this side only lets through URLs the page itself uses — a
  // stylesheet or image it references, or anything on its own or a stylesheet's
  // origin (for @import and CSS background icons) — so the page can't turn the
  // extension into a general-purpose CORS proxy.
  function allowedFetch(url, kind) {
    let u;
    try { u = new URL(url, location.href); } catch { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.origin === location.origin) return true;
    const sheetOrigins = new Set();
    for (const link of document.querySelectorAll('link[rel~="stylesheet" i][href]')) {
      if (link.href === u.href) return true;
      try { sheetOrigins.add(new URL(link.href).origin); } catch {}
    }
    if (kind === 'dataurl') for (const img of document.images) if ((img.currentSrc || img.src) === u.href) return true;
    return sheetOrigins.has(u.origin);
  }
  function relayFetch(m) {
    const reply = r => { if (port) port.postMessage({ type: 'fetchResult', id: m.id, ...r }); };
    if ((m.kind !== 'text' && m.kind !== 'dataurl') || typeof m.url !== 'string' || !allowedFetch(m.url, m.kind)) {
      reply({ ok: false, error: 'not allowed' });
      return;
    }
    api.runtime.sendMessage({ type: 'dt-fetch', url: m.url, kind: m.kind })
      .then(r => reply(r && r.ok ? { ok: true, data: r.data } : { ok: false, error: (r && r.error) || 'failed' }))
      .catch(err => reply({ ok: false, error: String(err && err.message || err) }));
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const remote = {};
    for (const [key, { newValue }] of Object.entries(changes)) {
      const json = canonical(newValue);
      const queue = pendingWrites[key];
      const i = queue ? queue.indexOf(json) : -1;
      if (i !== -1) { queue.splice(0, i + 1); continue; }
      known[key] = json;
      remote[key] = newValue;
    }
    if (port && Object.keys(remote).length) port.postMessage({ type: 'changed', changes: remote });
  });

  api.runtime.onMessage.addListener(msg => {
    if (msg && msg.type === 'dt-toggle-sidebar' && port) port.postMessage({ type: 'toggle' });
  });

  // The main-world bundle announces itself at startup; if it loaded after our
  // first handoff (injection order between worlds isn't guaranteed), retry.
  window.addEventListener('message', e => {
    if (e.source === window && e.data && e.data.__dtExtBridge === 'hello' && port) {
      port.close(); port = null; connect();
    }
  });

  api.storage.local.get(null).then(data => {
    snapshot = data || {};
    for (const [k, v] of Object.entries(snapshot)) known[k] = canonical(v);
    connect();
  });
})();
