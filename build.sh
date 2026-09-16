#!/usr/bin/env bash
# Build (and optionally submit) the DevTools Sidebar browser extension.
#
#   ./build.sh                      # Chrome + Firefox → dist/chrome, dist/firefox
#   ./build.sh chrome               # one browser
#   ./build.sh --zip                # also package store-ready zips into dist/
#   ./build.sh --bump [patch|minor|major|X.Y.Z] --zip
#                                   # bump the version (all files), then build + zip
#   ./build.sh --watch              # rebuild on every source change
#   ./build.sh --clean              # delete dist/ first
#   ./build.sh --submit             # build firefox, then upload it to addons.mozilla.org
#   ./build.sh --submit --unlisted  # ...as a self-hosted (unlisted) build; signed .xpi
#                                   # lands in dist/ instead of going to public review
#   ./build.sh --submit --verbose   # log every request web-ext makes (for debugging)
#
# Submitting needs AMO API credentials from https://addons.mozilla.org/developers/addon/api/key/
# in the environment (or in .amo-credentials, which is gitignored):
#   export WEB_EXT_API_KEY=user:12345678:123
#   export WEB_EXT_API_SECRET=...
#
# Options combine, e.g. ./build.sh firefox --clean --zip
set -euo pipefail
cd "$(dirname "$0")"

targets=() build_args=() bump="" clean=0 submit=0 verbose=0 channel="listed"
while [[ $# -gt 0 ]]; do
  case "$1" in
    chrome|firefox|all) targets+=("$1") ;;
    --zip|--watch)      build_args+=("$1") ;;
    --clean)            clean=1 ;;
    --submit)           submit=1 ;;
    --unlisted)         channel="unlisted" ;;
    --verbose)          verbose=1 ;;
    --listed)           channel="listed" ;;
    --bump)
      # Optional level/version argument; defaults to a patch bump.
      if [[ $# -gt 1 && "$2" =~ ^(patch|minor|major|[0-9]+\.[0-9]+\.[0-9]+)$ ]]; then bump="$2"; shift; else bump="patch"; fi ;;
    -h|--help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see ./build.sh --help)" >&2; exit 1 ;;
  esac
  shift
done

command -v node >/dev/null || { echo "Node.js is required (18+)." >&2; exit 1; }
node_major=$(node -p 'process.versions.node.split(".")[0]')
(( node_major >= 18 )) || { echo "Node.js 18+ is required (found $(node -v))." >&2; exit 1; }
if [[ " ${build_args[*]-} " == *" --zip "* ]] && ! command -v zip >/dev/null; then
  echo "--zip needs the 'zip' command (e.g. pacman -S zip / apt install zip)." >&2; exit 1
fi

if (( submit )); then
  [[ " ${build_args[*]-} " == *" --watch "* ]] && { echo "--submit can't be combined with --watch." >&2; exit 1; }
  command -v npx >/dev/null || { echo "--submit needs npx (ships with Node)." >&2; exit 1; }
  # web-ext reads WEB_EXT_API_KEY / WEB_EXT_API_SECRET from the environment.
  # shellcheck disable=SC1091
  [[ -f .amo-credentials ]] && { set -a; . ./.amo-credentials; set +a; }
  if [[ -z "${WEB_EXT_API_KEY:-}" || -z "${WEB_EXT_API_SECRET:-}" ]]; then
    echo "--submit needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET (see ./build.sh --help)." >&2; exit 1
  fi
  # Firefox is the only target that can be submitted; build it whatever was asked for.
  [[ " ${targets[*]-} " == *" firefox "* || " ${targets[*]-} " == *" all "* ]] || targets=(firefox)
fi

(( clean )) && rm -rf dist
[[ -n "$bump" ]] && node bump-version.mjs "$bump"

# web-ext keeps its resume state (.web-extension-id, .amo-upload-uuid) inside
# --source-dir, but build-extension.mjs wipes dist/<target> on every build. Stash
# it in .amo-state/ so a rebuild doesn't throw away the upload UUID — that UUID is
# what lets a retry resume a submission that uploaded but failed afterwards,
# instead of re-uploading and being rejected as a duplicate version.
AMO_STATE=(.web-extension-id .amo-upload-uuid)
if (( submit )); then
  mkdir -p .amo-state
  for f in "${AMO_STATE[@]}"; do
    [[ -f "dist/firefox/$f" ]] && cp "dist/firefox/$f" ".amo-state/$f"
  done
fi

node build-extension.mjs ${targets[@]+"${targets[@]}"} ${build_args[@]+"${build_args[@]}"}

if (( submit )); then
  for f in "${AMO_STATE[@]}"; do
    [[ -f ".amo-state/$f" ]] && cp ".amo-state/$f" "dist/firefox/$f"
  done
fi

(( submit )) || exit 0

version=$(node -p 'require("fs").readFileSync("dist/firefox/manifest.json","utf8").match(/"version":\s*"([^"]+)"/)[1]')
echo
echo "Submitting DevTools Sidebar v$version to addons.mozilla.org ($channel)…"

# --approval-timeout 0: hand the build to AMO and exit instead of blocking on the
# review queue. Unlisted builds are signed within seconds, so we do wait for those
# and get the .xpi written into dist/.
sign_args=(--channel "$channel" --source-dir dist/firefox --artifacts-dir dist)
[[ "$channel" == "listed" ]] && sign_args+=(--approval-timeout 0)
(( verbose )) && sign_args+=(--verbose)

# web-ext rethrows request errors as `WebExtError: fetch failed`, dropping the
# URL and errno. tools/amo-fetch-trace.mjs prints those before they're swallowed.
status=0
NODE_OPTIONS="--import ${PWD}/tools/amo-fetch-trace.mjs ${NODE_OPTIONS:-}" \
  npx --yes web-ext@latest sign "${sign_args[@]}" || status=$?

# Persist whatever web-ext wrote, especially after a failure — that's the run
# whose UUID the next attempt needs.
mkdir -p .amo-state
for f in "${AMO_STATE[@]}"; do
  [[ -f "dist/firefox/$f" ]] && cp "dist/firefox/$f" ".amo-state/$f"
done

if (( status )); then
  echo >&2
  echo "web-ext exited $status. The [amo] lines above give the real cause" >&2
  echo "(--verbose logs every request)." >&2
  if [[ -f .amo-state/.amo-upload-uuid ]]; then
    echo >&2
    echo "NOTE: an upload UUID was saved, so v$version most likely reached AMO already." >&2
    echo "Check https://addons.mozilla.org/developers/addons before retrying: re-running" >&2
    echo "resumes from that upload, but if the version is already there AMO will reject" >&2
    echo "it as a duplicate and you need ./build.sh --bump patch --submit instead." >&2
  fi
  exit $status
fi

if [[ "$channel" == "listed" ]]; then
  echo "Uploaded. Track the review at https://addons.mozilla.org/developers/addons"
else
  echo "Signed .xpi is in dist/ — distribute it yourself; it self-updates only if you host updates."
fi
