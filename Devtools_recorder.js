// ==UserScript==
// @name         DevTools Sidebar — API Recorder Plugin
// @namespace    http://tampermonkey.net/
// @version      3.0.0
// @description  API Recorder plugin for DevTools Sidebar — passively documents endpoint shapes and exports/pushes them as a Postman collection.
// @author       MrNosferatu
// ==/UserScript==

// Registers a factory rather than running immediately — see Devtools_plugins.js.
// The main script calls this once with a ctx object once it's ready, and uses
// the returned plugin object to wire up the recorder's nav button, panel,
// settings persistence, and network capture hook.
DT_registerPlugin(function createRecorderPlugin(ctx) {
  const { Store, state, $, escHtml, schemaBlock, tip, icon, ALL_METHODS, METHOD_COLORS, getGroupHosts, getFetch } = ctx;

  // ─── API Recorder panel HTML ──────────────────────────────────────────────────
  function buildRecorderPanel() {
    return `
      <div class="dt-section">
        <div class="dt-slabel">API Recorder</div>
        <div class="dt-row-sub" style="margin-bottom:14px;color:var(--mu);font-size:11px">Passively watches matching requests in the background and auto-documents endpoints — methods, query params, headers, and body shapes (as data types, not real values). Nothing is blocked or modified.</div>
        <div class="dt-row" style="margin-bottom:10px">
          <div class="dt-row-label" style="display:flex;align-items:center;gap:5px">Record requests</div>
          <label class="dt-toggle"><input type="checkbox" id="dt-rec-enabled"><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
        </div>
        <div class="dt-row" id="dt-rec-persist-row" style="margin-bottom:0">
          <div class="dt-row-label" style="display:flex;align-items:center;gap:5px">Persist ${tip('Keep recording enabled across page reloads.')}</div>
          <label class="dt-toggle"><input type="checkbox" id="dt-rec-persist"><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
        </div>
      </div>

      <div class="dt-section">
        <div class="dt-slabel">Methods</div>
        <div class="dt-method-grid">${ALL_METHODS.map(m=>`<input type="checkbox" class="dt-method-check" id="dt-rec-m-${m}" data-m="${m}"><label class="dt-method-pill" for="dt-rec-m-${m}">${m}</label>`).join('')}</div>
      </div>

      <div class="dt-section">
        <div class="dt-slabel">Targets ${tip('Only requests matching an enabled target get recorded. Add a manual URL/host, or attach a Base URL Switcher group so every environment in it is tracked together.')}</div>
        <div id="dt-rec-targets-list"></div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="dt-pe-add-pattern" id="dt-rec-add-manual-target" style="flex:1;justify-content:center">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="5.5" y1="1" x2="5.5" y2="10"/><line x1="1" y1="5.5" x2="10" y2="5.5"/></svg>
            Add URL
          </button>
          <select class="dt-font-select" id="dt-rec-add-baseurl-target" style="flex:1;font-size:11px;padding:6px 24px 6px 8px">
            <option value="">+ From Base URL Group</option>
          </select>
        </div>
      </div>

      <div class="dt-section">
        <div class="dt-row" style="margin-bottom:0">
          <div class="dt-row-label" style="display:flex;align-items:center;gap:5px">Merge by Base URL ${tip('When a target is a Base URL group, combine recordings from all of its environments (prod/staging/etc) into one documented API instead of keeping each host separate.')}</div>
          <label class="dt-toggle"><input type="checkbox" id="dt-rec-merge"><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
        </div>
        <div class="dt-row" style="margin-top:10px;margin-bottom:0">
          <div class="dt-row-label" style="display:flex;align-items:center;gap:5px">Organize Postman export into folders ${tip('Groups endpoints into Postman folders by shared URL segments. A segment only becomes a folder when something is nested under it — e.g. /invoice/history stays flat, but /invoice/pay becomes a "Pay" folder once /invoice/pay/cancel exists too. Affects Export and Push to Postman; the in-app list below is always flat, just sorted by path.')}</div>
          <label class="dt-toggle"><input type="checkbox" id="dt-rec-organize-folders"><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
        </div>
      </div>

      <div class="dt-section" id="dt-rec-results-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div class="dt-slabel" style="margin-bottom:0">Recorded Endpoints</div>
          <button class="dt-bench-copy-btn" id="dt-rec-clear-all">Clear All</button>
        </div>
        <div id="dt-rec-results-list">
          <div class="dt-bench-capture-empty" id="dt-rec-results-empty">Enable recording, then browse target URLs — discovered endpoints will appear here.</div>
        </div>
      </div>
    `;
  }

  // ─── API Recorder ──────────────────────────────────────────────────────────
  // Passively documents endpoints hit while browsing: methods, query params,
  // headers, and request/response body SHAPES (data types, not real values).
  // Never blocks or edits traffic — purely observational, like bench capture.

  // Console breadcrumbs so a "why isn't this recording" question is answerable
  // without guesswork — each distinct reason is only logged once per session.
  const _recDebugLogged = new Set();
  function recDebugOnce(key, msg) {
    if (_recDebugLogged.has(key)) return;
    _recDebugLogged.add(key);
    console.debug(msg);
  }

  function shouldRecord(url, method) {
    if (!state.recorder.enabled) return false;
    if (!state.recorder.methods.includes((method||'GET').toUpperCase())) {
      recDebugOnce('method:'+method, `[DevTools] API Recorder: ${method} is enabled but not checked under Methods in the "API Docs" tab.`);
      return false;
    }
    if (!state.recorder.targets.length) {
      recDebugOnce('__no_targets__', '[DevTools] API Recorder is enabled but has no targets — add a URL or Base URL group in the "API Docs" tab.');
      return false;
    }
    const match = matchRecorderTarget(url);
    if (!match) {
      let host = ''; try { host = new URL(url, location.href).host; } catch {}
      if (host) recDebugOnce('host:'+host, `[DevTools] API Recorder: "${host}" doesn't match any enabled target — check for typos, or add it in the "API Docs" tab. (seen: ${url})`);
      return false;
    }
    return true;
  }

  function matchRecorderTarget(url) {
    let u; try { u = new URL(url, location.href); } catch { return null; }
    for (const t of state.recorder.targets) {
      if (!t.enabled) continue;
      if (t.type === 'manual') {
        if (!t.url) continue;
        try {
          const tu = new URL(t.url.includes('://') ? t.url : 'http://' + t.url);
          if (u.host === tu.host) return { target: t, host: u.host };
        } catch {
          if (url.includes(t.url)) return { target: t, host: u.host };
        }
      } else if (t.type === 'baseurl') {
        const group = state.baseUrl.groups.find(g => g.id === t.groupId);
        if (!group) continue;
        if (!getGroupHosts(group).has(u.host)) continue;
        if (group.apiPrefix && !u.pathname.startsWith(group.apiPrefix)) continue;
        return { target: t, host: u.host, group };
      }
    }
    return null;
  }

  function recorderBucketLabel(match) {
    if (match.target.type === 'baseurl') {
      const entry = (match.group?.entries || []).find(e => {
        try { const eu = new URL(e.url.includes('://') ? e.url : 'http://' + e.url); return eu.host === match.host; }
        catch { return false; }
      });
      return entry?.label ? `${match.group.label} · ${entry.label}` : (match.group?.label || match.host);
    }
    return match.target.label || match.host;
  }

  // Replace numeric / UUID / Mongo-ObjectId path segments with placeholders so
  // /users/42 and /users/91 fold into a single /users/:id endpoint.
  function normalizePath(pathname) {
    return (pathname || '/').split('/').map(seg => {
      if (!seg) return seg;
      if (/^\d+$/.test(seg)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':uuid';
      if (/^[0-9a-f]{24}$/i.test(seg)) return ':id';
      return seg;
    }).join('/');
  }

  function inferScalarType(s) {
    s = String(s);
    if (s === '') return 'string';
    if (/^-?\d+$/.test(s)) return 'integer';
    if (/^-?\d+\.\d+$/.test(s)) return 'number';
    if (/^(true|false)$/i.test(s)) return 'boolean';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return 'uuid';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return 'datetime';
    if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(s)) return 'jwt';
    return 'string';
  }
  function formatHeaderValue(v) { return /^Bearer\s/.test(v) ? v : `<${v}>`; }
  // Some APIs serialize array params as id[0]=1&id[1]=2 instead of id[]=1&id[]=2 —
  // fold the numeric index away so they document as a single "id[]" key instead
  // of registering a separate (and ever-growing) key per index.
  function normalizeQueryKey(k) { return k.replace(/\[\d+\]/g, '[]'); }
  // Sites that mask their real backend route behind a BFF/proxy sometimes echo
  // the true upstream path as a "backend_path" field in the JSON response BODY
  // (not a header) — pull it out case-insensitively, whitelisted off the
  // documented response schema below so it never shows up as a regular field.
  const BACKEND_PATH_KEY = 'backend_path';
  function extractBackendPath(bodyObj) {
    if (!bodyObj || typeof bodyObj !== 'object' || Array.isArray(bodyObj)) return undefined;
    const key = Object.keys(bodyObj).find(k => k.toLowerCase() === BACKEND_PATH_KEY);
    return key ? bodyObj[key] : undefined;
  }
  // The backend_path value is typically the full absolute URL the proxy/BFF
  // forwarded to (scheme + host + port included) — strip all of that down to
  // just the path so it composes with {baseUrl}/{{baseUrl}} the same way the
  // observed path does, and fold dynamic segments the same way too.
  function sanitizeBackendPath(raw) {
    let pathname = raw;
    try { pathname = new URL(raw).pathname; } catch { /* already just a path */ }
    return normalizePath(pathname);
  }

  // Build a typed "schema" from a real JSON value — leaves are type names, not values.
  function schemaFromValue(v, depth) {
    depth = depth || 0;
    if (v === null) return 'null';
    if (depth > 6) return Array.isArray(v) ? 'array' : typeof v;
    if (Array.isArray(v)) { if (!v.length) return []; return [schemaFromValue(v[0], depth + 1)]; }
    if (typeof v === 'object') { const out = {}; Object.keys(v).forEach(k => { out[k] = schemaFromValue(v[k], depth + 1); }); return out; }
    return typeof v;
  }
  function stripOptMark(k) { return k.endsWith('?') ? k.slice(0, -1) : k; }

  // Merge two schemas seen across samples of the same endpoint (or across hosts,
  // when combining base-URL-group environments). Optionality is tracked on the
  // KEY itself ("email?") rather than on the value/type — that way it works
  // uniformly for scalar fields AND nested objects/arrays, and a key already
  // marked optional from an earlier merge stays optional even if it's present
  // in this sample (it's been proven inconsistent at least once, which is what
  // "optional" means here). Value/type variance (e.g. a field that's sometimes
  // a string and sometimes a number) is unioned separately as "string|number"
  // and never conflated with the "?" presence marker.
  function mergeSchema(a, b) {
    if (a === undefined) return b;
    if (b === undefined) return a;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (!a.length) return b; if (!b.length) return a;
      return [mergeSchema(a[0], b[0])];
    }
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const aMap = new Map(Object.keys(a).map(k => [stripOptMark(k), k]));
      const bMap = new Map(Object.keys(b).map(k => [stripOptMark(k), k]));
      const out = {};
      new Set([...aMap.keys(), ...bMap.keys()]).forEach(norm => {
        const inA = aMap.has(norm), inB = bMap.has(norm);
        const wasOptional = (inA && aMap.get(norm).endsWith('?')) || (inB && bMap.get(norm).endsWith('?'));
        const optional = !inA || !inB || wasOptional;
        const outKey = norm + (optional ? '?' : '');
        if (inA && inB) out[outKey] = mergeSchema(a[aMap.get(norm)], b[bMap.get(norm)]);
        else out[outKey] = inA ? a[aMap.get(norm)] : b[bMap.get(norm)];
      });
      return out;
    }
    if (a === b) return a;
    const sa = typeof a === 'string' ? a : JSON.stringify(a);
    const sb = typeof b === 'string' ? b : JSON.stringify(b);
    if (sa === sb) return a;
    return [...new Set([...sa.split('|'), ...sb.split('|')])].join('|');
  }

  // statusText/duration aren't used by the Recorder (it only cares about typed
  // shapes, not timing), but the capture hook signature is shared across
  // plugins — see the generic dispatch in Devtools.js's fetch/XHR patches.
  function recorderCapture(url, method, reqHeaders, reqBody, status, statusText, resHeaders, resBody, duration) {
    if (!state.recorder.enabled) return;
    method = (method || 'GET').toUpperCase();
    if (!state.recorder.methods.includes(method)) return;
    const match = matchRecorderTarget(url);
    if (!match) return;
    let u; try { u = new URL(url, location.href); } catch { return; }
    const path = normalizePath(u.pathname);
    const bucketKey = `host:${match.host}`;
    if (!state.recorder.data[bucketKey]) {
      state.recorder.data[bucketKey] = {
        host: match.host,
        groupId: match.target.type === 'baseurl' ? match.target.groupId : null,
        label: recorderBucketLabel(match),
        endpoints: {},
      };
    }
    const bucket = state.recorder.data[bucketKey];
    bucket.label = recorderBucketLabel(match);
    const ek = method + ' ' + path;
    if (!bucket.endpoints[ek]) {
      bucket.endpoints[ek] = {
        method, path, count: 0, firstSeen: Date.now(), lastSeen: Date.now(),
        query: undefined, headers: undefined, requestBodySchema: undefined,
        responseStatuses: {}, responseBodySchema: undefined, backendPath: undefined,
      };
    }
    const ep = bucket.endpoints[ek];
    ep.count++; ep.lastSeen = Date.now();

    // Query params -> types, merged against prior samples so a param that's
    // missing from THIS request (but present in earlier ones, or vice versa)
    // gets marked optional rather than silently overwritten.
    const querySample = {};
    u.searchParams.forEach((v, k) => { querySample[normalizeQueryKey(k)] = inferScalarType(v); });
    ep.query = ep.query === undefined ? querySample : mergeSchema(ep.query, querySample);

    const SKIP_HEADERS = new Set(['content-length','connection','host','cookie']);
    const headerSample = {};
    Object.entries(reqHeaders || {}).forEach(([k, v]) => {
      if (SKIP_HEADERS.has(k.toLowerCase())) return;
      headerSample[k] = /^Bearer\s+/i.test(String(v)) ? 'Bearer <token>' : inferScalarType(String(v));
    });
    ep.headers = ep.headers === undefined ? headerSample : mergeSchema(ep.headers, headerSample);

    if (reqBody) {
      let parsed; try { parsed = JSON.parse(reqBody); } catch { parsed = null; }
      const schema = parsed !== null ? schemaFromValue(parsed) : { _raw: 'string' };
      ep.requestBodySchema = ep.requestBodySchema === undefined ? schema : mergeSchema(ep.requestBodySchema, schema);
    }

    ep.responseStatuses[status] = (ep.responseStatuses[status] || 0) + 1;
    if (resBody) {
      let parsed; try { parsed = JSON.parse(resBody); } catch { parsed = null; }
      if (parsed !== null) {
        // Niche escape hatch for sites that mask their real backend route behind
        // a BFF/proxy: if the page echoes the true upstream path as a
        // "backend_path" field in the response body, prefer that over the
        // observed (masked) path for exports — but whitelist it off the
        // documented schema so it's used internally only, never shown as a
        // regular response field in the docs UI.
        const rawBackendPath = extractBackendPath(parsed);
        let docBody = parsed;
        if (rawBackendPath !== undefined) {
          ep.backendPath = sanitizeBackendPath(rawBackendPath);
          docBody = Object.fromEntries(Object.entries(parsed).filter(([k]) => k.toLowerCase() !== BACKEND_PATH_KEY));
        }
        const schema = schemaFromValue(docBody);
        ep.responseBodySchema = ep.responseBodySchema === undefined ? schema : mergeSchema(ep.responseBodySchema, schema);
      }
    }

    scheduleStoreRecorderData();
    scheduleRenderRecorderList();
  }

  // Same rationale as the render debounce below, but for persistence: rec.data
  // can grow large, and re-serializing the whole blob into GM storage on EVERY
  // matched request is expensive on chatty sites. A trailing 600ms debounce
  // still persists promptly without hammering storage.
  let _storeDataTimer = null;
  function scheduleStoreRecorderData() {
    clearTimeout(_storeDataTimer);
    _storeDataTimer = setTimeout(() => { _storeDataTimer = null; Store.set('rec.data', state.recorder.data); }, 600);
  }

  // Capture fires once per matched network request — on an active site (or
  // one with Cloudflare-style background heartbeats) that's often multiple
  // times a second. renderRecorderList() fully tears down and rebuilds every
  // bucket's DOM (and force-closes the kebab menu) on each call, so calling
  // it straight from recorderCapture made the kebab menu get nuked out from
  // under the user before they could click anything in it. Debounce instead
  // of rendering on every single capture.
  let _renderListTimer = null;
  function scheduleRenderRecorderList() {
    if (_renderListTimer) return;
    _renderListTimer = setTimeout(() => { _renderListTimer = null; renderRecorderList(); }, 400);
  }

  // ── Display grouping (always reads raw per-host data; merges live if enabled) ──
  function cloneEndpoint(ep) { return JSON.parse(JSON.stringify(ep)); }
  function mergeEndpoint(a, b) {
    const statuses = { ...a.responseStatuses };
    Object.entries(b.responseStatuses || {}).forEach(([s, c]) => { statuses[s] = (statuses[s] || 0) + c; });
    return {
      method: a.method, path: a.path,
      count: a.count + b.count,
      firstSeen: Math.min(a.firstSeen, b.firstSeen), lastSeen: Math.max(a.lastSeen, b.lastSeen),
      query: mergeSchema(a.query, b.query),
      headers: mergeSchema(a.headers, b.headers),
      requestBodySchema: mergeSchema(a.requestBodySchema, b.requestBodySchema),
      responseBodySchema: mergeSchema(a.responseBodySchema, b.responseBodySchema),
      responseStatuses: statuses,
      backendPath: a.backendPath || b.backendPath,
    };
  }
  // ── Request-interceptor cross-check ───────────────────────────────────────
  // Looks up whatever has ALREADY been documented for this exact endpoint,
  // independent of whether recording is currently enabled or this host is a
  // configured target — it's a read of existing docs, not a capture decision.
  // Also pulls in sibling buckets from the same Base URL group, so docs
  // recorded on staging still help while you're intercepting a prod request.
  function findDocumentedEndpoint(url, method) {
    let u; try { u = new URL(url, location.href); } catch { return null; }
    const host = u.host;
    const ek = (method || 'GET').toUpperCase() + ' ' + normalizePath(u.pathname);
    const directBucket = state.recorder.data[`host:${host}`];
    let groupId = directBucket ? directBucket.groupId : null;
    if (groupId == null) {
      const group = state.baseUrl.groups.find(g => getGroupHosts(g).has(host));
      if (group) groupId = group.id;
    }
    let ep = null;
    Object.values(state.recorder.data).forEach(bucket => {
      if (bucket !== directBucket && (groupId == null || bucket.groupId !== groupId)) return;
      const candidate = bucket.endpoints[ek];
      if (!candidate) return;
      ep = ep ? mergeEndpoint(ep, candidate) : cloneEndpoint(candidate);
    });
    if (!ep) {
      recDebugOnce('docs-miss:' + ek, `[DevTools] API Docs cross-check: no documented endpoint for "${ek}" on host "${host}" (looked in bucket "host:${host}"${groupId != null ? ` and group "${groupId}"` : ''}). Buckets in state.recorder.data: ${Object.keys(state.recorder.data).join(', ') || '(none)'}.`);
    } else {
      console.debug(`[DevTools] API Docs cross-check: matched "${ek}" — query keys: [${Object.keys(ep.query || {}).join(', ')}], body keys: [${Object.keys(ep.requestBodySchema || {}).join(', ')}]`);
    }
    return ep;
  }

  // Recursively turns a schema (type names / nested shape) into a real,
  // editable JSON value — used to pre-fill a documented field the user just
  // clicked "add" on, so they land on something sensible to start typing over.
  function defaultValueForSchema(schema) {
    if (schema === 'null') return null;
    if (Array.isArray(schema)) return schema.length ? [defaultValueForSchema(schema[0])] : [];
    if (schema && typeof schema === 'object') {
      const out = {};
      Object.entries(schema).forEach(([k, v]) => { out[stripOptMark(k)] = defaultValueForSchema(v); });
      return out;
    }
    const t = String(schema).split('|')[0];
    if (t === 'integer' || t === 'number') return 0;
    if (t === 'boolean') return false;
    if (t === 'null') return null;
    return ''; // string, uuid, datetime, jwt, etc.
  }
  // Query params are always plain URL strings, so give them a lighter,
  // string-flavored default instead of defaultValueForSchema's real JS types.
  function defaultQueryValue(type) {
    const t = String(type).split('|')[0];
    if (t === 'integer' || t === 'number') return '0';
    if (t === 'boolean') return 'false';
    return '';
  }

  // Public API used by the request interceptor (Devtools.js) to cross-check a
  // pending request's payload against whatever's already documented for that
  // endpoint. Returns null if nothing's been recorded for it yet.
  function getRequestSuggestions(url, method) {
    const ep = findDocumentedEndpoint(url, method);
    if (!ep) return null;
    const toQueryFields = (schema) => Object.keys(schema || {}).map(k => ({ key: stripOptMark(k), value: defaultQueryValue(schema[k]) }));
    const toBodyFields = (schema) => Object.keys(schema || {}).map(k => ({ key: stripOptMark(k), value: defaultValueForSchema(schema[k]) }));
    return { query: toQueryFields(ep.query), body: toBodyFields(ep.requestBodySchema) };
  }

  // Looks up a bucket's display label fresh from the CURRENT Base URL group
  // data every time, rather than trusting whatever was cached on the bucket at
  // capture time — so renaming a group (here or in another tab) shows up on the
  // next render, with no need to wait for a new request to come in.
  function liveBucketLabel(rawBucket, includeEntry) {
    if (rawBucket.groupId) {
      const group = state.baseUrl.groups.find(g => g.id === rawBucket.groupId);
      if (group) {
        if (!includeEntry) return group.label;
        const entry = (group.entries || []).find(e => {
          try { const eu = new URL(e.url.includes('://') ? e.url : 'http://' + e.url); return eu.host === rawBucket.host; }
          catch { return false; }
        });
        return entry?.label ? `${group.label} · ${entry.label}` : group.label;
      }
    }
    return rawBucket.label || rawBucket.host; // manual target, or group was since deleted
  }

  function getDisplayBuckets() {
    const raw = state.recorder.data, out = {};
    if (!state.recorder.mergeByBaseUrl) {
      Object.entries(raw).forEach(([key, b]) => { out[key] = { key, label: liveBucketLabel(b, true), endpoints: b.endpoints }; });
      return Object.values(out);
    }
    Object.entries(raw).forEach(([key, b]) => {
      const mkey = b.groupId ? `group:${b.groupId}` : key;
      if (!out[mkey]) {
        out[mkey] = { key: mkey, label: liveBucketLabel(b, false), endpoints: {} };
      }
      Object.entries(b.endpoints).forEach(([ek, ep]) => {
        out[mkey].endpoints[ek] = out[mkey].endpoints[ek] ? mergeEndpoint(out[mkey].endpoints[ek], ep) : cloneEndpoint(ep);
      });
    });
    return Object.values(out);
  }

  // ── Typed cURL / Postman collection export ──────────────────────────────────
  function schemaToTypedJSON(schema) {
    function walk(v) {
      if (typeof v === 'string') return `<${v}>`;
      if (Array.isArray(v)) return v.length ? [walk(v[0])] : [];
      if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach(k => o[k] = walk(v[k])); return o; }
      return v;
    }
    return JSON.stringify(walk(schema), null, 2);
  }
  function buildTypedCurl(ep) {
    let url = '{baseUrl}' + (ep.backendPath || ep.path);
    const q = Object.entries(ep.query || {});
    if (q.length) url += '?' + q.map(([k,v]) => `${stripOptMark(k)}=<${v}>`).join('&');
    let curl = `curl -X ${ep.method} '${url}'`;
    Object.entries(ep.headers || {}).forEach(([k,v]) => { curl += ` \\\n  -H '${stripOptMark(k)}: ${formatHeaderValue(v)}'`; });
    if (ep.requestBodySchema !== undefined && ep.method !== 'GET') {
      const bodyStr = schemaToTypedJSON(ep.requestBodySchema).replace(/'/g, "'\"'\"'");
      curl += ` \\\n  -d '${bodyStr}'`;
    }
    return curl;
  }
  // Sort endpoints the way file paths naturally sort — by segment, not by hit
  // count — so related routes (/invoice, /invoice/history, /invoice/pay, ...)
  // end up next to each other instead of scattered by popularity. Plain string
  // comparison already does this correctly: a path that's a prefix of another
  // sorts immediately before it (e.g. "/invoice" < "/invoice/history").
  const METHOD_ORDER = { GET:0, POST:1, PUT:2, PATCH:3, DELETE:4 };
  function comparePathSegments(a, b) {
    const c = a.path.localeCompare(b.path);
    if (c !== 0) return c;
    return (METHOD_ORDER[a.method] ?? 9) - (METHOD_ORDER[b.method] ?? 9);
  }

  function buildPostmanRequestItem(ep) {
    const headerArr = Object.entries(ep.headers || {}).map(([k,v]) => ({ key: stripOptMark(k), value: formatHeaderValue(v), disabled: k.endsWith('?') }));
    const queryArr  = Object.entries(ep.query || {}).map(([k,v]) => ({ key: stripOptMark(k), value: `<${v}>`, disabled: k.endsWith('?') }));
    // Prefer the true backend path (if the page exposed one via a
    // "backend_path" field in the response body) over the possibly-masked observed path.
    const exportPath = ep.backendPath || ep.path;
    const item = {
      name: `${ep.method} ${ep.path}`,
      request: {
        method: ep.method,
        header: headerArr,
        url: {
          raw: '{{baseUrl}}' + exportPath + (queryArr.some(q=>!q.disabled) ? '?' + queryArr.filter(q=>!q.disabled).map(q=>`${q.key}=${q.value}`).join('&') : ''),
          host: ['{{baseUrl}}'],
          path: exportPath.split('/').filter(Boolean),
          query: queryArr,
        },
      },
      response: [],
    };
    if (ep.requestBodySchema !== undefined && ep.method !== 'GET') {
      item.request.body = { mode:'raw', raw: schemaToTypedJSON(ep.requestBodySchema), options:{ raw:{ language:'json' } } };
      if (!headerArr.some(h => h.key.toLowerCase()==='content-type')) item.request.header.push({ key:'Content-Type', value:'application/json' });
    }
    if (ep.responseBodySchema !== undefined) {
      const status = Object.keys(ep.responseStatuses)[0] || '200';
      item.response.push({
        name: `Sample (typed schema) — ${status}`,
        originalRequest: item.request,
        status: 'Recorded',
        code: parseInt(status) || 200,
        _postman_previewlanguage: 'json',
        header: [{ key:'Content-Type', value:'application/json' }],
        body: schemaToTypedJSON(ep.responseBodySchema),
      });
    }
    return item;
  }

  // Build a tree from URL path segments — e.g. /invoice, /invoice/history,
  // /invoice/pay, /invoice/pay/cancel becomes:
  //   invoice → { endpoints:[/invoice], children: { history → {…}, pay → {…} } }
  function buildPathTree(endpoints) {
    const root = { children: new Map(), endpoints: [] };
    endpoints.forEach(ep => {
      let node = root;
      // Group by the same path that'll actually be exported (backendPath, if
      // present) — otherwise folders would be built from the masked path while
      // the items inside them point at a completely different real route.
      (ep.backendPath || ep.path).split('/').filter(Boolean).forEach(seg => {
        if (!node.children.has(seg)) node.children.set(seg, { children: new Map(), endpoints: [] });
        node = node.children.get(seg);
      });
      node.endpoints.push(ep);
    });
    return root;
  }
  function titleizeSegment(seg) {
    if (seg.startsWith(':')) return '{' + seg.slice(1) + '}'; // e.g. ":id" -> "{id}"
    return seg.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  // A segment only becomes its own Postman folder when it has children beyond
  // itself (matches the example: "history" stays a flat item since nothing's
  // nested under it, but "pay" becomes a folder because "pay/cancel" exists).
  function pathTreeToPostmanItems(node) {
    const items = [];
    [...node.endpoints].sort(comparePathSegments).forEach(ep => items.push(buildPostmanRequestItem(ep)));
    [...node.children.keys()].sort((a,b) => a.localeCompare(b)).forEach(seg => {
      const child = node.children.get(seg);
      if (child.children.size > 0) {
        items.push({ name: titleizeSegment(seg), item: pathTreeToPostmanItems(child) });
      } else {
        items.push(...pathTreeToPostmanItems(child)); // leaf — contributes flat item(s), no wrapper folder
      }
    });
    return items;
  }

  function buildPostmanCollection(bucket) {
    const endpoints = Object.values(bucket.endpoints);
    const items = state.recorder.organizeFolders
      ? pathTreeToPostmanItems(buildPathTree(endpoints))
      : [...endpoints].sort(comparePathSegments).map(buildPostmanRequestItem);
    return {
      info: {
        name: bucket.label || 'Recorded API',
        description: 'Auto-generated by DevTools Sidebar — API Recorder. Field values show data TYPES, not real captured data.',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: items,
      variable: [{ key:'baseUrl', value:'', type:'string' }],
    };
  }
  function downloadJSON(obj, filename) {
    try {
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type:'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch(e) { console.warn('[DevTools] Export failed:', e); }
  }
  function sanitizeFilename(s) { return (String(s||'collection').replace(/[^a-z0-9_-]+/gi,'_').slice(0,60)) || 'collection'; }
  function cssEscape(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_'); }

  // Push directly to Postman via their REST API (requires a personal API key).
  // Uses the captured native fetch (via getFetch()) so this call itself is never recorded/intercepted.
  async function pushToPostman(bucket) {
    const apiKey = (state.recorder.postmanApiKey || '').trim();
    if (!apiKey) throw new Error('No Postman API key set. Add one under "Postman Integration" above.');
    const nativeFetch = getFetch();
    if (!nativeFetch) throw new Error('Network bridge not ready yet — try again in a moment.');
    const collection = buildPostmanCollection(bucket);
    const existingId = state.recorder.postmanCollectionIds[bucket.key];
    const url = existingId ? `https://api.getpostman.com/collections/${existingId}` : `https://api.getpostman.com/collections`;
    const res = await nativeFetch(url, {
      method: existingId ? 'PUT' : 'POST',
      headers: { 'Content-Type':'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ collection }),
    });
    if (!res.ok) {
      let msg = ''; try { msg = (await res.json()).error?.message || ''; } catch {}
      throw new Error(`Postman API ${res.status}${msg ? ': ' + msg : ''}`);
    }
    const data = await res.json();
    const id = data.collection?.uid || data.collection?.id;
    if (id) {
      state.recorder.postmanCollectionIds[bucket.key] = id;
      Store.set('rec.postmanCollectionIds', state.recorder.postmanCollectionIds);
    }
  }

  // ── UI: targets ──────────────────────────────────────────────────────────────
  function populateBaseUrlTargetSelect() {
    const sel = $('dt-rec-add-baseurl-target');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">+ From Base URL Group</option>` +
      state.baseUrl.groups.map(g => `<option value="${g.id}">${escHtml(g.label)}</option>`).join('');
    sel.value = state.baseUrl.groups.some(g => String(g.id)===cur) ? cur : '';
  }

  function renderRecorderTargets() {
    const list = $('dt-rec-targets-list');
    if (!list) return;
    list.innerHTML = '';
    if (!state.recorder.targets.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:11px;color:var(--mu);font-style:italic;padding:4px 2px';
      empty.textContent = 'No targets yet — add a URL or attach a Base URL group above.';
      list.appendChild(empty);
    }
    state.recorder.targets.forEach((t, ti) => {
      const row = document.createElement('div');
      row.className = 'dt-rec-target-row';
      if (t.type === 'manual') {
        row.innerHTML = `
          <span class="dt-rec-target-type manual">URL</span>
          <input class="dt-baseurl-entry-url" placeholder="api.example.com or https://api.example.com" value="${escHtml(t.url||'')}" spellcheck="false" autocomplete="off">
          <label class="dt-toggle dt-rec-target-toggle"><input type="checkbox" ${t.enabled?'checked':''}><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
          <button class="dt-baseurl-entry-del" title="Remove">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.7"><line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/></svg>
          </button>
        `;
        row.querySelector('.dt-baseurl-entry-url').addEventListener('input', e => {
          state.recorder.targets[ti].url = e.target.value;
          Store.setSoon('rec.targets', state.recorder.targets);
        });
        row.querySelector('input[type=checkbox]').addEventListener('change', e => {
          state.recorder.targets[ti].enabled = e.target.checked;
          Store.set('rec.targets', state.recorder.targets);
        });
        row.querySelector('.dt-baseurl-entry-del').addEventListener('click', () => {
          state.recorder.targets.splice(ti,1);
          Store.set('rec.targets', state.recorder.targets);
          renderRecorderTargets();
        });
      } else {
        const group = state.baseUrl.groups.find(g => g.id === t.groupId);
        row.innerHTML = `
          <span class="dt-rec-target-type baseurl">GROUP</span>
          <span class="dt-rec-target-label">${escHtml(group ? group.label : '(deleted group)')}</span>
          <label class="dt-toggle dt-rec-target-toggle"><input type="checkbox" ${t.enabled?'checked':''}><div class="dt-toggle-track"><div class="dt-toggle-thumb"></div></div></label>
          <button class="dt-baseurl-entry-del" title="Remove">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.7"><line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/></svg>
          </button>
        `;
        row.querySelector('input[type=checkbox]').addEventListener('change', e => {
          state.recorder.targets[ti].enabled = e.target.checked;
          Store.set('rec.targets', state.recorder.targets);
        });
        row.querySelector('.dt-baseurl-entry-del').addEventListener('click', () => {
          state.recorder.targets.splice(ti,1);
          Store.set('rec.targets', state.recorder.targets);
          renderRecorderTargets();
        });
      }
      list.appendChild(row);
    });
  }

  // ── UI: recorded results ────────────────────────────────────────────────────
  function renderRecorderList() {
    const list = $('dt-rec-results-list');
    const emptyMsg = $('dt-rec-results-empty');
    if (!list) return;
    // A background capture can land mid-interaction and trigger a re-render
    // while the kebab menu is open — remember which bucket it belonged to so
    // it can be reopened against the freshly-rendered button instead of just
    // vanishing out from under the user.
    const reopenKebabFor = document.getElementById('dt-rec-kebab-portal')?.classList.contains('open')
      ? document.getElementById('dt-rec-kebab-portal')._bucketKey : null;
    closeKebabMenu();
    [...list.querySelectorAll('.dt-rec-bucket')].forEach(el => el.remove());
    const buckets = getDisplayBuckets().sort((a,b) => Object.keys(b.endpoints).length - Object.keys(a.endpoints).length);
    if (!buckets.length) { if (emptyMsg) emptyMsg.style.display = ''; return; }
    if (emptyMsg) emptyMsg.style.display = 'none';
    buckets.forEach(bucket => {
      const epCount = Object.keys(bucket.endpoints).length;
      const el = document.createElement('div');
      el.className = 'dt-rec-bucket';
      el.innerHTML = `
        <div class="dt-rec-bucket-head">
          <span class="dt-rec-bucket-arrow">${icon('chevronRight',11,2.4)}</span>
          <span class="dt-rec-bucket-label">${escHtml(bucket.label)}</span>
          <span class="dt-rec-bucket-count">${epCount} endpoint${epCount!==1?'s':''}</span>
          <button class="dt-rec-kebab-btn" data-act="kebab" title="Actions">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
          </button>
        </div>
        <div class="dt-rec-bucket-body" id="dt-rec-bucket-body-${cssEscape(bucket.key)}"></div>
      `;
      const head = el.querySelector('.dt-rec-bucket-head');
      const body = el.querySelector('.dt-rec-bucket-body');
      head.addEventListener('click', e => {
        if (e.target.closest('.dt-rec-kebab-btn')) return;
        el.classList.toggle('open');
        if (el.classList.contains('open') && !body._rendered) { renderEndpointsInto(body, bucket); body._rendered = true; }
      });
      const kebabBtn = el.querySelector('[data-act="kebab"]');
      kebabBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleKebabMenu(e.currentTarget, bucket);
      });
      if (reopenKebabFor && bucket.key === reopenKebabFor) toggleKebabMenu(kebabBtn, bucket);
      list.appendChild(el);
    });
  }

  // Single shared dropdown "portal", appended directly to <body>. Bucket cards
  // use overflow:hidden to clip their rounded corners, which would otherwise
  // clip a normally-nested dropdown — rendering it outside the sidebar's DOM
  // entirely sidesteps that, and positioning it via getBoundingClientRect()
  // keeps it visually anchored under whichever kebab button was clicked.
  function getKebabMenuEl() {
    let menu = document.getElementById('dt-rec-kebab-portal');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'dt-rec-kebab-portal';
      menu.className = 'dt-rec-kebab-menu';
      document.body.appendChild(menu);
    }
    return menu;
  }
  function closeKebabMenu() {
    const menu = document.getElementById('dt-rec-kebab-portal');
    if (menu) { menu.classList.remove('open'); menu.innerHTML = ''; menu._bucketKey = null; }
  }
  function toggleKebabMenu(anchorBtn, bucket) {
    const menu = getKebabMenuEl();
    const wasOpenForThisBucket = menu.classList.contains('open') && menu._bucketKey === bucket.key;
    closeKebabMenu();
    if (wasOpenForThisBucket) return; // clicking the same kebab again just closes it

    // The portal lives on <body>, outside the sidebar, so it doesn't inherit
    // the sidebar's .dt-dark class or custom-appearance inline CSS vars —
    // without this mirror it always rendered with the light theme.
    const sb = document.getElementById('dt-sidebar');
    if (sb) {
      menu.classList.toggle('dt-dark', sb.classList.contains('dt-dark'));
      ['--bg','--sf','--sf2','--tx','--tx2','--bd','--bd2','--mu'].forEach(v => {
        const val = sb.style.getPropertyValue(v);
        if (val) menu.style.setProperty(v, val); else menu.style.removeProperty(v);
      });
    }

    const hasKey = !!(state.recorder.postmanApiKey || '').trim();
    menu.innerHTML = `
      <button class="dt-rec-kebab-item" data-act="export">Export .json</button>
      <button class="dt-rec-kebab-item postman" data-act="postman"${hasKey ? '' : ' disabled'} title="${hasKey ? '' : 'Add a Postman API key in Settings (gear icon, top right) to enable this'}">Push to Postman</button>
      <button class="dt-rec-kebab-item danger" data-act="clear">Clear</button>
    `;
    const rect = anchorBtn.getBoundingClientRect();
    menu.style.top = Math.round(rect.bottom + 4) + 'px';
    menu.style.right = Math.round(window.innerWidth - rect.right) + 'px';
    menu.style.left = 'auto';
    menu.classList.add('open');
    menu._bucketKey = bucket.key;

    menu.querySelector('[data-act="export"]').addEventListener('click', e => {
      e.stopPropagation();
      closeKebabMenu();
      downloadJSON(buildPostmanCollection(bucket), sanitizeFilename(bucket.label) + '.postman_collection.json');
    });
    const postmanItem = menu.querySelector('[data-act="postman"]');
    postmanItem.addEventListener('click', async e => {
      e.stopPropagation();
      if (postmanItem.disabled) return;
      postmanItem.textContent = 'Pushing…'; postmanItem.disabled = true;
      try { await pushToPostman(bucket); postmanItem.textContent = 'Pushed ✓'; }
      catch (err) {
        console.warn('[DevTools] Postman push failed:', err);
        postmanItem.textContent = 'Failed — exported instead';
        downloadJSON(buildPostmanCollection(bucket), sanitizeFilename(bucket.label) + '.postman_collection.json');
      }
      setTimeout(closeKebabMenu, 1400);
    });
    menu.querySelector('[data-act="clear"]').addEventListener('click', e => {
      e.stopPropagation();
      closeKebabMenu();
      if (!confirm(`Clear recorded endpoints for "${bucket.label}"?`)) return;
      Object.keys(state.recorder.data).forEach(k => {
        const b = state.recorder.data[k];
        const mkey = state.recorder.mergeByBaseUrl && b.groupId ? `group:${b.groupId}` : k;
        if (mkey === bucket.key) delete state.recorder.data[k];
      });
      Store.set('rec.data', state.recorder.data);
      renderRecorderList();
    });
  }

  function renderEndpointsInto(container, bucket) {
    container.innerHTML = '';
    Object.values(bucket.endpoints).sort(comparePathSegments).forEach(ep => {
      const row = document.createElement('div');
      row.className = 'dt-rec-endpoint';
      const color = METHOD_COLORS[ep.method] || '#555';
      row.innerHTML = `
        <div class="dt-rec-endpoint-head">
          <span class="dt-rec-endpoint-method" style="background:${color}">${ep.method}</span>
          <span class="dt-rec-endpoint-path">${escHtml(ep.path)}</span>
          <span class="dt-rec-endpoint-count">×${ep.count}</span>
        </div>
        <div class="dt-rec-endpoint-body"></div>
      `;
      const head = row.querySelector('.dt-rec-endpoint-head');
      const body = row.querySelector('.dt-rec-endpoint-body');
      head.addEventListener('click', () => {
        row.classList.toggle('open');
        if (row.classList.contains('open') && !body._rendered) { renderEndpointDetail(body, ep); body._rendered = true; }
      });
      container.appendChild(row);
    });
  }

  // Renders a schema key, stripping the internal "?" presence-marker and
  // showing it instead as a small amber superscript with an explanatory tooltip.
  function renderKeyLabel(rawKey, quoted) {
    const optional = rawKey.endsWith('?');
    const name = stripOptMark(rawKey);
    const nameHtml = quoted ? `&quot;${escHtml(name)}&quot;` : escHtml(name);
    const opt = optional ? `<span class="t-opt" title="Optional — missing from at least one recorded request">?</span>` : '';
    return `<span class="t-key">${nameHtml}</span>${opt}`;
  }
  function formatTypeMap(map) {
    if (!map) return '—';
    const entries = Object.entries(map);
    if (!entries.length) return '—';
    return entries.map(([k,v]) => `${renderKeyLabel(k, false)}: <span class="t-type">${escHtml(v)}</span>`).join('\n');
  }
  function formatSchemaJSON(schema) {
    function walk(v, indent) {
      const pad = '  '.repeat(indent);
      if (typeof v === 'string') return `<span class="t-type">${escHtml(v)}</span>`;
      if (Array.isArray(v)) { if (!v.length) return '[]'; return `[\n${pad}  ${walk(v[0], indent+1)}\n${pad}]`; }
      if (v && typeof v === 'object') {
        const keys = Object.keys(v);
        if (!keys.length) return '{}';
        const bodyStr = keys.map(k => `${pad}  ${renderKeyLabel(k, true)}: ${walk(v[k], indent+1)}`).join(',\n');
        return `{\n${bodyStr}\n${pad}}`;
      }
      return escHtml(String(v));
    }
    return walk(schema, 0);
  }

  function renderEndpointDetail(container, ep) {
    const statusList = Object.entries(ep.responseStatuses).map(([s,c]) => `${s} ×${c}`).join(', ') || '—';
    let html = '';
    if (ep.query && Object.keys(ep.query).length) html += schemaBlock('Query Params', formatTypeMap(ep.query));
    if (ep.headers && Object.keys(ep.headers).length) html += schemaBlock('Headers', formatTypeMap(ep.headers));
    if (ep.requestBodySchema !== undefined) html += schemaBlock('Request Body Schema', formatSchemaJSON(ep.requestBodySchema));
    html += `<div class="dt-rec-schema-block"><div class="dt-rec-schema-label">Response</div><div class="dt-rec-status-line">Status seen: ${escHtml(statusList)}</div>${ep.responseBodySchema!==undefined ? `<div class="dt-rec-schema-pre">${formatSchemaJSON(ep.responseBodySchema)}</div>` : ''}</div>`;
    html += `<div class="dt-rec-endpoint-actions"><button class="dt-bench-copy-btn dt-rec-copy-curl">Copy as cURL</button></div>`;
    container.innerHTML = html;
    container.querySelector('.dt-rec-copy-curl').addEventListener('click', e => {
      const curl = buildTypedCurl(ep);
      navigator.clipboard.writeText(curl).then(() => {
        const btn = e.currentTarget, orig = btn.textContent;
        btn.textContent = 'Copied! ✓'; setTimeout(() => btn.textContent = orig, 1800);
      });
    });
  }

  // ── Init / bind ──────────────────────────────────────────────────────────────
  function syncRecorderPanel() {
    const re = $('dt-rec-enabled'); if (re) re.checked = state.recorder.enabled;
    const rp = $('dt-rec-persist'); if (rp) rp.checked = state.recorder.persist;
    const prow = $('dt-rec-persist-row'); if (prow) prow.classList.toggle('dt-row-disabled', !state.recorder.enabled);
  }

  function initRecorderPanel() {
    const enabledChk = $('dt-rec-enabled');
    if (!enabledChk) return;
    enabledChk.checked = state.recorder.enabled;
    enabledChk.addEventListener('change', e => {
      state.recorder.enabled = e.target.checked;
      if (state.recorder.persist) Store.set('rec.enabled', state.recorder.enabled);
      syncRecorderPanel();
    });
    const persistChk = $('dt-rec-persist');
    persistChk.checked = state.recorder.persist;
    persistChk.addEventListener('change', e => {
      state.recorder.persist = e.target.checked;
      Store.set('rec.persist', state.recorder.persist);
      if (state.recorder.persist) Store.set('rec.enabled', state.recorder.enabled);
      syncRecorderPanel();
    });

    ALL_METHODS.forEach(m => {
      const el = $(`dt-rec-m-${m}`); if (!el) return;
      el.checked = state.recorder.methods.includes(m);
      el.addEventListener('change', () => {
        state.recorder.methods = ALL_METHODS.filter(x => $(`dt-rec-m-${x}`).checked);
        Store.set('rec.methods', state.recorder.methods);
      });
    });

    const mergeChk = $('dt-rec-merge');
    mergeChk.checked = state.recorder.mergeByBaseUrl;
    mergeChk.addEventListener('change', e => {
      state.recorder.mergeByBaseUrl = e.target.checked;
      Store.set('rec.mergeByBaseUrl', state.recorder.mergeByBaseUrl);
      renderRecorderList();
    });

    const organizeChk = $('dt-rec-organize-folders');
    organizeChk.checked = state.recorder.organizeFolders;
    organizeChk.addEventListener('change', e => {
      state.recorder.organizeFolders = e.target.checked;
      Store.set('rec.organizeFolders', state.recorder.organizeFolders);
      // No re-render needed — this only affects Export/Push output, generated on click.
    });

    $('dt-rec-add-manual-target').addEventListener('click', () => {
      state.recorder.targets.push({ id: Date.now(), type:'manual', label:'', url:'', enabled:true });
      Store.set('rec.targets', state.recorder.targets);
      renderRecorderTargets();
    });
    const baseUrlSel = $('dt-rec-add-baseurl-target');
    populateBaseUrlTargetSelect();
    baseUrlSel.addEventListener('change', () => {
      const gid = baseUrlSel.value; if (!gid) return;
      const gidNum = Number(gid);
      if (!state.recorder.targets.some(t => t.type==='baseurl' && t.groupId===gidNum)) {
        state.recorder.targets.push({ id: Date.now(), type:'baseurl', groupId: gidNum, enabled:true });
        Store.set('rec.targets', state.recorder.targets);
        renderRecorderTargets();
      }
      baseUrlSel.value = '';
    });

    $('dt-rec-clear-all').addEventListener('click', () => {
      if (!confirm('Clear all recorded endpoints? This cannot be undone.')) return;
      state.recorder.data = {};
      Store.set('rec.data', state.recorder.data);
      renderRecorderList();
    });

    // Registered once here (not inside renderRecorderList, which reruns often) —
    // closes the kebab portal menu on any click outside it. Checking containment
    // here (rather than relying on every kebab-btn/menu-item handler calling
    // e.stopPropagation() correctly) means a click on the kebab button itself, or
    // anywhere inside the open menu (including its padding, not just its buttons),
    // can never be mistaken for an "outside" click and instantly close the menu
    // it just opened.
    document.addEventListener('click', e => {
      if (e.target.closest('.dt-rec-kebab-btn') || e.target.closest('#dt-rec-kebab-portal')) return;
      closeKebabMenu();
    });

    syncRecorderPanel();
    renderRecorderTargets();
    renderRecorderList();
  }

  function getDefaultState() {
    const persist = Store.get('rec.persist', false);
    return {
      enabled:  persist ? Store.get('rec.enabled', false) : false,
      persist,
      methods:  Store.get('rec.methods', ALL_METHODS),
      mergeByBaseUrl: Store.get('rec.mergeByBaseUrl', false),
      organizeFolders: Store.get('rec.organizeFolders', true),
      targets:  Store.get('rec.targets', []),
      data:     Store.get('rec.data', {}),
      postmanApiKey: Store.get('rec.postmanApiKey', ''),
      postmanCollectionIds: Store.get('rec.postmanCollectionIds', {}),
    };
  }

  const storageSyncHandlers = {
    'rec.enabled':   () => { state.recorder.enabled = Store.get('rec.enabled', false); syncRecorderPanel(); },
    'rec.persist':   () => { state.recorder.persist = Store.get('rec.persist', false); syncRecorderPanel(); },
    'rec.methods':   () => { state.recorder.methods = Store.get('rec.methods', ALL_METHODS); },
    'rec.mergeByBaseUrl':   () => { state.recorder.mergeByBaseUrl = Store.get('rec.mergeByBaseUrl', false); const el = $('dt-rec-merge'); if (el) el.checked = state.recorder.mergeByBaseUrl; renderRecorderList(); },
    'rec.organizeFolders':  () => { state.recorder.organizeFolders = Store.get('rec.organizeFolders', true); const el = $('dt-rec-organize-folders'); if (el) el.checked = state.recorder.organizeFolders; },
    'rec.targets':   () => { state.recorder.targets = Store.get('rec.targets', []); renderRecorderTargets(); },
    'rec.data':      () => { state.recorder.data = Store.get('rec.data', {}); renderRecorderList(); },
    'rec.postmanApiKey': () => { state.recorder.postmanApiKey = Store.get('rec.postmanApiKey', ''); const el = $('dt-set-postman-key'); if (el) el.value = state.recorder.postmanApiKey; ctx.updatePostmanKeyWarning && ctx.updatePostmanKeyWarning(); },
    'rec.postmanCollectionIds': () => { state.recorder.postmanCollectionIds = Store.get('rec.postmanCollectionIds', {}); },
  };

  return {
    id: 'recorder',
    navLabel: 'API Docs',
    buildPanel: buildRecorderPanel,
    initPanel: initRecorderPanel,
    // Generic network-capture hook (see Devtools.js's fetch/XHR patches): core
    // calls wantsCapture() cheaply for every request, and only does the more
    // expensive response-header/body extraction if it returns true.
    wantsCapture: shouldRecord,
    onResponseCapture: recorderCapture,
    // Base URL groups feed the recorder's "attach a group as a target" + live
    // bucket labels — core calls this after any group add/edit/delete/rename.
    onBaseUrlGroupsChanged() { populateBaseUrlTargetSelect(); renderRecorderList(); },
    // Lets the request interceptor cross-check a pending request's payload
    // against whatever's already documented for that endpoint.
    getRequestSuggestions,
    getDefaultState,
    storageSyncHandlers,
  };
});
