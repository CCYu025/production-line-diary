// verify:holo — the one-command verification for the HOLO work (H2 brief section 3, docs/holo-handoff.md).
//
//   npm run verify:holo -- [--base <main worktree>] [--quick] [--full] [--only a,b] [--out <dir>] [--allow-software] [--diff-base main]
//
// Items (every one always appears in the JSON; not run = SKIP with a reason):
//   A  ci-check ci-test ci-typecheck ci-test-web ci-build ci-bundle      the six CI steps (thresholds: holo-baseline.json)
//      entry-delta-vs-base                                             web entry gzip vs the --base worktree (<= +100 B; SKIP without --base)
//   B  tests-untouched redline-grep                                      static red lines on `git diff <diff-base>...HEAD`
//   C  lab-bundle c1-web c1-os os-e2e os-handoff os-handoff-4x           zero-diff and OS regression (needs servers); os-handoff-4x only with --full
//   D  holo-ime holo-still holo-perf holo-perf-20k                       the H1 lab scripts (headed Chrome, real GPU)
//
// Output: <out>/verify-holo.json  {schema, items:[{id, group, status, value, threshold, durationMs, log}], ...}
//         <out>/logs/<id>.log      the full output of every item (the `log` field is the path relative to <out>)
//         last stdout line:  VERIFY:HOLO <PASS|FAIL|INCOMPLETE> N/T pass, X fail (ids), Y skip (ids), Z invalid (ids) — <path to json>
//                            two more forms, only for the self-test hook VERIFY_HOLO_SELFTEST=1 (README "Last stdout line"): the label SELFTEST instead of PASS|FAIL|INCOMPLETE (a stubbed run is never a result),
//                            and "VERIFY:HOLO FAIL VERIFY_HOLO_SELFTEST refused because CI is set (no item was run)" (exit 1, no json) when the hook is on while CI is set
// Exit code: 0 all PASS | 1 any FAIL | 2 no FAIL but some SKIP / INVALID (2 is NOT a pass: escalate).
//
// Servers (always scratch copies of the example data, started with serve.mjs and proved with assertScratchServer):
//   3114 this worktree (default build) | 3115 --base worktree | 3116 this worktree's LAB build (VITE_HOLO_LAB=1, WEB_OUT_DIR elsewhere)
// All servers and child processes are stopped on exit, on failure and on Ctrl+C. Ports 3000 / 3001 are never touched.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Browser } from './cdp.mjs';
import { assertScratchServer } from './safety.mjs';
import { overallExit } from './exit-code.mjs';
import { baseUnavailableDecision, classifyFails, buildHandoffArgs, handoffAllowsDeviated, handoffExitProblem, knownOnMainDecision } from './known-on-main.mjs';
import { buildImeArgs, envKindOf, imeExitProblem, judgeRetry, summarizeAttempt } from './ime-env.mjs';
import { HEARTBEAT_MS, applySuspend, applyTimeout, classifySuspend, clock, findGaps } from './suspend.mjs';
import { personalHit, profilePathHit, themeKeyLines } from './redline-rules.mjs';
import { MEASURE_ID, buildKey, cacheDirProblem, hashDir, hashEnvInputs, hashFile, readEntry, writeEntry } from './base-cache.mjs';
import { scrubPathText, scrubTree } from './scrub.mjs';
import { imeCdpModule } from './ime-env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const { values: A } = parseArgs({
  options: {
    base: { type: 'string' }, quick: { type: 'boolean', default: false }, full: { type: 'boolean', default: false }, only: { type: 'string' }, out: { type: 'string', default: 'verify-out/holo' },
    'allow-software': { type: 'boolean', default: false }, 'diff-base': { type: 'string', default: 'main' }, 'dump-hooks': { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
    'no-cache': { type: 'boolean', default: false }, 'no-fail-fast': { type: 'boolean', default: false },
  },
});
// [id, group, timeSensitive]. timeSensitive = the result depends on the clock (browser, input timing, frame rate): only these are reclassified INVALID when the machine was suspended
// during the run (suspend.mjs). Static items (build, tests, bundle sizes, diff scans) are not: a FAIL there stays a FAIL. A new item is NOT time-sensitive unless marked T.
const T = true;
const ITEM_DEFS = [
  ['ci-check', 'A'], ['ci-test', 'A'], ['ci-typecheck', 'A'], ['ci-test-web', 'A'], ['ci-build', 'A'], ['ci-bundle', 'A'], ['entry-delta-vs-base', 'A'],
  ['tests-untouched', 'B'], ['redline-grep', 'B'],
  ['lab-bundle', 'C'], ['c1-web', 'C', T], ['c1-os', 'C', T], ['os-e2e', 'C', T], ['os-handoff', 'C', T], ['os-handoff-4x', 'C', T],
  ['holo-ime', 'D', T], ['holo-still', 'D', T], ['holo-perf', 'D', T], ['holo-perf-20k', 'D', T],
];
const USAGE = `npm run verify:holo -- [--base <main worktree>] [--quick] [--full] [--only a,b] [--out <dir>] [--allow-software] [--diff-base main] [--no-cache] [--no-fail-fast]
  --base            main worktree for the c1 zero-diff items (3115) and entry-delta-vs-base. Without it those three are SKIP.
  --quick           only groups A and B (about 3 minutes, for the coordinator while developing). Delivery and L1 run the full version.
                    The full version runs A and B first (the quick stage); if any item there is FAIL or INVALID, C and D are SKIP ("not run: quick stage failed (ids)").
  --no-fail-fast    run C and D even when the quick stage failed (L2 wants the complete list)
  --no-cache        do not read or write the --base cache (default: os.tmpdir()/pld-vh-cache, or the absolute VERIFY_HOLO_CACHE_DIR); the base side is rebuilt and re-measured
  --full            also run os-handoff-4x (os-handoff at CPU 4x, > 25 min). Required for: H2-5 every L2 round, H3+ final L2 round of each phase, any PR touching the input gate / transitions / useBlocker.
  --only a,b        run only these ids (${ITEM_DEFS.map((d) => d[0]).join(', ')}); the others are SKIP
  --out <dir>       default verify-out/holo
  --allow-software  let D items run on a software WebGL renderer; their PASS is then downgraded to INVALID
  --diff-base       ref for the B group (git diff <ref>...HEAD), default main
exit: 0 all PASS | 1 any FAIL | 2 SKIP / INVALID without FAIL`;
if (A.help) { console.log(USAGE); process.exit(0); }
// F4: --only given but naming nothing ("", ",", " ", ", ,") is a usage error, not "run everything": it must not start a server, a build or create any folder (this check is before every mkdir)
const only = A.only !== undefined ? new Set(A.only.split(',').map((s) => s.trim()).filter(Boolean)) : null;
if (only && only.size === 0) { console.error(`verify-holo: --only needs at least one item id (got ${JSON.stringify(A.only)}); nothing was run
${USAGE}`); process.exit(2); }
if (only) for (const id of only) if (!ITEM_DEFS.some((d) => d[0] === id)) { console.error(`verify-holo: unknown id "${id}"; known: ${ITEM_DEFS.map((d) => d[0]).join(', ')}`); process.exit(2); }

