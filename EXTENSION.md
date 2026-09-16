# Browser extension (Chrome + Firefox)

The same source files that make up the userscript also build a Manifest V3
extension. Nothing is forked: `build-extension.mjs` reads the `@require` list in
`Devtools.user.js` (so the file order stays in one place) and bundles the files.

```bash
./build.sh                        # Chrome + Firefox → dist/chrome/, dist/firefox/
./build.sh chrome                 # one browser (chrome | firefox)
./build.sh --zip                  # also dist/devtools-sidebar-<version>-<browser>.zip (for store uploads)
./build.sh --bump minor --zip     # bump the version everywhere, then build + zip a release
./build.sh --watch                # rebuild on every source save (reload the extension afterwards)
./build.sh --clean                # wipe dist/ first
./build.sh --submit               # build firefox/, then upload it to addons.mozilla.org
./build.sh --submit --unlisted    # ...to the unlisted (self-hosted) channel instead
./build.sh --bump patch --submit  # the usual release: bump, build, upload
```

## Submitting to addons.mozilla.org

`--submit` hands `dist/firefox/` to [`web-ext sign`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign)
(fetched on demand via `npx`, nothing to install). It always builds the Firefox
target first, even if you named another one.

Get an API key/secret from the [AMO API key page](https://addons.mozilla.org/developers/addon/api/key/)
and put them in the environment, or in a `.amo-credentials` file next to
`build.sh` (already gitignored):

```bash
WEB_EXT_API_KEY=user:12345678:123
WEB_EXT_API_SECRET=...
```

- **Listed (default)** — the upload goes into AMO's review queue and, once
  approved, is published on addons.mozilla.org. The script passes
  `--approval-timeout 0` so it returns as soon as the upload lands instead of
  blocking on the queue; watch <https://addons.mozilla.org/developers/addons>.
- **`--unlisted`** — AMO signs the build without a public listing, usually in
  seconds, and the signed `.xpi` lands in `dist/`. Use this for self-hosted or
  internal distribution; you host updates yourself.

AMO rejects a version it has already seen, so bump before every submission
(`--bump patch --submit`).

### When a submission fails

web-ext catches every request error and rethrows it as `WebExtError: fetch
failed` — undici's generic message, with the URL and errno stripped out. That
trace tells you nothing on its own. `--submit` therefore preloads
`tools/amo-fetch-trace.mjs` (via `NODE_OPTIONS=--import`), which prints the
request and its cause chain just before web-ext swallows them:

```
[amo] request failed: POST https://addons.mozilla.org/api/v5/addons/upload/
[amo]   cause: ENOTFOUND getaddrinfo ENOTFOUND ...
```

Read the `cause` line first — `ENOTFOUND`/`EAI_AGAIN` is DNS, `ECONNRESET` or
`UND_ERR_*` is a dropped connection or a middlebox, a certificate error means a
TLS-intercepting proxy (point `HTTPS_PROXY` at it). Add `--verbose` to also log
every request web-ext makes. A bad key or secret is *not* one of these: it comes
back as a clean HTTP 401 with `{"detail": "Error decoding signature."}`.

A failure *after* the upload has landed is the common case: web-ext uploads,
then polls AMO for validation and approval for minutes, and a drop during that
polling still aborts the run even though your version is already on AMO (you'll
get Mozilla's email either way). web-ext records the upload UUID so a retry can
resume instead of re-uploading — but it writes that state into `--source-dir`,
which `build-extension.mjs` wipes on every build, so `build.sh` stashes it in
`.amo-state/` (gitignored) and restores it after the rebuild. When the script
reports a saved UUID, check the dev hub before retrying: if the version is
already there, AMO rejects a duplicate and you want `--bump patch --submit`.

`build.sh` checks for Node 18+ (and `zip` when packaging), then runs
`build-extension.mjs`; you can call that directly with the same arguments
(except `--bump`/`--clean`). Each browser gets its own manifest: Chrome gets
`background.service_worker` and `minimum_chrome_version`; Firefox gets
`background.scripts` and its `gecko` id. The extension version is always the
entry script's `@version`.

## Install (unpacked)
- **Chrome / Edge / Brave (111+):** `chrome://extensions` → Developer mode →
  **Load unpacked** → pick `dist/chrome`.
- **Firefox (128+):** `about:debugging#/runtime/this-firefox` → **Load Temporary
  Add-on** → pick `dist/firefox/manifest.json`. Firefox may ask you to grant
  the "Access your data for all websites" permission (Extensions → DevTools
  Sidebar → Permissions).

Click the toolbar button to open or close the sidebar. The floating tab and
hotkeys work the same way they do in the userscript.

## How it maps onto the userscript

| Userscript                    | Extension                                                             |
|-------------------------------|-----------------------------------------------------------------------|
| `@require` CodeMirror from CDN | Vendored in `extension/vendor/codemirror/` (stores forbid remote code) |
| `@require` source files        | Concatenated into `devtools.js` (a MAIN-world content script)          |
| `unsafeWindow`                 | `window` (the bundle already runs in the page's world)                 |
| `GM_getValue` / `GM_setValue`  | Shims over a snapshot of `chrome.storage.local`                        |
| `GM_addValueChangeListener`    | `storage.onChanged`, forwarded only for writes from *other* tabs       |

Files in `extension/`:
- **`bridge.js`**: an ISOLATED-world content script. It owns `chrome.storage`
  and talks to the bundle over a private `MessageChannel`, because MAIN-world
  scripts can't use extension APIs.
- **`background.js`**: the toolbar button. It sends a message to the tab's
  bridge, which tells the bundle to toggle the sidebar. It also fetches files
  for Force Dark's Smart engine: cross-origin stylesheets and icons the page's
  CORS rules would hide. `bridge.js` only relays URLs the page itself uses.
  The background never sends cookies, only accepts CSS or images, and won't
  fetch private-network hosts for a public page.
- **`icons/`**: the toolbar and store icons. Regenerate the PNGs from `icon.svg`
  with `for s in 16 32 48 128; do rsvg-convert -w $s -h $s extension/icons/icon.svg -o extension/icons/icon$s.png; done`.

The bundle wraps everything in one function scope. CodeMirror and the shared
constants (`CSS`, `HTML`, `icon`, …) never become page globals, and CodeMirror's
UMD wrappers can't register with a site's own AMD/CommonJS loader.

## Known differences
- **Very early requests:** `chrome.storage` is async, so the bundle waits for the
  settings snapshot (a few ms) before it patches fetch/XHR. Requests fired by
  inline `<head>` scripts before that aren't intercepted or captured. In the
  userscript, `GM_getValue` is synchronous.
- **Settings live in the page's JS world at runtime.** The sidebar has to run
  there to patch `fetch`, so a hostile page could read in-memory state such as
  the Postman API key. This is the same exposure as the userscript under
  Tampermonkey's page-context injection. Settings at rest stay in extension
  storage, not in the site's `localStorage`.
- **Strict-CSP sites:** pages whose CSP forbids inline `<style>` can block the
  sidebar's stylesheet, just as they do for the userscript.
- **Settings don't migrate.** Tampermonkey's GM storage isn't reachable from an
  extension, so the extension starts with default settings.
- **Don't run both.** With the userscript and the extension both active, a page
  gets two sidebars.
