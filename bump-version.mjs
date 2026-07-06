#!/usr/bin/env node
// Bump the userscript @version and keep every file in sync.
//
// Only Devtools.user.js's @version actually drives Tampermonkey updates, but we
// bump all files so their headers never drift. Run this, commit, push — done.
//
// Usage:
//   node bump-version.mjs            # patch  bump: 3.0.0 -> 3.0.1
//   node bump-version.mjs patch     # same
//   node bump-version.mjs minor     # 3.0.5 -> 3.1.0
//   node bump-version.mjs major     # 3.4.2 -> 4.0.0
//   node bump-version.mjs 3.7.0     # set an explicit version

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const ENTRY = 'Devtools.user.js';
const VERSION_RE = /(\/\/\s*@version\s+)(\d+)\.(\d+)\.(\d+)/;
// Runtime copy of the version (Devtools_constants.js) — shown in the About
// panel, kept in lockstep with the @version headers.
const DT_VERSION_RE = /(const DT_VERSION = ')(\d+\.\d+\.\d+)(')/;
// jsDelivr @require pins in the entry script (Devtools.user.js). Dependencies
// are served from jsDelivr pinned to the release TAG — raw.githubusercontent
// rate-limits the 10-file burst Tampermonkey fires at install/update (429s ->
// missing dependencies), and a pinned tag also guarantees the requires always
// match the entry's version instead of racing a branch update.
const JSDELIVR_RE = /(cdn\.jsdelivr\.net\/gh\/[^@\s]+@v)(\d+\.\d+\.\d+)/g;

const files = readdirSync(dir).filter(f => f.endsWith('.js') || f === ENTRY);
const entryPath = join(dir, ENTRY);

// Derive the current version from the entry file (source of truth).
const entrySrc = readFileSync(entryPath, 'utf8');
const m = entrySrc.match(VERSION_RE);
if (!m) { console.error(`No "@version x.y.z" found in ${ENTRY}`); process.exit(1); }
const [maj, min, pat] = [Number(m[2]), Number(m[3]), Number(m[4])];

const arg = (process.argv[2] || 'patch').toLowerCase();
let next;
if (/^\d+\.\d+\.\d+$/.test(arg)) next = arg;
else if (arg === 'major') next = `${maj + 1}.0.0`;
else if (arg === 'minor') next = `${maj}.${min + 1}.0`;
else if (arg === 'patch') next = `${maj}.${min}.${pat + 1}`;
else { console.error(`Unknown bump "${arg}" — use patch | minor | major | x.y.z`); process.exit(1); }

let changed = 0;
for (const f of files) {
  const p = join(dir, f);
  const src = readFileSync(p, 'utf8');
  if (!VERSION_RE.test(src)) continue;
  const out = src
    .replace(VERSION_RE, (_all, lead) => `${lead}${next}`)
    .replace(DT_VERSION_RE, (_all, lead, _v, trail) => `${lead}${next}${trail}`)
    .replace(JSDELIVR_RE, (_all, lead) => `${lead}${next}`);
  if (out !== src) { writeFileSync(p, out); changed++; }
}

console.log(`Version ${maj}.${min}.${pat} -> ${next}  (${changed} file${changed === 1 ? '' : 's'} updated)`);
console.log(`Next: git add -A && git commit -m "v${next}" && git tag v${next} && git push && git push origin v${next}`);
console.log(`      (the v${next} tag MUST be pushed — the jsDelivr @require pins point at it)`);