// Test hooks for verify-holo.selftest.mjs ONLY (all inert unless VERIFY_HOLO_SELFTEST=1): stub the build and the servers, swap the os-handoff / holo-ime scripts, shorten the command timer,
// make every item a fake PASS, replace the baseline file. Each hook is its own constant below, gated by ST; `--dump-hooks` prints them (the self-test proves every one is inert without ST).
// Hard conditions (designer ruling): (1) only the exact string "1" enables it, anything else warns on stderr and is ignored; (2) with CI set (non-empty) it is refused -> FAIL, exit 1, nothing is run;
// (3) while enabled the overall result is NEVER PASS and the exit code is never 0 (see finish()).
const ST_RAW = process.env.VERIFY_HOLO_SELFTEST;
if (ST_RAW !== undefined && ST_RAW !== '1') console.error(`verify-holo: WARNING: VERIFY_HOLO_SELFTEST=${JSON.stringify(ST_RAW)} ignored (only the exact value "1" enables the test hooks)`);
if (ST_RAW === '1' && process.env.CI) {
  console.error('verify-holo: VERIFY_HOLO_SELFTEST=1 is refused while CI is set: the test hooks stub the build and servers and must never produce a real result');
  console.log('VERIFY:HOLO FAIL VERIFY_HOLO_SELFTEST refused because CI is set (no item was run)');
  process.exit(1);
}
const ST = ST_RAW === '1';
const HANDOFF_SCRIPT = ST && process.env.VERIFY_HOLO_SELFTEST_HANDOFF ? process.env.VERIFY_HOLO_SELFTEST_HANDOFF : path.join(HERE, 'os-handoff.mjs');
const IME_SCRIPT = ST && process.env.VERIFY_HOLO_SELFTEST_IME ? process.env.VERIFY_HOLO_SELFTEST_IME : path.join(HERE, 'holo-ime.mjs');
const IME_STUB = ST && !!process.env.VERIFY_HOLO_SELFTEST_IME; // the fake holo-ime needs no seeded lab server
const TIMEOUT_MS = ST && process.env.VERIFY_HOLO_SELFTEST_TIMEOUT_MS ? Number(process.env.VERIFY_HOLO_SELFTEST_TIMEOUT_MS) : 40 * 60 * 1000;
const BASE_FAIL = ST && process.env.VERIFY_HOLO_SELFTEST_BASE_FAIL ? process.env.VERIFY_HOLO_SELFTEST_BASE_FAIL : null; // the base (main) side cannot be started / built
const FAKE_PASS = ST && process.env.VERIFY_HOLO_SELFTEST_FAKEPASS === '1'; // every item is a fake PASS: proves a stubbed all-PASS run still never exits 0
const BASELINE_FILE = ST && process.env.VERIFY_HOLO_SELFTEST_BASELINE ? process.env.VERIFY_HOLO_SELFTEST_BASELINE : path.join(HERE, 'holo-baseline.json');
const BUNDLE_SCRIPT = ST && process.env.VERIFY_HOLO_SELFTEST_BUNDLE ? process.env.VERIFY_HOLO_SELFTEST_BUNDLE : path.join(HERE, 'os-bundle.mjs'); // the script that measures the entry size of BOTH sides (entry-delta-vs-base)
/** { "<item id>": "PASS|FAIL|INVALID|SKIP" }: that item is a fake with this status, every other item is a fake PASS (needs the hook, like FAKEPASS). null = off. Proves the stage logic without running anything. */
let FAKE_STATUS = null;
if (ST && process.env.VERIFY_HOLO_SELFTEST_FAKESTATUS) {
  try { FAKE_STATUS = JSON.parse(process.env.VERIFY_HOLO_SELFTEST_FAKESTATUS); } catch { console.error('verify-holo: VERIFY_HOLO_SELFTEST_FAKESTATUS is not JSON; ignored'); }
}
if (A['dump-hooks']) {
  // prints and exits: writes nothing (no verify-holo.json, no --out folder, no scratch folder). verify-holo.selftest.mjs (g1) proves it.
  console.log(JSON.stringify({ st: ST, handoffScript: path.basename(HANDOFF_SCRIPT), imeScript: path.basename(IME_SCRIPT), imeStub: IME_STUB, timeoutMs: TIMEOUT_MS, baseFail: BASE_FAIL, fakePass: FAKE_PASS, baselineFile: path.basename(BASELINE_FILE),
    bundleScript: path.basename(BUNDLE_SCRIPT), fakeStatus: FAKE_STATUS,
    // holo-ime.mjs reads this hook itself (HOLO_IME_SELFTEST_CDP); the rule lives in ime-env.mjs imeCdpModule() so holo-ime and this table cannot drift apart. null = the real cdp.mjs is used.
    imeCdpModule: (() => { const m = imeCdpModule(process.env); return m === './cdp.mjs' ? null : path.basename(m); })() }));
  process.exit(0);
}

const REAL = '工作' + '日誌'; // real-data folder name, assembled so this file never contains the literal
const OUT = path.resolve(A.out);
const LOGS = path.join(OUT, 'logs');
// every refusal comes BEFORE the first thing this script creates (the --out folder, the scratch folder): a refused run leaves nothing behind (self-test g6, h-3)
if (OUT.includes(REAL) || REPO.includes(REAL)) { console.error('verify-holo: refusing a path that contains the real-data folder name'); process.exit(2); }
/** the --base cache: os.tmpdir()/pld-vh-cache, or VERIFY_HOLO_CACHE_DIR (absolute only); never the real-data folder, never inside this repo or the --base worktree */
const CACHE_DIR = process.env.VERIFY_HOLO_CACHE_DIR ?? path.join(os.tmpdir(), 'pld-vh-cache');
{
  const why = cacheDirProblem(CACHE_DIR, { real: REAL, forbiddenRoots: [REPO, A.base ? path.resolve(A.base) : null] });
  if (why) { console.error(`verify-holo: refusing the cache directory (${why}); VERIFY_HOLO_CACHE_DIR must be an absolute path outside this repo and the --base worktree`); process.exit(2); }
}
fs.mkdirSync(LOGS, { recursive: true });
const rel = (p) => path.relative(OUT, p).split(path.sep).join('/');
/** how a --base path is shown in logs / messages / json: never the absolute path (it can contain a user name), only the last folder */
const shortBase = () => `…/${path.basename(path.resolve(A.base))}`;
/** text of any evidence file: every spelling of the absolute --base path (as given, resolved, / or \, JSON-escaped \, mixed slashes) becomes shortBase(); scrub.mjs. The same function scrubs the whole --out folder (scrubOut). */
const scrubBase = (t) => (A.base ? scrubPathText(t, { given: A.base, resolved: path.resolve(A.base), shortName: shortBase() }) : String(t));
/** F2: after every item (and at the end) rewrite every file under --out that still contains the --base path: logs, the sub-scripts' raw JSON (entry-delta-base.json `dist`, c1 / os-e2e results...), anything. */
const scrubOut = () => { if (A.base) scrubTree(OUT, scrubBase); };
const BL = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
// The B group reads `git diff <diff-base>...HEAD` (commits only), while every other item judges the working tree. A dirty tree makes them judge different programs, so B is INVALID then.
const DIRTY = (spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' }).stdout ?? '').split('\n').filter(Boolean);
const dirtyInvalid = (L, th) => {
  L.append(`working tree is not clean (${DIRTY.length} entries):\n${DIRTY.slice(0, 20).join('\n')}\n`);
  return { status: 'INVALID', value: { dirty: true, entries: DIRTY.slice(0, 10) }, threshold: th, reason: `working tree not clean (${DIRTY.length} entries): commit first, this item only sees main...HEAD` };
};
/** a result file written by an EARLIER run must never be read as this run's: delete it before every child process that is supposed to write it */
const clearOut = (...files) => { for (const f of files) fs.rmSync(f, { force: true }); };
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE_ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', NO_OPEN_BROWSER: '1' };
delete BASE_ENV.WEB_DIST_DIR; delete BASE_ENV.WEB_OUT_DIR; delete BASE_ENV.VITE_HOLO_LAB;

// ------------------------------------------------------------------ process bookkeeping (everything is killed on any exit)
// SCRATCH is created only after every early exit (help, unknown id, hook refusal, real-data path): a refused run leaves no pld-vh-* folder in os.tmpdir() (self-test h1)
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'pld-vh-'));
const live = new Set();
const markers = new Set();
function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch { /* already gone */ }
}
function cleanupAll() {
  for (const c of live) killTree(c);
  live.clear();
  for (const m of markers) { try { fs.unlinkSync(m); } catch { /* ignore */ } }
  try { fs.rmSync(SCRATCH, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ }
}
let interrupted = false;
process.on('exit', cleanupAll);
process.on('SIGINT', () => { interrupted = true; cleanupAll(); finish('interrupted by SIGINT'); });
process.on('SIGTERM', () => { interrupted = true; cleanupAll(); finish('interrupted by SIGTERM'); });

// ------------------------------------------------------------------ results
const items = ITEM_DEFS.map(([id, group, timeSensitive = false]) => ({ id, group, timeSensitive, status: 'SKIP', value: null, threshold: null, durationMs: 0, log: null, reason: 'not run' }));
const itemOf = (id) => items.find((i) => i.id === id);
const startedAt = new Date().toISOString();
const gitOut = (args, cwd = REPO) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }); return r.status === 0 ? r.stdout.trim() : null; };
const head = gitOut(['rev-parse', '--short', 'HEAD']);
const baseHead = A.base ? gitOut(['rev-parse', '--short', 'HEAD'], path.resolve(A.base)) : null;
let renderer = null;

