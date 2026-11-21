// Cache of the --base (main) side of verify:holo, keyed by commit (H2-1 B1). Only the base side is ever cached: the branch side is always measured fresh.
// Self-test: node scripts/verify/base-cache.selftest.mjs (key sensitivity, corrupt files, directory rules); the integration with verify-holo.mjs is in verify-holo.selftest.mjs.
//
// What is cached: (1) "web/dist of the base worktree is the build of this commit" (the dist content hash is stored and compared again on every hit),
//                 (2) the base entry measurement (entryGzip) for that exact dist.
// What is NOT cached: anything on the branch side, and the known-on-main re-run of os-handoff (it decides FAIL vs INVALID, is rare, and a stale answer there could excuse a regression).
//
// Cache key (all of them, any difference = no hit): base `git rev-parse HEAD` (full), base worktree clean (`git status --porcelain` empty; a dirty or unreadable worktree has NO key:
// it neither reads nor writes the cache), sha256 of the base package-lock.json, node version, sha256 of the verification scripts that decide the result (os-bundle.mjs, bundle-graph.mjs,
// holo-baseline.json), and the measurement parameters (MEASURE_ID). F1 adds the build inputs git does not see: nodeModulesHash (sha256 of base node_modules/.package-lock.json, the installed tree;
// missing = no key) and envHash (every .env* file Vite can read + the VITE_* / NODE_ENV variables, see hashEnvInputs). The entry file also stores the whole key summary and the lookup compares it, not just the file name.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CACHE_SCHEMA = 1;
/** bump when what is measured / how it is measured changes, so old entries can never match */
export const MEASURE_ID = 'entry-gzip9-static-graph-v1';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
/** sha256 of a file, or the marker 'missing' (a missing file is a value too: it differs from any real hash) */
export function hashFile(p) { try { return sha256(fs.readFileSync(p)); } catch { return 'missing'; } }
/** sha256 over (relative path, content) of every file under dir, sorted; null when dir does not exist */
export function hashDir(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) files.push(p); } };
  walk(dir);
  files.sort();
  const h = crypto.createHash('sha256');
  for (const f of files) { h.update(path.relative(dir, f).split(path.sep).join('/')); h.update('\0'); h.update(fs.readFileSync(f)); h.update('\0'); }
  return h.digest('hex');
}

/** the names that can feed an env: .env and .env.* in ANY letter case (Windows does not tell .ENV from .env), whatever kind of entry (a link, a junction or a directory is a value too: hashFile gives 'missing' for what cannot be read) */
export const ENV_NAME = /^\.env(?:\..*)?$/i;
const isHash = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
/**
 * F1: one hash over the build inputs that are gitignored (so a clean `git status` says nothing about them): every file called `.env` or `.env.*` directly inside each of `dirs` (sorted by dir order, then name;
 * a directory without any is a value too), plus the `VITE_*` variables and `NODE_ENV` of `env` (a build reads them). Adding, removing, renaming or editing any of these changes the hash.
 */
export function hashEnvInputs({ dirs, env = {} }) {
  const h = crypto.createHash('sha256');
  dirs.forEach((dir, i) => {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => ENV_NAME.test(n)).sort(); } catch { /* no such directory = no env files */ }
    h.update(`dir#${i}\0`);
    for (const n of names) { h.update(n); h.update('\0'); h.update(hashFile(path.join(dir, n))); h.update('\0'); }
  });
  h.update('process-env\0');
  for (const k of Object.keys(env).filter((x) => x.startsWith('VITE_') || x === 'NODE_ENV').sort()) { h.update(k); h.update('='); h.update(String(env[k])); h.update('\0'); }
  return h.digest('hex');
}

/**
 * @param {{baseHead:string|null, clean:boolean, lockHash:string, node:string, nodeModulesHash:string, envHash:string, scripts:Record<string,string>, params?:string}} p
 * @returns {{digest:string, summary:object}|null} null = this worktree state has no key (dirty / unknown head / no installed-tree identity / no env hash): do not use the cache at all
 */
export function buildKey({ baseHead, clean, lockHash, node, nodeModulesHash, envHash, scripts, params = MEASURE_ID }) {
  if (!clean || !baseHead) return null;
  if (!isHash(nodeModulesHash) || !isHash(envHash)) return null; // fail closed: 'missing' / undefined is not an identity
  const summary = { schema: CACHE_SCHEMA, baseHead, lockHash, node, nodeModulesHash, envHash, scripts: Object.fromEntries(Object.entries(scripts).sort(([a], [b]) => (a < b ? -1 : 1))), params };
  return { digest: sha256(JSON.stringify(summary)), summary };
}

export const entryPath = (dir, digest) => path.join(dir, `base-${digest.slice(0, 32)}.json`);

const isHex = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const isTime = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
/** a valid entry or null. Anything unreadable, not JSON, wrong shape, wrong schema or for another key is a MISS (never a hit, never a crash). */
export function readEntry(dir, key) {
  let j;
  try { j = JSON.parse(fs.readFileSync(entryPath(dir, key.digest), 'utf8')); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  if (j.schema !== CACHE_SCHEMA || j.digest !== key.digest || JSON.stringify(j.key) !== JSON.stringify(key.summary)) return null;
  if (!isHex(j.distHash) || !isTime(j.builtAt)) return null;
  if (j.entryGzip !== null && !(typeof j.entryGzip === 'number' && Number.isFinite(j.entryGzip) && j.entryGzip >= 0)) return null;
  if (j.entryGzip !== null && !isTime(j.measuredAt)) return null;
  return j;
}
/** atomic write (temp file + rename); false (never throws) when the directory cannot be written */
export function writeEntry(dir, key, { distHash, builtAt, entryGzip = null, measuredAt = null }) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const f = entryPath(dir, key.digest);
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ schema: CACHE_SCHEMA, digest: key.digest, key: key.summary, distHash, builtAt, entryGzip, measuredAt }, null, 2));
    fs.renameSync(tmp, f);
    return true;
  } catch { return false; }
}

const isInside = (child, parent) => { const r = path.relative(path.resolve(parent), path.resolve(child)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
/** the rules for the cache directory (VERIFY_HOLO_CACHE_DIR or the default): absolute, never the real-data folder, never inside the repo or the --base worktree (cache files must not become tracked changes).
 *  @returns {string|null} a problem description, or null when the directory is acceptable */
export function cacheDirProblem(dir, { real, forbiddenRoots = [] }) {
  if (typeof dir !== 'string' || !dir) return 'empty path';
  if (!path.isAbsolute(dir)) return 'not an absolute path';
  if (dir.includes(real)) return 'contains the real-data folder name';
  for (const r of forbiddenRoots) if (r && isInside(dir, r)) return 'inside the repo or the --base worktree';
  return null;
}
