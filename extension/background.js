// DevTools Sidebar — background (Chrome service worker / Firefox event page).
// The toolbar button toggles the sidebar in the active tab; the tab's bridge
// content script relays it to the main-world bundle.
const api = globalThis.browser ?? globalThis.chrome;

api.action.onClicked.addListener(tab => {
  if (tab.id == null) return;
  // Rejects on pages the content scripts can't run on (chrome://, the Web
  // Store, about: pages) — nothing to toggle there.
  api.tabs.sendMessage(tab.id, { type: 'dt-toggle-sidebar' }).catch(() => {});
});

// Cross-origin fetch for the Smart dark engine (relayed by bridge.js, which
// has already checked the URL is one the page uses). Cookies are never sent,
// only CSS or images come back, and a public page can't reach private-network
// hosts through us.
const MAX_TEXT = 8 * 1024 * 1024, MAX_IMAGE = 2 * 1024 * 1024;
function isPrivateHost(host) {
  host = host.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1'
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^f[cd][0-9a-f]{2}:/.test(host) || host === '0.0.0.0';
}
async function handleFetch({ url, kind }, sender) {
  const target = new URL(url);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('bad protocol');
  const pageHost = sender.tab && sender.tab.url ? new URL(sender.tab.url).hostname : '';
  if (isPrivateHost(target.hostname) && !isPrivateHost(pageHost)) throw new Error('private address');
  const res = await fetch(target.href, { credentials: 'omit', cache: 'force-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (kind === 'text') {
    if (type && type !== 'text/css' && type !== 'text/plain') throw new Error('not CSS: ' + type);
    const text = await res.text();
    if (text.length > MAX_TEXT) throw new Error('too large');
    return text;
  }
  if (!type.startsWith('image/')) throw new Error('not an image: ' + type);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE) throw new Error('too large');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'dt-fetch') return;
  handleFetch(msg, sender).then(data => sendResponse({ ok: true, data }), err => sendResponse({ ok: false, error: String(err && err.message || err) }));
  return true; // async response
});