// Suspend detection (Windows Modern Standby freezes node and Chrome together): wall-clock heartbeat every 5 s; a gap > 60 s = suspended. Pure logic: suspend.mjs.
const heartbeats = [Date.now()];
const beat = () => { heartbeats.push(Date.now()); };
setInterval(beat, HEARTBEAT_MS).unref();
function writeJson(extra = {}) {
  beat();
  const gaps = findGaps(heartbeats).map((g) => ({ start: clock(g.startMs), startedAt: new Date(g.startMs).toISOString(), seconds: g.seconds }));
  const json = {
    schema: 1, startedAt, finishedAt: extra.finishedAt ?? null, head, base: A.base ? { head: baseHead } : null, diffBase: A['diff-base'],
    dirty: DIRTY.length > 0, args: { quick: A.quick, full: A.full, only: A.only ?? null, allowSoftware: A['allow-software'], hasBase: !!A.base, noCache: A['no-cache'], noFailFast: A['no-fail-fast'] }, renderer, failFast,
    ...(ST ? { selftest: true } : {}), suspended: gaps.length > 0, suspendedGaps: gaps, baselineFile: 'scripts/verify/holo-baseline.json', baseline: BL, summary: summarize(), items, ...extra,
  };
  fs.writeFileSync(path.join(OUT, 'verify-holo.json'), JSON.stringify(json, null, 2));
}
function summarize() {
  const by = (s) => items.filter((i) => i.status === s).map((i) => i.id);
  const na = by('N/A'); // not applicable in this invocation (os-handoff-4x without --full): not counted, not an incomplete run
  return { total: items.length - na.length, pass: by('PASS').length, fail: by('FAIL'), skip: by('SKIP'), invalid: by('INVALID'), notApplicable: na };
}
/** B2: the full version runs the quick stage (groups A and B) first; {enabled, triggered, by:[ids of A/B items that were FAIL or INVALID]}. enabled=false for --quick / --no-fail-fast. */
const failFast = { enabled: !A.quick && !A['no-fail-fast'], triggered: false, by: [] };
let finished = false;
function finish(why = null) {
  if (finished) return; finished = true;
  if (why) for (const i of items) if (i.reason === 'not run') i.reason = why;
  const s = summarize();
  // test hooks active: never PASS, never exit 0. A FAIL keeps exit 1 (the more informative non-zero code; callers that test for "not 0" are safe either way), everything else is 2.
  const code = overallExit({ fail: s.fail, skip: s.skip, invalid: s.invalid, selftest: ST, incomplete: !!why });
  writeJson({ finishedAt: new Date().toISOString(), exitCode: code });
  scrubOut();
  const parts = [`${s.pass}/${s.total} pass`];
  if (s.fail.length) parts.push(`${s.fail.length} fail (${s.fail.join(', ')})`);
  if (s.skip.length) parts.push(`${s.skip.length} skip (${s.skip.join(', ')})`);
  if (s.invalid.length) parts.push(`${s.invalid.length} invalid (${s.invalid.join(', ')})`);
  if (s.notApplicable.length) parts.push(`${s.notApplicable.length} n/a (${s.notApplicable.join(', ')})`);
  if (failFast.triggered) parts.push(`FAIL-FAST: C and D not run because the quick stage failed (${failFast.by.join(', ')}); --no-fail-fast runs them anyway`);
  const sg = findGaps(heartbeats);
  if (sg.length) parts.push(`SUSPENDED ${sg.length}x (${sg.map((g) => `${g.seconds}s at ${clock(g.startMs)}`).join(', ')}): rerun required`);
  const label = ST ? 'SELFTEST' : s.fail.length ? 'FAIL' : code === 0 ? 'PASS' : 'INCOMPLETE';
  const jsonPath = path.relative(process.cwd(), path.join(OUT, 'verify-holo.json')).split(path.sep).join('/');
  cleanupAll();
  console.log(`VERIFY:HOLO ${label} ${parts.join(', ')} — ${jsonPath}`);
  process.exit(code);
}

