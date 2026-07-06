# Hosting & auto-updating from GitHub (public repo)

The layout: the **entry script** (`Devtools.user.js`) lives at a stable
`raw.githubusercontent.com/<user>/<repo>/main/...` URL (that's what
`@updateURL`/`@downloadURL` point at, and what users install), while the ten
**dependency files** are `@require`d from **jsDelivr** pinned to the release
tag — `https://cdn.jsdelivr.net/gh/<user>/<repo>@vX.Y.Z/<file>`.
`bump-version.mjs` rewrites those pins on every bump, so you still never edit
the `@require` lines by hand.

## Why jsDelivr for the `@require`s (the 429 problem)

`raw.githubusercontent.com` rate-limits unauthenticated requests per IP. A
Tampermonkey install or update fetches **all ten `@require` files in one
burst**, which routinely trips that limit — some files come back `429 Too Many
Requests`, Tampermonkey caches the misses, and the script then runs with
missing panels/styles until the next successful update. jsDelivr is a CDN
built specifically to front GitHub files: effectively no rate limit, cached at
the edge, and — because the pins name an exact release tag — the dependencies
always match the entry script's `@version` instead of racing a branch update.
(The entry file itself stays on `raw`: it's a single small fetch, and `raw`
reflects a push within ~5 min, so update checks stay fast.)

## 1. Create the repo & push these files
Put all 11 files (the 9 `.js` files + `Devtools.user.js` + `bump-version.mjs`)
in a **public** GitHub repo, on the `main` branch.

## 2. Fill in your username/repo
`Devtools.user.js` ships with `YOUR_GH_USER/YOUR_REPO` placeholders in every
`@require`, `@downloadURL`, and `@updateURL`. One find-replace:

```bash
sed -i 's#YOUR_GH_USER/YOUR_REPO#myname/dt-sidebar#g' Devtools.user.js
git add -A && git commit -m "wire hosting URLs" && git push
```

`@downloadURL`/`@updateURL` point at
`https://raw.githubusercontent.com/<user>/<repo>/main/Devtools.user.js` (stable
across versions); the `@require`s point at
`https://cdn.jsdelivr.net/gh/<user>/<repo>@vX.Y.Z/<file>` (re-pinned
automatically by `bump-version.mjs` on every release).

## 3. Install
Open
`https://raw.githubusercontent.com/<user>/<repo>/main/Devtools.user.js`
in a browser with Tampermonkey → it offers to install. Done.

## The update loop (this is the payoff)

```bash
# edit any file(s) …
node bump-version.mjs            # patch bump; or: minor | major | 3.4.0
git add -A && git commit -m "vX.Y.Z"
git tag vX.Y.Z
git push && git push origin vX.Y.Z   # the tag push is REQUIRED — see below
```

Tampermonkey re-checks `@updateURL` on its interval (Dashboard → Settings →
**Check for updates**, or click **Check for userscript updates** to force it).
`raw.githubusercontent.com` refreshes within ~5 min of a push.

### Why the tag push is mandatory
The `@require` lines point at `cdn.jsdelivr.net/gh/<user>/<repo>@vX.Y.Z/…` —
`bump-version.mjs` rewrites that pin to the new version, so if the matching
git tag isn't on GitHub, jsDelivr 404s and the new install/update comes up
with missing dependencies.

### Why the version bump is mandatory
Tampermonkey **caches `@require` files and only re-downloads them when the main
script's `@version` increases.** So editing a dependency and pushing does nothing
until `Devtools.user.js`'s version goes up — which is exactly what
`bump-version.mjs` does (it bumps every file's header so they never drift). The
pinned jsDelivr URLs also change on every bump, which busts both Tampermonkey's
and the CDN's caches deterministically.

## Fast local dev loop (optional, no pushing)
While actively hacking, serve the folder and point `@require` at localhost:

```bash
python3 -m http.server 8421       # in this folder
# temporarily: @require http://127.0.0.1:8421/<file>
```

Still bump the version + reload to defeat the require cache. Switch the URLs back
to `raw.githubusercontent.com` for release. (Tip: keep two Tampermonkey scripts —
a "dev" one on localhost and the real one on GitHub.)

---

## If you ever make the repo PRIVATE

Tampermonkey's `@require` **can't send an auth header**, so a private repo's raw
URLs return **401**. You'd then need a public "door" that authenticates for you:

- **Cloudflare Worker proxy** (keeps the repo truly private): a tiny Worker holds
  a read-only fine-grained GitHub token and serves the files. Point the `@require`
  base at the Worker instead of `raw.githubusercontent.com`. ~5 min setup.
- **Secret Gist** (unlisted, not truly private): host the files in a secret gist;
  base becomes `https://gist.githubusercontent.com/<user>/<gist-id>/raw` (omit the
  commit SHA so it serves the latest revision).

Everything else (bump script, update loop) is identical — only the base host in
the `@require`/`@update`/`@download` URLs changes.
