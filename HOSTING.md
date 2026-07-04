# Hosting & auto-updating from GitHub (public repo)

The whole point: **stable branch URLs** that never change, so unlike GreasyFork
(new URL per version) you edit → push → bump, and never touch the `@require`
lines again.

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

The URLs point at
`https://raw.githubusercontent.com/<user>/<repo>/main/<file>` — `main` is the
branch, so the URL is stable across every future version.

## 3. Install
Open
`https://raw.githubusercontent.com/<user>/<repo>/main/Devtools.user.js`
in a browser with Tampermonkey → it offers to install. Done.

## The update loop (this is the payoff)

```bash
# edit any file(s) …
node bump-version.mjs            # patch bump; or: minor | major | 3.4.0
git add -A && git commit -m "vX.Y.Z" && git push
```

Tampermonkey re-checks `@updateURL` on its interval (Dashboard → Settings →
**Check for updates**, or click **Check for userscript updates** to force it).
`raw.githubusercontent.com` refreshes within ~5 min of a push.

### Why the version bump is mandatory
Tampermonkey **caches `@require` files and only re-downloads them when the main
script's `@version` increases.** So editing a dependency and pushing does nothing
until `Devtools.user.js`'s version goes up — which is exactly what
`bump-version.mjs` does (it bumps every file's header so they never drift).

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