// ------------------------------------------------------------------ per-item context
class Invalid extends Error {}
const invalid = (m) => new Invalid(m);
class BaseSide extends Error {}
function makeCtx(id) {
  const file = path.join(LOGS, `${id}.log`);
  fs.writeFileSync(file, '');
  const append = (t) => fs.appendFileSync(file, scrubBase(t));
  const ctx = { id, file, append, timedOut: false };
  /** run a command, append its output to this item's log, return { code, text } */
  const run = (label, file2, args, { cwd = REPO, env = {}, shell = false, timeoutMs = TIMEOUT_MS } = {}) => new Promise((resolve) => {
    append(`\n$ ${label}\n`);
    const child = spawn(file2, args, { cwd, env: { ...BASE_ENV, ...env }, shell, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    live.add(child);
    let text = '';
    const onData = (d) => { const s = d.toString(); text += s; append(s); };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    const timer = setTimeout(() => { append('\n[verify-holo: timeout, killing]\n'); ctx.timedOut = true; killTree(child); }, timeoutMs);
    child.on('error', (e) => { append(`\n[spawn error: ${e.message}]\n`); });
    child.on('close', (code) => { clearTimeout(timer); live.delete(child); append(`\n[exit ${code}]\n`); resolve({ code, text: text.replace(ANSI, '') }); });
  });
  const npm = (cmd, env = {}, cwd = REPO) => run(`npm ${cmd}`, `npm ${cmd}`, [], { env, shell: true, cwd });
  const node = (script, args, env = {}) => run(`node ${path.relative(REPO, script)} ${args.join(' ')}`, process.execPath, [script, ...args], { env });
  return Object.assign(ctx, { run, npm, node });
}
const num = (re, text) => { const m = re.exec(text); return m ? Number(m[1]) : null; };
const readJsonSafe = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// ------------------------------------------------------------------ shared steps (memoized: each runs at most once per verify)
const memo = new Map();
const once = (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); };
/** default build of this worktree -> web/dist (the ci-build item shares this result) */
const defaultBuild = (L) => once('build', async () => (ST || (await L.npm('run build')).code === 0));
const LAB_DIST = path.join(SCRATCH, 'dist-holo-lab');
const labBuild = (L) => once('labbuild', async () => (await L.npm('run build', { VITE_HOLO_LAB: '1', WEB_OUT_DIR: LAB_DIST })).code === 0);

const servers = new Map();
async function answers(port) { try { await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; } }
async function startServer(L, key, root, port, env = {}) {
  if (servers.has(key)) return servers.get(key);
  const p = (async () => {
    if (await answers(port)) throw invalid(`port ${port} already answers; refusing to reuse a server this run did not start`);
    const distDir = env.WEB_DIST_DIR ?? path.join(root, 'web', 'dist');
    if (!fs.existsSync(path.join(distDir, 'index.html'))) throw invalid(`no build output at ${distDir}`);
    L.append(`\n[start server ${key}: serve.mjs --root ${key === 'base' ? shortBase() : root} --port ${port}]\n`);
    const child = spawn(process.execPath, [path.join(HERE, 'serve.mjs'), '--root', root, '--port', String(port), '--scratch', SCRATCH], {
      env: { ...BASE_ENV, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    live.add(child);
    markers.add(path.join(SCRATCH, `serve-${port}.json`));
    child.stdout.on('data', (d) => L.append(`[serve ${port}] ${d}`)); child.stderr.on('data', (d) => L.append(`[serve ${port}] ${d}`));
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw invalid(`serve.mjs exited with ${child.exitCode} (port ${port})`);
      if (fs.existsSync(path.join(SCRATCH, `serve-${port}.json`)) && await answers(port)) break;
      await sleep(300);
      if (i === 99) throw invalid(`server on ${port} did not come up`);
    }
    assertScratchServer(`http://localhost:${port}/`, SCRATCH); // throws unless serve.mjs's marker proves a scratch copy
    return `http://localhost:${port}/`;
  })();
  servers.set(key, p);
  return p;
}
const mainServer = (L) => (ST ? Promise.resolve('http://localhost:0/') : startServer(L, 'branch', REPO, 3114));
const baseServer = async (L) => {
  const root = path.resolve(A.base);
  if (!fs.existsSync(path.join(root, 'backend', 'server.js'))) throw invalid(`--base ${shortBase()} has no backend/server.js`); // checked before the self-test stub too (self-test g7): the message shows the last folder only
  if (ST) { if (BASE_FAIL) throw invalid(BASE_FAIL); return 'http://localhost:0/'; }
  if (!(await ensureBaseBuild(L)).ok) throw invalid('could not build the --base worktree');
  return startServer(L, 'base', root, 3115);
};
const labServer = async (L) => {
  if (!(await labBuild(L))) throw invalid('lab build failed (VITE_HOLO_LAB=1)');
  return startServer(L, 'lab', REPO, 3116, { WEB_DIST_DIR: LAB_DIST });
};
let seededN = null;
async function ensureSeed(L, n) {
  const url = await labServer(L);
  if (seededN === n) return url;
  const r = await L.node(path.join(HERE, 'holo-seed.mjs'), ['3116', String(n), '--scratch', SCRATCH]);
  if (r.code !== 0) throw invalid(`holo-seed ${n} failed (exit ${r.code})`);
  seededN = n;
  return url;
}
const SOFTWARE = /swiftshader|llvmpipe|software|no-webgl/i;
/** one headed probe of the WebGL renderer, so that --allow-software runs can be labelled */
async function probeRenderer() {
  return once('renderer', async () => {
    try {
      const b = await Browser.launch({ port: 9671, headless: false });
      live.add(b.proc);
      try { const p = await b.newPage({ width: 800, height: 600 }); await p.goto('about:blank', { settle: 100 }); renderer = String(await p.webglRenderer()); } finally { await b.close(); live.delete(b.proc); }
    } catch (e) { renderer = `probe failed: ${e.message}`; }
    return renderer;
  });
}
/** D items: a software renderer can never PASS (exit 2 path); with --allow-software the numbers are shown but the status is INVALID */
async function softwareGuard(res) {
  if (res.status !== 'PASS' || !A['allow-software']) return res;
  const r = await probeRenderer();
  if (SOFTWARE.test(r)) return { ...res, status: 'INVALID', reason: `software renderer (${r}) allowed by --allow-software: numbers are not authoritative` };
  return res;
}

// ------------------------------------------------------------------ A: CI
const pass = (value, threshold, extra = {}) => ({ status: 'PASS', value, threshold, ...extra });
const fail = (value, threshold, reason) => ({ status: 'FAIL', value, threshold, reason });

async function ciSimple(L, cmd) {
  const r = await L.npm(cmd);
  return r.code === 0 ? pass({ exit: 0 }, { exit: 0 }) : fail({ exit: r.code }, { exit: 0 }, `exit ${r.code}`);
}
async function ciTest(L) {
  const r = await L.npm('test');
  const v = { exit: r.code, tests: num(/^ℹ tests (\d+)/m, r.text) ?? num(/^# tests (\d+)/m, r.text), pass: num(/^ℹ pass (\d+)/m, r.text) ?? num(/^# pass (\d+)/m, r.text),
    fail: num(/^ℹ fail (\d+)/m, r.text) ?? num(/^# fail (\d+)/m, r.text), skipped: num(/^ℹ skipped (\d+)/m, r.text) ?? num(/^# skipped (\d+)/m, r.text) };
  const th = { exit: 0, fail: 0, passMin: BL.backend.pass, skippedMax: BL.backend.skipped, testsMin: BL.backend.tests };
  if (v.pass == null || v.fail == null || v.skipped == null) throw invalid('could not parse the node:test summary');
  const bad = [];
  if (r.code !== 0) bad.push(`exit ${r.code}`);
  if (v.fail !== 0) bad.push(`fail ${v.fail}`);
  if (v.pass < th.passMin) bad.push(`pass ${v.pass} < baseline ${th.passMin}`);
  if (v.skipped > th.skippedMax) bad.push(`skipped ${v.skipped} > baseline ${th.skippedMax}`);
  if (v.tests < th.testsMin) bad.push(`tests ${v.tests} < baseline ${th.testsMin}`);
  return bad.length ? fail(v, th, bad.join('; ')) : pass(v, th);
}
async function ciTestWeb(L) {
  const r = await L.npm('run test:web');
  const tm = /Tests\s+(.*?)\((\d+)\)/.exec(r.text), fm = /Test Files\s+(.*?)\((\d+)\)/.exec(r.text);
  if (!tm || !fm) throw invalid('could not parse the vitest summary');
  const cnt = (s, w) => num(new RegExp(`(\\d+) ${w}`), s) ?? 0;
  const v = { exit: r.code, tests: +tm[2], testsPassed: cnt(tm[1], 'passed'), testsFailed: cnt(tm[1], 'failed'), testsSkipped: cnt(tm[1], 'skipped'), files: +fm[2], filesFailed: cnt(fm[1], 'failed') };
  const th = { exit: 0, failed: 0, testsMin: BL.web.tests, filesMin: BL.web.files, skippedMax: BL.web.skipped };
  const bad = [];
  if (r.code !== 0) bad.push(`exit ${r.code}`);
  if (v.testsFailed !== 0 || v.filesFailed !== 0) bad.push(`failed tests ${v.testsFailed}, failed files ${v.filesFailed}`);
  if (v.tests < th.testsMin) bad.push(`tests ${v.tests} < baseline ${th.testsMin}`);
  if (v.files < th.filesMin) bad.push(`files ${v.files} < baseline ${th.filesMin}`);
  if (v.testsSkipped > th.skippedMax) bad.push(`skipped ${v.testsSkipped} > baseline ${th.skippedMax}`);
  return bad.length ? fail(v, th, bad.join('; ')) : pass(v, th);
}
async function ciBuild(L) {
  const ok = await defaultBuild(L);
  return ok ? pass({ exit: 0 }, { exit: 0 }) : fail({ exit: 1 }, { exit: 0 }, 'npm run build failed');
}
async function ciBundle(L) {
  if (!(await defaultBuild(L))) throw invalid('default build failed: the bundle check needs web/dist');
  const json = path.join(OUT, 'ci-bundle.json');
  clearOut(json);
  const r = await L.npm(`run verify:os-bundle -- --json "${json}"`);
  const j = readJsonSafe(json);
  const v = { exit: r.code, entryGzip: j?.entryGzip ?? null, baseline: j?.baseline ?? null, deltaBytes: j && j.baseline != null ? j.entryGzip - j.baseline : null, osLazyGzip: j?.osLazyGzip ?? null, fails: j?.fails ?? null };
  const th = { exit: 0, entryDeltaMaxBytes: 2048 };
  return r.code === 0 ? pass(v, th) : fail(v, th, `os-bundle exit ${r.code}`);
}
/** builds the --base worktree in place; BASE_FAIL (self-test hook, null otherwise) simulates a failed build */
const buildBase = async (L, root) => (BASE_FAIL ? false : (await L.npm('run build', {}, root)).code === 0);

// ---- B1: the --base side by commit (base-cache.mjs). Only the base side; the branch side is never cached.
const CACHE_ON = !A['no-cache'];
/** the cache key of the --base worktree right now. mode 'on' = key available; 'off' = no key (reason says why: --no-cache, not a git worktree, dirty): nothing is read, nothing is written. */
function baseCacheInfo(root) {
  if (!CACHE_ON) return { mode: 'off', reason: '--no-cache' };
  const headFull = gitOut(['rev-parse', 'HEAD'], root);
  const status = gitOut(['status', '--porcelain'], root);
  if (!headFull || status === null) return { mode: 'off', reason: 'base worktree is not a readable git worktree' };
  if (status !== '') return { mode: 'off', reason: `base worktree is not clean (${status.split('\n').length} entries): a dirty worktree is never cached` };
  // F1: build inputs that git does not see. (1) the installed tree: node_modules/.package-lock.json is what `npm install` really put on disk (package-lock.json only says what was asked for); without it the
  // installed tree has no identity, so there is no key. (2) every .env* file Vite can read (vite root = web/, no envDir; the repo root too, to be strict) plus the VITE_* / NODE_ENV variables of this process.
  const nodeModulesHash = hashFile(path.join(root, 'node_modules', '.package-lock.json'));
  if (nodeModulesHash === 'missing') return { mode: 'off', reason: 'base node_modules/.package-lock.json is missing: the installed tree has no identity, so it is not cached' };
  const key = buildKey({
    baseHead: headFull, clean: true, lockHash: hashFile(path.join(root, 'package-lock.json')), node: process.version,
    nodeModulesHash, envHash: hashEnvInputs({ dirs: [path.join(root, 'web'), root], env: process.env }),
    scripts: { 'os-bundle.mjs': hashFile(path.join(HERE, 'os-bundle.mjs')), 'bundle-graph.mjs': hashFile(path.join(HERE, 'bundle-graph.mjs')), 'holo-baseline.json': hashFile(BASELINE_FILE) }, params: MEASURE_ID,
  });
  if (!key) return { mode: 'off', reason: 'no cache key could be built' };
  return { mode: 'on', key };
}
/** json-friendly record of what the cache did for the base side (verify-holo.json, item value.baseCache) */
const cacheSummary = (b, extra = {}) => ({ mode: b.info.mode, ...(b.info.mode === 'off' ? { reason: b.info.reason } : { keyDigest: b.info.key.digest.slice(0, 16), key: { ...b.info.key.summary, baseHead: b.info.key.summary.baseHead.slice(0, 12), lockHash: b.info.key.summary.lockHash.slice(0, 12), nodeModulesHash: b.info.key.summary.nodeModulesHash.slice(0, 12), envHash: b.info.key.summary.envHash.slice(0, 12), scripts: Object.fromEntries(Object.entries(b.info.key.summary.scripts).map(([k, h]) => [k, h.slice(0, 12)])) } }), ...extra });
/** makes sure the --base worktree has a web/dist that is the build of its current commit (memoized; both the c1 server and entry-delta-vs-base call it).
 *  cache on: a stored dist hash must equal the hash of the dist that is there now, else it is rebuilt; no key (dirty / --no-cache): always rebuilt, nothing stored. */
const ensureBaseBuild = (L) => once('basebuild', async () => {
  const root = path.resolve(A.base);
  const dist = path.join(root, 'web', 'dist');
  const info = baseCacheInfo(root);
  const out = { ok: false, info, entry: null, distHash: null, buildCached: false };
  if (info.mode === 'on') {
    const entry = readEntry(CACHE_DIR, info.key);
    const now = fs.existsSync(path.join(dist, 'index.html')) ? hashDir(dist) : null;
    if (entry && now && entry.distHash === now) {
      L.append(`\n[base build: CACHED (key ${info.key.digest.slice(0, 16)}, built ${entry.builtAt}); web/dist hash matches]\n`);
      return { ...out, ok: true, entry, distHash: now, buildCached: true };
    }
    L.append(`\n[base build: ${entry ? 'cache entry found but web/dist differs from it' : 'no usable cache entry'}: building the --base worktree in place (no source change)]\n`);
  } else L.append(`\n[base build: cache off (${info.reason}): building the --base worktree in place (no source change)]\n`);
  if (!(await buildBase(L, root))) return out;
  if (!fs.existsSync(path.join(dist, 'index.html'))) { L.append('[base build produced no web/dist/index.html]\n'); return out; }
  if (info.mode !== 'on') return { ...out, ok: true };
  const distHash = hashDir(dist);
  const entry = { distHash, builtAt: new Date().toISOString(), entryGzip: null, measuredAt: null };
  if (!writeEntry(CACHE_DIR, info.key, entry)) L.append('[base cache: could not write the entry (continuing without it)]\n');
  return { ...out, ok: true, entry, distHash };
});
async function entryDeltaVsBase(L) {
  const th = { entryDeltaVsBaseMaxBytes: BL.entry.deltaVsBaseMaxBytes };
  if (!A.base) return { status: 'SKIP', value: null, threshold: th, reason: 'no --base given' };
  if (!(await defaultBuild(L))) throw invalid('default build failed');
  const root = path.resolve(A.base);
  if (!fs.existsSync(root)) return baseSideFail(invalid(`--base ${shortBase()} does not exist`), th);
  const b = await ensureBaseBuild(L);
  if (!b.ok) return baseSideFail(invalid('could not build the --base worktree'), th);
  // same measuring code for both sides (this worktree's os-bundle.mjs: gzip -9 of the entry static-graph JS)
  const measure = async (label, dist) => {
    const json = path.join(OUT, `entry-delta-${label}.json`);
    clearOut(json);
    await L.node(BUNDLE_SCRIPT, ['--dist', dist, '--json', json]); // its own exit code (bundle-baseline) is not this item's concern
    const j = readJsonSafe(json);
    if (!j || typeof j.entryGzip !== 'number') throw (label === 'base' ? new BaseSide(`os-bundle wrote no entryGzip for base`) : invalid(`os-bundle wrote no entryGzip for ${label}`));
    return j.entryGzip;
  };
  const branch = await measure('branch', path.join(REPO, 'web', 'dist')); // never cached
  let base, cached = false, measuredAt = null;
  const e = b.entry;
  if (b.info.mode === 'on' && e && e.entryGzip !== null && e.distHash === b.distHash) { // readEntry() already validated the shape; the dist hash was compared in ensureBaseBuild
    base = e.entryGzip; cached = true; measuredAt = e.measuredAt;
    L.append(`\n[base entry size: CACHED ${base} B (measured ${measuredAt}, key ${b.info.key.digest.slice(0, 16)})]\n`);
  } else {
    try { base = await measure('base', path.join(root, 'web', 'dist')); } catch (err) { if (err instanceof BaseSide) return baseSideFail(err, th); throw err; }
    measuredAt = new Date().toISOString();
    if (b.info.mode === 'on' && b.entry && !writeEntry(CACHE_DIR, b.info.key, { ...b.entry, entryGzip: base, measuredAt })) L.append('[base cache: could not write the entry (continuing without it)]\n');
  }
  const v = { branchEntryGzip: branch, baseEntryGzip: base, deltaBytes: branch - base, cached, measuredAt, baseCache: cacheSummary(b, { entryCached: cached, buildCached: b.buildCached }) };
  return v.deltaBytes > th.entryDeltaVsBaseMaxBytes ? fail(v, th, `web entry gzip +${v.deltaBytes} B vs base > +${th.entryDeltaVsBaseMaxBytes} B (stop and ask the designer if H2 would push the total past 2048 B over bundle-baseline.json)`) : pass(v, th);
}

// ------------------------------------------------------------------ B: static red lines
const MB = () => gitOut(['merge-base', A['diff-base'], 'HEAD']);
async function testsUntouched(L) {
  if (DIRTY.length) return dirtyInvalid(L, { onlyStatus: 'A' });
  const r = spawnSync('git', ['diff', '--name-status', `${A['diff-base']}...HEAD`, '--', '*.test.*'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw invalid(`git diff ${A['diff-base']}...HEAD failed: ${r.stderr.trim()}`);
  L.append(r.stdout || '(no test file changes)\n');
  const rows = r.stdout.split('\n').filter(Boolean).map((l) => { const [st, ...f] = l.split('\t'); return { st, files: f }; });
  const added = rows.filter((x) => x.st === 'A').length;
  const bad = rows.filter((x) => x.st !== 'A');
  const v = { added, notAdded: bad.map((x) => `${x.st} ${x.files.join(' -> ')}`) };
  return bad.length ? fail(v, { onlyStatus: 'A' }, `existing test files changed: ${v.notAdded.join('; ')}`) : pass(v, { onlyStatus: 'A' });
}
/** parse `git diff -U0` into added lines with file and line number */
function addedLines() {
  const r = spawnSync('git', ['diff', '-U0', '--no-color', '--no-ext-diff', `${A['diff-base']}...HEAD`], { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw invalid(`git diff failed: ${r.stderr.trim()}`);
  const out = []; let file = null, ln = 0;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('+++ ')) { file = line.startsWith('+++ b/') ? line.slice(6) : null; continue; }
    const h = /^@@ -\S+ \+(\d+)/.exec(line);
    if (h) { ln = +h[1]; continue; }
    if (file && line.startsWith('+') && !line.startsWith('+++')) { out.push({ file, ln, text: line.slice(1) }); ln++; }
  }
  return out;
}
const CODE_EXT = /\.(?:[cm]?[jt]sx?|css)$/;
async function redlineGrep(L) {
  if (DIRTY.length) return dirtyInvalid(L, 'all counts 0');
  const hits = { r1: [], r2: [], r3: [], r4: [], r5: [] };
  const lines = addedLines();
  // 1: View Transitions (code files only)
  const vt = new RegExp(['start', 'ViewTransition'].join('') + '|' + ['view', 'Transition'].join(''));
  for (const l of lines) if (CODE_EXT.test(l.file) && vt.test(l.text)) hits.r1.push(`${l.file}:${l.ln}`);
  // 2: the theme preference key as a quoted string anywhere outside theme.ts and tests (ts/tsx/js/mjs, comment lines excluded). Catches aliases, st.setItem, line breaks, ["setItem"].
  // Comments are removed by a real scanner over the WHOLE file (redline-rules.mjs: block-comment state across lines, strings kept), not by "this line starts with *":
  // `*/ set("...")` is code, and a line inside a multi-line block comment is a comment whatever it starts with. Self-test: redline-rules.selftest.mjs.
  const r2Files = new Map();
  for (const l of lines) if (/\.(?:[cm]?[jt]sx?)$/.test(l.file) && l.file !== 'web/src/lib/theme.ts' && !/\.test\.[^/]+$/.test(l.file)) { if (!r2Files.has(l.file)) r2Files.set(l.file, []); r2Files.get(l.file).push(l.ln); }
  for (const [f, lns] of r2Files) {
    const p = path.join(REPO, f); if (!fs.existsSync(p)) continue;
    for (const ln of themeKeyLines(fs.readFileSync(p, 'utf8'), lns)) hits.r2.push(`${f}:${ln}`);
  }
  // 3a: personal absolute paths / real-data folder name in NEW files (patterns assembled so this file never contains them)
  const PERSONAL_EXTRA = ['One' + 'Drive', REAL];
  const added = (gitOut(['diff', '--name-only', '--diff-filter=A', `${A['diff-base']}...HEAD`]) ?? '').split('\n').filter(Boolean);
  for (const f of added) {
    const p = path.join(REPO, f); if (!fs.existsSync(p)) continue;
    const buf = fs.readFileSync(p); if (buf.includes(0)) continue;
    const txt = buf.toString('utf8');
    txt.split('\n').forEach((t, i) => { if (personalHit(t, PERSONAL_EXTRA)) hits.r3.push(`${f}:${i + 1}`); });
  }
  // 3b: user-profile style paths in the ADDED LINES of every file (the real-data folder name and the cloud-sync folder name legitimately appear in prose, so they stay new-file-only)
  // (profile paths: any drive letter, any letter case, / or \ or escaped \\; see redline-rules.mjs)
  for (const l of lines) if (profilePathHit(l.text)) hits.r3.push(`${l.file}:${l.ln} (added line)`);
  // 4: dependency changes: the lockfile (any change), and every package.json field that can change what gets installed, against the merge base
  const mb = MB(); if (!mb) throw invalid(`no merge base with ${A['diff-base']}`);
  const lockDiff = (gitOut(['diff', '--name-only', `${A['diff-base']}...HEAD`, '--', 'package-lock.json', '*/package-lock.json']) ?? '').split('\n').filter(Boolean);
  for (const f of lockDiff) hits.r4.push(`${f}: lockfile changed`);
  const pkgs = (gitOut(['ls-files', '*package.json']) ?? '').split('\n').filter(Boolean);
  for (const f of pkgs) {
    const old = spawnSync('git', ['show', `${mb}:${f}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    let cur; try { cur = JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8')); } catch { hits.r4.push(`${f}: unreadable`); continue; }
    if (old.status !== 0) { hits.r4.push(`${f}: new package.json`); continue; }
    const o = JSON.parse(old.stdout);
    for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides', 'resolutions', 'workspaces', 'bundledDependencies', 'bundleDependencies']) if (JSON.stringify(o[k] ?? null) !== JSON.stringify(cur[k] ?? null)) hits.r4.push(`${f}: ${k} changed`);
  }
  // 5: shims must be pure re-exports (list = holo-baseline.json "shims", filled by the features/os/core/ move table in H2-6)
  const shims = BL.shims ?? [];
  const reexport = /^export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+["'][^"']+["']$/;
  for (const s of shims) {
    const p = path.join(REPO, s);
    if (!fs.existsSync(p)) { hits.r5.push(`${s}: missing`); continue; }
    const body = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const st of body.split(';').map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean)) if (!reexport.test(st)) hits.r5.push(`${s}: not a pure re-export: ${st.slice(0, 80)}`);
  }
  for (const [k, arr] of Object.entries(hits)) L.append(`${k}: ${arr.length ? '\n  ' + arr.join('\n  ') : 'none'}\n`);
  const v = { rule1ViewTransitions: hits.r1.length, rule2ThemeWrite: hits.r2.length, rule3PersonalPath: hits.r3.length, rule4Dependencies: hits.r4.length, rule5ShimNotPure: hits.r5.length, shimsChecked: shims.length, newFilesScanned: added.length };
  const all = Object.values(hits).flat();
  return all.length ? fail({ ...v, hits: all.slice(0, 30) }, 'all counts 0', `${all.length} red-line hit(s): ${all.slice(0, 5).join('; ')}`) : pass(v, 'all counts 0');
}

// ------------------------------------------------------------------ C: lab build, zero diff, OS regression
async function labBundle(L) {
  if (!(await labBuild(L))) throw invalid('lab build failed');
  const json = path.join(OUT, 'lab-bundle.json');
  clearOut(json);
  const r = await L.node(path.join(HERE, 'os-bundle.mjs'), ['--dist', LAB_DIST, '--expect-holo', '--json', json]);
  const j = readJsonSafe(json);
  const core = j?.groups?.find((g) => g.id === 'holo-core');
  // designer ruling 2026-11-19: the lab build's entry delta vs bundle-baseline.json is RECORDED here (labEntryGzip / labEntryBaseline / labEntryDeltaBytes), never judged: os-bundle --expect-holo does not apply P4a.
  // The shipped (default) build's entry delta is judged by ci-bundle, and A5-holo (no features/holo anywhere in the default build's dist) lives there too.
  const v = { exit: r.code, holoCoreGzip: core?.gzip ?? null, holoCoreLimit: core?.limit ?? null, labEntryGzip: j?.entryGzip ?? null, labEntryBaseline: j?.baseline ?? null, labEntryDeltaBytes: j?.deltaBytes ?? null, fails: j?.fails ?? null };
  const th = { exit: 0, holoCoreMaxBytes: BL.labBundle.holoCoreMaxBytes, labEntryDelta: 'recorded, not judged' };
  const bad = [];
  if (r.code !== 0) bad.push(`os-bundle --expect-holo exit ${r.code}`);
  if (core && core.gzip > th.holoCoreMaxBytes) bad.push(`holo-core ${core.gzip} > ${th.holoCoreMaxBytes}`);
  return bad.length ? fail(v, th, bad.join('; ')) : pass(v, th);
}
/** the --base (main) side could not be started or built: a zero-diff comparison with main is impossible. FAIL for every item that needs base (designer ruling), never INVALID. */
const baseSideFail = (e, th) => fail({ baseUnavailable: true }, th, `the base (main) side could not be started: ${e.message ?? String(e)}; this is a problem on the base side, so the result cannot be compared with main`);
async function c1Run(L, name, extraArgs, expectCombos) {
  if (!A.base) return { status: 'SKIP', value: null, threshold: { combos: expectCombos, diffs: 0, actFail: 0 }, reason: 'no --base given' };
  if (!(await defaultBuild(L))) throw invalid('default build failed');
  const branchUrl = await mainServer(L);
  let baseUrl;
  try { baseUrl = await baseServer(L); } catch (e) { return baseSideFail(e, { combos: expectCombos, diffs: 0, actFail: 0 }); }
  const dir = path.join(OUT, name);
  clearOut(path.join(dir, 'c1-result.json'));
  const r = await L.node(path.join(HERE, 'c1.mjs'), ['--base', baseUrl, '--new', branchUrl, '--out', dir, '--scratch', SCRATCH, ...extraArgs]);
  const j = readJsonSafe(path.join(dir, 'c1-result.json'));
  if (!j || r.code === null || r.code > 1) throw invalid(`c1 produced no result (exit ${r.code})`);
  const combos = Object.keys(j.res).length;
  const v = { diffs: j.total, actFail: j.actFails, combos, exit: r.code };
  const th = { diffs: 0, actFail: 0, combos: expectCombos };
  const bad = [];
  if (j.total !== 0) bad.push(`${j.total} diffs`);
  if (j.actFails !== 0) bad.push(`${j.actFails} ACTFAIL`);
  if (combos !== expectCombos) bad.push(`combos ${combos} != baseline ${expectCombos} (scenario list changed?)`);
  if (r.code !== 0 && !bad.length) bad.push(`c1 exit ${r.code}`);
  return bad.length ? fail(v, th, bad.join('; ')) : pass(v, th);
}
const c1Web = (L) => c1Run(L, 'c1-web', ['--theme', 'all', '--widths', '375,900,1280'], BL.c1.webCombos);
const c1Os = (L) => c1Run(L, 'c1-os', ['--theme', 'standard-light', '--scope', 'main', '--ignore-offset-y', '--widths', BL.c1.osWidths.join(','), '--scenarios', BL.c1.osScenarios.join(','),
  '--base-query', '?mode=os', '--new-query', '?mode=os'], BL.c1.osCombos);
async function osE2e(L) {
  if (!(await defaultBuild(L))) throw invalid('default build failed');
  const url = await mainServer(L);
  const dir = path.join(OUT, 'os-e2e');
  clearOut(path.join(dir, 'result.json'));
  const r = await L.node(path.join(HERE, 'os-e2e.mjs'), ['--url', url, '--scratch', SCRATCH, '--out', dir]);
  const j = readJsonSafe(path.join(dir, 'result.json'));
  if (!j) throw invalid(`os-e2e wrote no result.json (exit ${r.code})`);
  const v = { exit: r.code, pass: j.summary.pass, fail: j.summary.fail, skip: j.summary.skip, manual: j.summary.manual, notPass: j.rows.filter((x) => x.status !== 'PASS').map((x) => `${x.status} ${x.id}`) };
  const th = { fail: 0, skip: 0, passMin: BL.osE2e.pass, manualMax: BL.osE2e.manual };
  const bad = [];
  if (r.code !== 0 || v.fail) bad.push(`fail ${v.fail} (exit ${r.code})`);
  if (v.skip > th.skip) bad.push(`skip ${v.skip}`);
  if (v.pass < th.passMin) bad.push(`pass ${v.pass} < baseline ${th.passMin}`);
  if (v.manual > th.manualMax) bad.push(`manual ${v.manual} > baseline ${th.manualMax}`);
  if (v.fail) return fail(v, th, bad.join('; '));
  return bad.length ? { status: 'INVALID', value: v, threshold: th, reason: bad.join('; ') } : pass(v, th);
}
const countKnownOf = (cls) => cls.known.length;
/** runs os-handoff.mjs with args (baseline osHandoff.args + --throttles), judges 0 FAIL / samples / conclusive / DEVIATED cap */
async function osHandoffRun(L, dirName, throttle, B) {
  if (!(await defaultBuild(L))) throw invalid('default build failed');
  const url = await mainServer(L);
  const dir = path.join(OUT, dirName);
  clearOut(path.join(dir, 'result.json'));
  const hArgs = buildHandoffArgs(BL.osHandoff, url, dir, throttle);
  const r = await L.node(HANDOFF_SCRIPT, hArgs);
  const j = readJsonSafe(path.join(dir, 'result.json'));
  if (!j || r.code === null || r.code > 3) throw invalid(`os-handoff exit ${r.code}, no result.json`);
  // exit code and summary must agree (exit 2 = usage error, exit 3 with 0 DEVIATED, ...): otherwise os-handoff itself is broken: FAIL, never a pass
  const contradiction = handoffExitProblem(r.code, j.summary, { allowDeviated: handoffAllowsDeviated(hArgs) });
  if (contradiction) return fail({ throttle, exit: r.code, summary: j.summary ?? null }, { exitMatchesSummary: true }, `internal error: ${contradiction}`);
  // DEVIATED = the planned click offset was not reachable on this machine (README: inconclusive, never a pass, never a failure).
  // PASS needs 0 FAIL, samples >= B.samples, conclusive passes >= B.conclusiveMin, and DEVIATED <= B.deviatedMax (explicit) or, when the baseline gives none, floor(baselineDeviated x 1.5).
  const total = j.summary.total, failN = j.summary.fail, dev = j.summary.deviated;
  const devMax = B.deviatedMax ?? Math.floor(B.baselineDeviated * 1.5);
  const devWhy = B.deviatedMax != null ? `baseline deviatedMax ${B.deviatedMax}` : `baseline ${B.baselineDeviated} x 1.5`;
  const v = { throttle, exit: r.code, samples: total, conclusivePass: total - failN - dev, fail: failN, deviated: dev };
  const th = { fail: 0, conclusivePassMin: B.conclusiveMin, samplesMin: B.samples, deviatedMax: devMax, baselineDeviated: B.baselineDeviated };
  if (failN > 0 || r.code === 1) {
    const plain = fail(v, th, `${failN} failing sample(s)`);
    if (!B.knownOnMain?.length) return plain;                       // 1x os-handoff has no allowlist: always a plain FAIL
    const cls = classifyFails(j, B.knownOnMain);
    if (!cls.allKnown) return plain;                                // anything else (leak, swallowed input, non-I2, I2 not a phase timeout): FAIL, no comparison
    if (!A.base) return fail(v, th, `${failN} failing sample(s), all known I2 phase timeouts, but no --base was given so they cannot be compared with main: FAIL`);
    // designer ruling 2026-11-17: only I2 phase timeouts can be excused, and only if main shows them too in this same run
    const bdir = path.join(OUT, `${dirName}-base-i2`);
    let bUrl;
    try { bUrl = await baseServer(L); } catch (e) {
      // main's server could not be started or built: there is nothing to compare with. Always FAIL (a base-side problem must never excuse the branch's timeouts)
      const d = baseUnavailableDecision(countKnownOf(cls), e.message ?? String(e));
      L.append(`\n[${d.message}]\n`);
      return fail({ ...v, branchTimeouts: countKnownOf(cls), baseUnavailable: true }, th, d.message);
    }
    L.append(`\n[known-on-main: all ${failN} FAIL sample(s) are I2 phase timeouts; re-measuring I2 on main at CPU ${throttle}x, --reps ${B.knownOnMainReps}]\n`);
    clearOut(path.join(bdir, 'result.json'));
    const br = await L.node(HANDOFF_SCRIPT, buildHandoffArgs(BL.osHandoff, bUrl, bdir, throttle, ['--only', 'i2', '--reps', String(B.knownOnMainReps)]));
    const bj = readJsonSafe(path.join(bdir, 'result.json'));
    const dec = knownOnMainDecision({ branchResult: j, baseExit: br.code, baseResult: bj, allowlist: B.knownOnMain, logPath: `logs/${L.id}.log` });
    const baseEv = { ...dec.value, knownOnMain: dec.status === 'INVALID', baseFail: bj?.summary?.fail ?? null, baseEvidence: rel(path.join(bdir, 'result.json')), reps: B.knownOnMainReps };
    if (dec.status === 'INVALID') return { status: 'INVALID', value: { ...v, ...baseEv }, threshold: th, reason: dec.message };
    return fail({ ...v, ...baseEv }, th, dec.message);
  }
  if (dev > devMax) return { status: 'INVALID', value: v, threshold: th, reason: `DEVIATED ${dev} > ${devMax} (${devWhy}): the machine is not behaving like the baseline run; escalate to L2` };
  if (v.conclusivePass < th.conclusivePassMin || total < th.samplesMin) return { status: 'INVALID', value: v, threshold: th, reason: `only ${v.conclusivePass} conclusive pass(es) of ${total} samples (${dev} DEVIATED): need >= ${th.conclusivePassMin} and >= ${th.samplesMin} samples` };
  return pass(v, th);
}
const osHandoff = (L) => osHandoffRun(L, 'os-handoff', 1, BL.osHandoff);
const osHandoff4x = async (L) => {
  if (!A.full) return { status: 'N/A', value: null, threshold: null, reason: 'only with --full (CPU 4x, > 25 min)' };
  return osHandoffRun(L, 'os-handoff-4x', 4, BL.osHandoff4x);
};

// ------------------------------------------------------------------ D: lab scripts (headed Chrome, real GPU)
const swFlag = () => (A['allow-software'] ? ['--allow-software'] : []);
/** holo-ime: environmental exceptions (ime-env.mjs) are INVALID, never FAIL, but never silently: ONE in-place retry (decision recorded in README "holo-ime environmental exceptions").
 *  Why retry here and not inside holo-ime.mjs: this is where the verdict is made, and the first attempt's result.json can be kept next to the retry's (result.attempt1.json). */
async function holoIme(L) {
  const url = IME_STUB ? 'http://localhost:0/' : await ensureSeed(L, BL.seed.records);
  const dir = path.join(OUT, 'holo-ime');
  const attempt = async () => {
    clearOut(path.join(dir, 'result.json'));
    const r = await L.node(IME_SCRIPT, buildImeArgs(url, dir));
    const j = readJsonSafe(path.join(dir, 'result.json'));
    return { r, j, a: summarizeAttempt(r.code, j) };
  };
  const th = { failed: 0, checksMin: BL.holoIme.checks };
  let { r, j, a } = await attempt();
  const diagOf = (jj) => (jj ? { diag: jj.diag ?? null, ...(jj.diagFull ? { diagFull: 'see holo-ime/result.json' } : {}) } : {});
  if (r.code === 2 && envKindOf(a)) {
    L.append(`
[holo-ime: first run ended in an environmental exception (${a.envError.kind} at ${a.envError.step}); retrying once in place]
`);
    try { fs.copyFileSync(path.join(dir, 'result.json'), path.join(dir, 'result.attempt1.json')); } catch { /* keep going */ }
    const second = await attempt();
    const jd = judgeRetry(a, second.a);
    const value = { exit: second.r.code, checks: second.a.checks, failed: second.a.failed, invalid: second.a.invalid, retried: true, firstAttempt: jd.firstAttempt, retry: second.a, ...diagOf(second.j) };
    L.append(`
[holo-ime: ${jd.status}: ${jd.reason}]
`);
    return { status: jd.status, value, threshold: th, reason: jd.reason };
  }
  const v = { exit: r.code, checks: a.checks, failed: a.failed, invalid: a.invalid, retried: false, ...diagOf(j) };
  if (r.code === 2 && j?.envError) return fail(v, th, `holo-ime reported an environmental exception of kind ${JSON.stringify(j.envError.kind)} which is not on the list (ime-env.mjs ENV_ERROR_KINDS): FAIL`);
  if (r.code === 2) return { status: 'INVALID', value: v, threshold: th, reason: j?.invalid ?? (j?.envError ? `environmental exception ${j.envError.kind} (not retried)` : 'holo-ime exit 2') };
  if (r.code === 1) return fail(v, th, `${v.failed} failing check(s): ${(j?.results ?? []).filter((x) => !x.pass).map((x) => x.name).slice(0, 3).join(' | ')}`);
  if (r.code !== 0 || !j) throw invalid(`holo-ime exit ${r.code}`);
  const contradiction = imeExitProblem(r.code, j);
  if (contradiction) return fail(v, th, `internal error: ${contradiction}`);
  if (v.checks < th.checksMin) return fail(v, th, `checks ${v.checks} < baseline ${th.checksMin}`);
  return pass(v, th);
}
async function holoStill(L) {
  const url = await ensureSeed(L, BL.seed.records);
  const dir = path.join(OUT, 'holo-still');
  clearOut(path.join(dir, 'result.json'));
  const r = await L.node(path.join(HERE, 'holo-still.mjs'), ['--url', url, '--out', dir, ...swFlag()]);
  if (r.code === 2) return { status: 'INVALID', value: { exit: 2 }, threshold: null, reason: 'software WebGL renderer (holo-still exit 2)' };
  const j = readJsonSafe(path.join(dir, 'result.json')) ?? [];
  const stillOf = (x) => (x.runtime ? x.wantReduced : x.reducedMotion === true);
  const reduced = j.filter((x) => stillOf(x)), moving = j.filter((x) => !stillOf(x));
  const v = { exit: r.code, checks: j.length, reducedDiffMax: reduced.length ? Math.max(...reduced.map((x) => x.differingPixels)) : null, controlDiffMin: moving.length ? Math.min(...moving.map((x) => x.differingPixels)) : null };
  const th = { reducedDiff: 0, controlDiffGreaterThan: 0, checksMin: BL.holoStill.checks };
  if (r.code !== 0) return fail(v, th, `holo-still exit ${r.code}`);
  if (v.reducedDiffMax !== 0 || !(v.controlDiffMin > 0) || j.length < th.checksMin) return fail(v, th, `reducedDiffMax ${v.reducedDiffMax}, controlDiffMin ${v.controlDiffMin}, checks ${j.length}`);
  return pass(v, th);
}
async function holoPerf(L, n, minFps, warnFps = null) {
  const url = await ensureSeed(L, n);
  const dir = path.join(OUT, `holo-perf-${n}`);
  clearOut(path.join(dir, `result-spiral${n}-cpu1-fps.json`));
  const r = await L.node(path.join(HERE, 'holo-perf.mjs'), ['--url', url, '--n', String(n), '--modes', 'fps', '--out', dir, ...swFlag()]);
  if (r.code === 2) return { status: 'INVALID', value: { exit: 2 }, threshold: { medianFpsMin: minFps }, reason: 'software WebGL renderer (holo-perf exit 2)' };
  const j = readJsonSafe(path.join(dir, `result-spiral${n}-cpu1-fps.json`));
  const v = { exit: r.code, idleMedianFps: j?.hp1?.idle?.medianFps ?? null, operateMedianFps: j?.hp1?.operate?.medianFps ?? null, records: j?.records ?? null, renderer: j?.renderer ?? null };
  const th = { medianFpsMin: minFps, ...(warnFps != null ? { regressionWarnFps: warnFps } : {}) };
  if (!j) throw invalid(`holo-perf wrote no result (exit ${r.code})`);
  const low = Math.min(v.idleMedianFps, v.operateMedianFps);
  if (r.code !== 0 || !(low >= minFps)) return fail(v, th, `median fps ${low} < ${minFps} (exit ${r.code})`);
  if (warnFps != null && low < warnFps) return { status: 'INVALID', value: v, threshold: th, reason: `median fps ${low} < regression warning ${warnFps} (hard minimum ${minFps} still met): well below the baseline run, escalate to L2` };
  return pass(v, th);
}

const RUNNERS = {
  'ci-check': (L) => ciSimple(L, 'run check'), 'ci-test': ciTest, 'ci-typecheck': (L) => ciSimple(L, 'run typecheck'), 'ci-test-web': ciTestWeb, 'ci-build': ciBuild, 'ci-bundle': ciBundle, 'entry-delta-vs-base': entryDeltaVsBase,
  'tests-untouched': testsUntouched, 'redline-grep': redlineGrep,
  'lab-bundle': labBundle, 'c1-web': c1Web, 'c1-os': c1Os, 'os-e2e': osE2e, 'os-handoff': osHandoff, 'os-handoff-4x': osHandoff4x,
  'holo-ime': holoIme, 'holo-still': holoStill, 'holo-perf': (L) => holoPerf(L, BL.seed.records, BL.perf.hp1MinFps5k), 'holo-perf-20k': (L) => holoPerf(L, 20000, BL.perf.hp1MinFps20k, BL.perf.hp1WarnFps20k),
};

// ------------------------------------------------------------------ main
async function main() {
  console.log(`verify:holo  head ${head}  base ${baseHead ?? '(none)'}  out ${path.relative(process.cwd(), OUT) || '.'}${A.quick ? '  --quick' : ''}`);
  writeJson();
  for (const it of items) {
    if (interrupted) break;
    if (only && !only.has(it.id)) { it.reason = 'not selected (--only)'; continue; }
    if (A.quick && (it.group === 'C' || it.group === 'D')) { it.reason = 'skipped by --quick (groups A and B only)'; continue; }
    // B2 fail-fast: the quick stage (groups A and B, which run first) must have no FAIL and no INVALID before C and D start. Only items that really ran count (a SKIP / N/A is not a failure of this stage).
    // os-handoff-4x without --full is N/A (it does not run anything), so it is left to say so even then. Never makes anything pass: a skipped item is SKIP, which is exit 2 at best (overallExit).
    if (failFast.enabled && (it.group === 'C' || it.group === 'D') && !(it.id === 'os-handoff-4x' && !A.full)) {
      if (!failFast.triggered) {
        const by = items.filter((i) => (i.group === 'A' || i.group === 'B') && (i.status === 'FAIL' || i.status === 'INVALID')).map((i) => i.id);
        if (by.length) { failFast.triggered = true; failFast.by = by; console.log(`FAIL-FAST: quick stage failed (${by.join(', ')}): C and D are not run (use --no-fail-fast to run them anyway)`); writeJson(); }
      }
      if (failFast.triggered) { it.reason = `not run: quick stage failed (${failFast.by.join(', ')})`; continue; }
    }
    const L = makeCtx(it.id);
    const t0 = Date.now();
    beat();
    it.log = rel(L.file);
    it.reason = null;
    let res;
    const fakeStatus = FAKE_STATUS ? (FAKE_STATUS[it.id] ?? (it.id === 'os-handoff-4x' && !A.full ? 'N/A' : 'PASS')) : 'PASS'; // same N/A as the real runner (os-handoff-4x needs --full)
    try { res = FAKE_PASS || FAKE_STATUS ? { status: fakeStatus, value: { fake: true }, threshold: null, ...(fakeStatus === 'PASS' ? {} : { reason: `fake ${fakeStatus} (self-test hook)` }) } : await RUNNERS[it.id](L); res = it.group === 'D' ? await softwareGuard(res) : res; res = applyTimeout(res, L.timedOut); }
    catch (e) { res = applyTimeout({ status: 'INVALID', value: null, threshold: null, reason: (e instanceof Invalid ? '' : 'harness error: ') + (e.message ?? String(e)) }, L.timedOut); L.append(`\n[${res.reason}]\n${e.stack ?? ''}\n`); }
    beat();
    res = applySuspend(res, classifySuspend(heartbeats, t0, Date.now()), it.timeSensitive); // time-sensitive items only: a suspend inside the run beats every other verdict, FAIL evidence stays in value
    Object.assign(it, { status: res.status, value: res.value ?? null, threshold: res.threshold ?? null, reason: res.reason ?? null, durationMs: Date.now() - t0 });
    if (res.status === 'SKIP' || res.status === 'N/A') it.log = null;
    console.log(`${res.status.padEnd(7)} ${it.id.padEnd(16)} ${(it.durationMs / 1000).toFixed(0).padStart(4)}s  ${JSON.stringify(it.value)}${it.reason ? '  — ' + it.reason : ''}`);
    writeJson();
    scrubOut(); // F2: the sub-scripts' own JSON outputs (os-bundle's `dist` field, c1 / os-e2e results...) are evidence too
  }
  finish(interrupted ? 'interrupted' : null);
}
main().catch((e) => { console.error(e); finish('harness crashed: ' + e.message); });
