// ==UserScript==
// @name         DevTools Sidebar — Base URL Switcher Plugin
// @namespace    http://tampermonkey.net/
// @version      3.6.3
// @description  Base URL Switcher plugin for DevTools Sidebar — a floating button for swapping between configured environments (prod/staging/...) on matching pages.
// @author       MrNosferatu
// ==/UserScript==

// Registers a factory rather than running immediately — see Devtools_plugins.js.
// Note: getGroupHosts() stays a CORE helper (exposed via ctx) rather than
// living here, because the Recorder plugin also needs it to match its
// "attach a Base URL group as a target" feature, and ctx is built once before
// any plugin factory runs — a plugin can't hand a function to ctx in time for
// other plugins in the same registration pass to use it.
DT_registerPlugin(function createBaseUrlPlugin(ctx) {
  const { Store, state, $, $$, $1, escHtml, BASEURL_COLORS, getGroupHosts } = ctx;

  // ─── Base URL Switcher panel HTML ─────────────────────────────────────────────
  function buildBaseUrlPanel() {
    return `
      <div class="dt-section">
        <div class="dt-slabel">Environment Switcher</div>
        <div class="dt-row" style="margin-bottom:10px">
          <div class="dt-row-label" style="display:flex;align-items:center;gap:5px">Enable globally</div>
          <label class="dt-toggle"><input type="checkbox" id="dt-baseurl-enabled"><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
        </div>
        <div class="dt-row-sub" style="margin-bottom:14px;color:var(--mu);font-size:11px">When enabled, a floating button appears on matching pages letting you swap the base URL.</div>
      </div>
      <div class="dt-section" id="dt-baseurl-groups-section">
        <div class="dt-slabel">URL Groups</div>
        <div id="dt-baseurl-groups-list"></div>
        <button class="dt-pe-add-pattern" id="dt-baseurl-add-group" style="margin-top:10px;width:100%;justify-content:center">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="5.5" y1="1" x2="5.5" y2="10"/><line x1="1" y1="5.5" x2="10" y2="5.5"/></svg>
          Add Group
        </button>
      </div>
    `;
  }

  // ─── Base URL Panel ──────────────────────────────────────────────────────────
  function initBaseUrlPanel() {
    const enabledChk = $('dt-baseurl-enabled');
    if (!enabledChk) return;
    enabledChk.checked = state.baseUrl.enabled;
    enabledChk.addEventListener('change', e => {
      state.baseUrl.enabled = e.target.checked;
      Store.set('baseurl.enabled', state.baseUrl.enabled);
      checkBaseUrlFab();
    });
    $('dt-baseurl-add-group').addEventListener('click', () => {
      const group = {
        id: Date.now(),
        label: 'New Group',
        enabled: true,
        apiPrefix: '',
        entries: [
          { label: 'Production', url: '', color: BASEURL_COLORS[0] },
          { label: 'Staging',    url: '', color: BASEURL_COLORS[1] },
        ],
      };
      state.baseUrl.groups.push(group);
      Store.set('baseurl.groups', state.baseUrl.groups);
      renderBaseUrlGroups();
      checkBaseUrlFab();
    });
    renderBaseUrlGroups();
    checkBaseUrlFab();
  }

  // Debounced persistence + derived-UI refresh for rapid text input.
  // Callers update in-memory `state` synchronously (so the field value is always
  // authoritative and never re-rendered mid-type); this coalesces the expensive
  // follow-up work — Store.set serializes the ENTIRE groups array to GM storage
  // (a synchronous disk/IndexedDB write, slow on Firefox), plus FAB rebuild,
  // plugin notify, and host re-render — so it runs once ~300ms after typing
  // settles instead of on every keystroke. Doing it per-keystroke pegged the CPU
  // to 100% and dropped characters. Flags accumulate across coalesced calls so
  // no refresh is lost if the user jumps between fields within the window.
  let _saveTimer = null;
  let _saveFlags = { fab: false, notify: false, hosts: null };
  function saveGroupsSoon(opts) {
    opts = opts || {};
    if (opts.fab) _saveFlags.fab = true;
    if (opts.notify) _saveFlags.notify = true;
    if (opts.hosts != null) _saveFlags.hosts = opts.hosts;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      const f = _saveFlags;
      _saveFlags = { fab: false, notify: false, hosts: null };
      Store.set('baseurl.groups', state.baseUrl.groups);
      if (f.hosts != null) renderBaseUrlHosts(f.hosts);
      if (f.fab) checkBaseUrlFab();
      if (f.notify) ctx.notifyPluginsBaseUrlGroupsChanged();
    }, 300);
  }

  function renderBaseUrlGroups() {
    const list = $('dt-baseurl-groups-list');
    if (!list) return;
    list.innerHTML = '';
    state.baseUrl.groups.forEach((group, gi) => {
      const el = document.createElement('div');
      el.className = 'dt-baseurl-group';
      el.innerHTML = `
        <div class="dt-baseurl-group-head">
          <input class="dt-baseurl-group-label-input" id="dt-bug-label-${gi}" value="${escHtml(group.label)}" placeholder="Group name" spellcheck="false">
          <label class="dt-toggle" style="width:34px;height:18px;flex-shrink:0" title="${group.enabled?'Enabled':'Disabled'}">
            <input type="checkbox" id="dt-bug-enabled-${gi}" ${group.enabled?'checked':''}>
            <div class="dt-toggle-track" style="border-radius:9px"><div class="dt-toggle-thumb" style="top:2px;left:2px;width:12px;height:12px"></div></div>
          </label>
        </div>
        <div class="dt-baseurl-group-body">
          <div class="dt-baseurl-match-row" style="flex-wrap:wrap;gap:4px;align-items:flex-start">
            <span class="dt-baseurl-match-label" style="flex-shrink:0;margin-top:2px">Active on:</span>
            <div id="dt-bug-hosts-${gi}" style="display:flex;flex-wrap:wrap;gap:3px;flex:1"></div>
          </div>
          <div class="dt-baseurl-match-row" style="align-items:center">
            <span class="dt-baseurl-match-label" style="flex-shrink:0">API prefix</span>
            <input class="dt-baseurl-entry-url" id="dt-bug-prefix-${gi}" placeholder="optional, e.g. /api" value="${escHtml(group.apiPrefix||'')}" spellcheck="false" autocomplete="off" style="flex:1">
          </div>
          <div class="dt-baseurl-match-row" style="align-items:flex-start">
            <span class="dt-baseurl-match-label" style="flex-shrink:0;margin-top:6px">Mock body</span>
            <textarea class="dt-baseurl-mock-input" id="dt-bug-mock-${gi}" placeholder="optional — overrides the default Mock Fail response body for this group" spellcheck="false" style="flex:1">${escHtml(group.mockBody||'')}</textarea>
          </div>
          <div id="dt-bug-entries-${gi}"></div>
        </div>
        <div class="dt-baseurl-group-foot">
          <button class="dt-baseurl-group-add-url" id="dt-bug-add-${gi}">+ Add URL</button>
          <button class="dt-baseurl-group-del" id="dt-bug-del-${gi}">Delete Group</button>
        </div>
      `;
      list.appendChild(el);

      // Label input
      el.querySelector(`#dt-bug-label-${gi}`).addEventListener('input', e => {
        state.baseUrl.groups[gi].label = e.target.value;
        // recorder bucket labels are derived live from group/entry names
        saveGroupsSoon({ fab: true, notify: true });
      });
      // API prefix — restricts target/group matching (e.g. Recorder) to paths
      // starting with this, so non-API requests on the same host (static
      // assets, app build manifests, etc) don't get pulled into the docs.
      el.querySelector(`#dt-bug-prefix-${gi}`).addEventListener('input', e => {
        state.baseUrl.groups[gi].apiPrefix = e.target.value.trim();
        saveGroupsSoon();
      });
      // Group-level Mock Fail body override — used by the request intercept
      // modal's "Mock Fail" for URLs whose host matches one of this group's
      // entries (an entry-level override wins over this; see resolveMockFailure
      // in the core script).
      el.querySelector(`#dt-bug-mock-${gi}`).addEventListener('input', e => {
        state.baseUrl.groups[gi].mockBody = e.target.value;
        saveGroupsSoon();
      });
      // Enabled toggle
      el.querySelector(`#dt-bug-enabled-${gi}`).addEventListener('change', e => {
        state.baseUrl.groups[gi].enabled = e.target.checked;
        Store.set('baseurl.groups', state.baseUrl.groups);
        checkBaseUrlFab();
      });
      // Delete group
      el.querySelector(`#dt-bug-del-${gi}`).addEventListener('click', () => {
        state.baseUrl.groups.splice(gi, 1);
        Store.set('baseurl.groups', state.baseUrl.groups);
        renderBaseUrlGroups();
        checkBaseUrlFab();
      });
      // Add URL entry
      el.querySelector(`#dt-bug-add-${gi}`).addEventListener('click', () => {
        const usedCount = state.baseUrl.groups[gi].entries.length;
        state.baseUrl.groups[gi].entries.push({ label: 'New', url: '', color: BASEURL_COLORS[usedCount % BASEURL_COLORS.length] });
        Store.set('baseurl.groups', state.baseUrl.groups);
        renderBaseUrlEntries(gi);
        renderBaseUrlHosts(gi);
      });
      renderBaseUrlEntries(gi);
      renderBaseUrlHosts(gi);
    });
    ctx.notifyPluginsBaseUrlGroupsChanged();
  }

  function renderBaseUrlHosts(gi) {
    const cont = $(`dt-bug-hosts-${gi}`);
    if (!cont) return;
    const hosts = getGroupHosts(state.baseUrl.groups[gi]);
    cont.innerHTML = '';
    if (hosts.size === 0) {
      const empty = document.createElement('span');
      empty.style.cssText = 'color:var(--mu);font-size:10px;font-style:italic';
      empty.textContent = 'Add URLs below to activate';
      cont.appendChild(empty);
      return;
    }
    hosts.forEach(host => {
      const tag = document.createElement('span');
      tag.style.cssText = 'display:inline-block;font-size:10px;padding:1px 6px;border-radius:10px;background:var(--sf2);color:var(--tx2);border:1px solid var(--bd);font-family:monospace';
      tag.textContent = host;
      cont.appendChild(tag);
    });
  }

  function renderBaseUrlEntries(gi) {
    const group = state.baseUrl.groups[gi];
    const cont = $(`dt-bug-entries-${gi}`);
    if (!cont) return;
    cont.innerHTML = '';
    let colorAssigned = false;
    group.entries.forEach((entry, ei) => {
      if (!entry.color) { entry.color = BASEURL_COLORS[ei % BASEURL_COLORS.length]; colorAssigned = true; }
      const row = document.createElement('div');
      row.className = 'dt-baseurl-entry';
      row.innerHTML = `
        <div class="dt-baseurl-entry-color" id="dt-bue-color-${gi}-${ei}" style="background:${escHtml(entry.color)}" title="Pick color"></div>
        <input class="dt-baseurl-entry-label-input" placeholder="Label" value="${escHtml(entry.label||'')}" spellcheck="false">
        <input class="dt-baseurl-entry-url" placeholder="https://..." value="${escHtml(entry.url||'')}" spellcheck="false">
        <button class="dt-baseurl-entry-mock${(entry.mockBody||'').trim()?' has-mock':''}" title="Mock Fail body override for this URL">5xx</button>
        <button class="dt-baseurl-entry-del" title="Remove">
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.7"><line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/></svg>
        </button>
        <div class="dt-baseurl-color-strip" id="dt-bue-colors-${gi}-${ei}" style="display:none">
          ${BASEURL_COLORS.map(c=>`<div class="dt-baseurl-color-dot${c===entry.color?' selected':''}" data-color="${c}" style="background:${c}"></div>`).join('')}
        </div>
      `;
      const colorStrip = row.querySelector(`#dt-bue-colors-${gi}-${ei}`);
      const colorSwatch = row.querySelector(`#dt-bue-color-${gi}-${ei}`);
      colorSwatch.addEventListener('click', evt => {
        evt.stopPropagation();
        const open = colorStrip.style.display !== 'none';
        $$('.dt-baseurl-color-strip').forEach(s => s.style.display = 'none');
        colorStrip.style.display = open ? 'none' : 'flex';
      });
      colorStrip.querySelectorAll('.dt-baseurl-color-dot').forEach(dot => {
        dot.addEventListener('click', evt => {
          evt.stopPropagation();
          state.baseUrl.groups[gi].entries[ei].color = dot.dataset.color;
          Store.set('baseurl.groups', state.baseUrl.groups);
          colorSwatch.style.background = dot.dataset.color;
          colorStrip.querySelectorAll('.dt-baseurl-color-dot').forEach(d => d.classList.toggle('selected', d===dot));
          colorStrip.style.display = 'none';
          checkBaseUrlFab();
        });
      });
      row.querySelector('.dt-baseurl-entry-label-input').addEventListener('input', e => {
        state.baseUrl.groups[gi].entries[ei].label = e.target.value;
        // recorder bucket labels are derived live from group/entry names
        saveGroupsSoon({ fab: true, notify: true });
      });
      row.querySelector('.dt-baseurl-entry-url').addEventListener('input', e => {
        state.baseUrl.groups[gi].entries[ei].url = e.target.value;
        saveGroupsSoon({ fab: true, hosts: gi });
      });
      row.querySelector('.dt-baseurl-entry-del').addEventListener('click', () => {
        state.baseUrl.groups[gi].entries.splice(ei, 1);
        Store.set('baseurl.groups', state.baseUrl.groups);
        renderBaseUrlEntries(gi);
        renderBaseUrlHosts(gi);
        checkBaseUrlFab();
      });
      cont.appendChild(row);
      // Per-URL Mock Fail body override — most specific level; wins over the
      // group override and the global default. Hidden behind the "5xx" toggle
      // so the entry row stays compact.
      const mockWrap = document.createElement('div');
      mockWrap.className = 'dt-baseurl-entry-mock-wrap';
      mockWrap.innerHTML = `<textarea class="dt-baseurl-mock-input" placeholder="optional — overrides the group/default Mock Fail body for this URL" spellcheck="false"></textarea>`;
      const mockTa = mockWrap.querySelector('textarea');
      mockTa.value = entry.mockBody || '';
      const mockBtn = row.querySelector('.dt-baseurl-entry-mock');
      mockBtn.addEventListener('click', () => mockWrap.classList.toggle('open'));
      mockTa.addEventListener('input', e => {
        state.baseUrl.groups[gi].entries[ei].mockBody = e.target.value;
        mockBtn.classList.toggle('has-mock', !!e.target.value.trim());
        saveGroupsSoon();
      });
      cont.appendChild(mockWrap);
    });
    // Persist ONLY when a missing color default was actually assigned. This
    // write used to run unconditionally on every render — and the cross-tab
    // sync handler for 'baseurl.groups' re-renders on every remote change, so
    // any edit in one tab made every other tab (the script runs on ALL sites)
    // re-render AND write the value straight back, re-triggering everyone in an
    // infinite ping-pong. With 2+ tabs open, one keystroke in any Environments
    // field stormed thousands of synchronous GM writes per second across all
    // tabs and froze the whole browser.
    if (colorAssigned) Store.set('baseurl.groups', state.baseUrl.groups);
    if (!renderBaseUrlEntries._closerBound) {
      renderBaseUrlEntries._closerBound = true;
      document.addEventListener('click', () => {
        $$('.dt-baseurl-entry .dt-baseurl-color-strip').forEach(s => s.style.display = 'none');
      });
    }
  }

  // Determines the "active" entry of a group by checking which entry's host
  // matches the current page — accurate regardless of stored index/order,
  // and survives entries being added/removed/reordered.
  function getActiveEntry(group) {
    const currentHost = window.location.host;
    const idx = (group.entries || []).findIndex(e => {
      if (!e.url) return false;
      try {
        const u = new URL(e.url.includes('://') ? e.url : 'http://' + e.url);
        return u.host === currentHost;
      } catch { return false; }
    });
    return idx >= 0 ? group.entries[idx] : null;
  }

  function checkBaseUrlFab() {
    const fab = $('dt-baseurl-fab');
    if (!fab) return;
    if (!state.baseUrl.enabled) { fab.style.display = 'none'; return; }
    const currentHost = window.location.host;
    const matchingGroups = state.baseUrl.groups.filter(g => {
      if (!g.enabled) return false;
      return getGroupHosts(g).has(currentHost);
    });
    if (matchingGroups.length === 0) { fab.style.display = 'none'; return; }
    fab.style.display = '';
    const activeEntry = getActiveEntry(matchingGroups[0]);
    const fabLabel = $('dt-baseurl-fab-label');
    if (fabLabel) fabLabel.textContent = matchingGroups.length === 1
      ? (activeEntry?.label || 'Switch URL')
      : 'Switch URL';
    const fabBtn = $('dt-baseurl-fab-btn');
    if (fabBtn) fabBtn.style.background = activeEntry?.color || matchingGroups[0]?.entries[0]?.color || 'var(--ac)';
    bindBaseUrlFab(matchingGroups);
  }

  function bindBaseUrlFab(matchingGroups) {
    const fab = $('dt-baseurl-fab');
    const fabBtn = $('dt-baseurl-fab-btn');
    const fabMenu = $('dt-baseurl-fab-menu');
    if (!fab || !fabBtn || !fabMenu) return;

    // Rebuild menu
    fabMenu.innerHTML = '';
    matchingGroups.forEach(group => {
      if (group.entries.length === 0) return;
      const activeEntry = getActiveEntry(group);
      const header = document.createElement('div');
      header.style.cssText = 'padding:4px 10px 2px;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mu);';
      header.textContent = group.label;
      fabMenu.appendChild(header);
      group.entries.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'dt-baseurl-fab-item' + (entry === activeEntry ? ' active' : '');
        item.innerHTML = `<div class="dt-baseurl-fab-dot" style="background:${escHtml(entry.color||'var(--ac)')}"></div><span class="dt-baseurl-fab-item-label">${escHtml(entry.label||'—')}</span><span class="dt-baseurl-fab-item-url">${escHtml(entry.url||'—')}</span>`;
        item.addEventListener('click', () => {
          fabMenu.classList.remove('open');
          applyBaseUrl(group, entry);
        });
        fabMenu.appendChild(item);
      });
    });

    // Toggle menu on click (re-bind cleanly)
    const newFabBtn = fabBtn.cloneNode(true);
    fabBtn.replaceWith(newFabBtn);
    const activeEntry0 = getActiveEntry(matchingGroups[0]);
    newFabBtn.style.background = activeEntry0?.color || matchingGroups[0]?.entries[0]?.color || 'var(--ac)';
    const fabLbl = newFabBtn.querySelector('#dt-baseurl-fab-label');
    if (fabLbl) fabLbl.textContent = activeEntry0?.label || 'Switch URL';
    newFabBtn.addEventListener('click', e => {
      e.stopPropagation();
      fabMenu.classList.toggle('open');
    });
    // Bound ONCE — bindBaseUrlFab runs on every checkBaseUrlFab() (i.e. every
    // settings keystroke); registering a fresh document listener each time
    // leaked hundreds of handlers over a session.
    if (!bindBaseUrlFab._closerBound) {
      bindBaseUrlFab._closerBound = true;
      document.addEventListener('click', () => {
        const menu = $('dt-baseurl-fab-menu');
        if (menu) menu.classList.remove('open');
      });
    }
  }

  function applyBaseUrl(group, entry) {
    if (!entry.url) return;
    try {
      // Scheme-less entries inherit the CURRENT page protocol — previously they
      // were hard-prefixed with http://, silently downgrading https pages.
      const newBase = new URL(entry.url.includes('://') ? entry.url : window.location.protocol + '//' + entry.url);
      const cur = new URL(window.location.href);
      // Replace origin — set hostname and port separately; the `.host` setter
      // does not reliably clear a pre-existing port when the new host has none.
      cur.protocol = newBase.protocol;
      cur.hostname = newBase.hostname;
      cur.port = newBase.port; // '' clears any leftover port (e.g. localhost:3002 -> def.com)
      if (newBase.pathname && newBase.pathname !== '/') {
        cur.pathname = newBase.pathname + (cur.pathname.startsWith('/') ? cur.pathname : '/' + cur.pathname);
      }
      window.location.href = cur.toString();
    } catch(e) {
      console.warn('[DevTools] Base URL switch failed:', e);
    }
  }

  function getDefaultState() {
    const groups = Store.get('baseurl.groups', []);
    // Legacy migration: older versions stored one color per group + an
    // activeIdx + a regex matchPattern. Colors now live per-entry, and
    // "active" is derived from the current URL.
    let changed = false;
    groups.forEach(g => {
      (g.entries || []).forEach((e, i) => {
        if (!e.color) { e.color = g.color || BASEURL_COLORS[i % BASEURL_COLORS.length]; changed = true; }
      });
      if ('color' in g)        { delete g.color; changed = true; }
      if ('activeIdx' in g)    { delete g.activeIdx; changed = true; }
      if ('matchPattern' in g) { delete g.matchPattern; changed = true; }
    });
    if (changed) Store.set('baseurl.groups', groups);
    return {
      enabled: Store.get('baseurl.enabled', false),
      groups,
    };
  }

  const storageSyncHandlers = {
    'baseurl.enabled': () => { state.baseUrl.enabled = Store.get('baseurl.enabled', false); checkBaseUrlFab(); },
    'baseurl.groups':  () => {
      state.baseUrl.groups = Store.get('baseurl.groups', []);
      // Don't rebuild the panel underneath an actively-focused groups field —
      // the innerHTML swap would destroy the input the user is typing into
      // (dead keystrokes, just a blinking caret) whenever another tab saves.
      // The in-memory state is updated either way; input handlers look up
      // state.baseUrl.groups[gi] at event time, so edits keep landing in the
      // fresh array and the panel repaints on the next non-focused sync.
      const list = $('dt-baseurl-groups-list');
      const focused = $1 ? $1(':focus') : null;
      if (!(list && focused && list.contains(focused))) renderBaseUrlGroups();
      checkBaseUrlFab();
      ctx.notifyPluginsBaseUrlGroupsChanged(); // e.g. recorder targets/labels are derived from groups
    },
  };

  return {
    id: 'baseUrl',
    navLabel: 'Environments',
    navIcon: 'swap',
    buildPanel: buildBaseUrlPanel,
    initPanel: initBaseUrlPanel,
    getDefaultState,
    storageSyncHandlers,
  };
});
