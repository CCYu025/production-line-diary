// Self-test of ime-env.mjs (pure functions): node scripts/verify/ime-env.selftest.mjs   (exit 0 = all pass)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_ERROR_KINDS, HOLO_IME_ARGS, buildImeArgs, classifyEnvError, envKindOf, imeExitProblem, judgeRetry, summarizeAttempt, untilHalt } from './ime-env.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`PASS ${name}`); };
const E = (kind, step = 'proj freeze=0 page-ready') => ({ kind, step, message: 'boom' });
const first = { exit: 2, failed: 0, checks: 22, invalid: null, envError: E('page-not-ready') };
const att = (exit, extra = {}) => ({ exit, failed: 0, checks: 44, invalid: null, envError: null, ...extra });

ok('the kind list is a single constant with exactly the three kinds', () => assert.deepEqual(Object.keys(ENV_ERROR_KINDS), ['page-not-ready', 'cdp-connection-lost', 'target-closed']));
ok('classify: page-ready waitFor timeout / __holoLab missing = page-not-ready, but only in the page-ready phase', () => {
  assert.equal(classifyEnvError(new Error('waitFor timeout: window.__holoLab && window.__holoLab().frames > 10'), 'page-ready'), 'page-not-ready');
  assert.equal(classifyEnvError(new Error('eval failed: TypeError: window.__holoLab is not a function'), 'page-ready'), 'page-not-ready');
  assert.equal(classifyEnvError(new Error('waitFor timeout: window.__holoLab && window.__holoLab().frames > 10'), 'C1'), null);
});
ok('classify: CDP and target errors', () => {
  assert.equal(classifyEnvError(new Error('CDP timeout Input.insertText'), 'C3'), 'cdp-connection-lost');
  assert.equal(classifyEnvError(new Error('WebSocket is not open: readyState 3 (CLOSED)'), 'C1'), 'cdp-connection-lost');
  assert.equal(classifyEnvError(new Error('Target closed. {"code":-32000}'), 'C2'), 'target-closed');
});
ok('classify: anything else (assertion, product error, context destroyed) is NOT environmental', () => {
  for (const m of ['eval failed: TypeError: x is null', 'Execution context was destroyed', 'no el foo', 'boom']) assert.equal(classifyEnvError(new Error(m), 'C1'), null, m);
});
ok('summarize / envKindOf: unknown kind in a result file is not an env error', () => {
  assert.equal(envKindOf(summarizeAttempt(2, { results: [], failed: 0, envError: E('page-not-ready') })), 'page-not-ready');
  assert.equal(envKindOf(summarizeAttempt(2, { results: [], failed: 0, envError: E('made-up') })), null);
});
ok('retry PASS -> INVALID (never PASS), retried:true, first exception kept, "retried 1x" in the reason', () => {
  const r = judgeRetry(first, att(0));
  assert.equal(r.status, 'INVALID'); assert.equal(r.retried, true); assert.equal(r.firstAttempt.kind, 'page-not-ready'); assert.equal(r.firstAttempt.step, 'proj freeze=0 page-ready');
  assert.match(r.reason, /retried 1x/); assert.match(r.reason, /does not wash out/);
});
ok('retry ends in the SAME kind -> FAIL, saying two consecutive and render loop', () => {
  const r = judgeRetry(first, att(2, { checks: 0, envError: E('page-not-ready') }));
  assert.equal(r.status, 'FAIL'); assert.match(r.reason, /two consecutive page-not-ready/); assert.match(r.reason, /render loop/); assert.match(r.reason, /retried 1x/);
});
ok('retry ends in a DIFFERENT env kind -> INVALID', () => assert.equal(judgeRetry(first, att(2, { envError: E('target-closed') })).status, 'INVALID'));
ok('retry has a real check failure -> FAIL', () => assert.equal(judgeRetry(first, att(1, { failed: 3 })).status, 'FAIL'));
ok('retry ends with no usable result (crash) -> FAIL', () => assert.equal(judgeRetry(first, att(7)).status, 'FAIL'));
ok('retry INVALID by the probe (no env error) -> INVALID', () => assert.equal(judgeRetry(first, att(2, { invalid: 'probe' })).status, 'INVALID'));
ok('untilHalt (H2-0 halt): after the first exception sets halt, no further freeze setting runs and the FIRST exception is the one kept', () => {
  let halt = false, first = null; const ran = [];
  for (const f of untilHalt(['1', '0'], () => halt)) {
    ran.push(f);
    try { throw new Error('exception at freeze=' + f); } catch (e) { halt = true; first = first ?? e; } // same shape as holo-ime.mjs's catch: halt = true, then record
  }
  assert.deepEqual(ran, ['1'], 'the second freeze setting must not run once halt is set');
  assert.equal(first.message, 'exception at freeze=1');
});
ok('untilHalt: with no halt every item runs in order; stop() is evaluated before each item (an already-halted run runs none)', () => {
  assert.deepEqual([...untilHalt(['1', '0'], () => false)], ['1', '0']);
  assert.deepEqual([...untilHalt(['1', '0'], () => true)], []);
});
ok('holo-ime.mjs really iterates its freeze settings through untilHalt with the halt / invalid flags, and its outer loop checks them too (source check: the browser part cannot run here)', () => {
  const src = fs.readFileSync(path.join(HERE, 'holo-ime.mjs'), 'utf8');
  assert.match(src, /for \(const freeze of untilHalt\(A\.freeze\.split\(','\), \(\) => invalid \|\| halt\)\)/);
  assert.match(src, /if \(invalid \|\| halt\) break;/);
  assert.doesNotMatch(src, /for \(const freeze of A\.freeze/);
});
ok('holo-ime arguments: one constant (README: method proj, freeze 1,0 = on and off); buildImeArgs puts url and out around it', () => {
  assert.deepEqual(HOLO_IME_ARGS, ['--methods', 'proj', '--freeze', '1,0']);
  assert.deepEqual(buildImeArgs('http://u/', 'o'), ['--url', 'http://u/', '--methods', 'proj', '--freeze', '1,0', '--out', 'o']);
});
ok('imeExitProblem: exit 0 with failed>0 / results pass:false / invalid / envError / failed-vs-results mismatch / no result = contradiction; the real PASS shape and non-zero exits = null', () => {
  const P = (k) => Array.from({ length: k }, (_, i) => ({ name: 'c' + i, pass: true }));
  const good = { results: P(68), failed: 0, invalid: null, envError: null };
  assert.equal(imeExitProblem(0, good), null);
  assert.match(imeExitProblem(0, { ...good, failed: 2 }), /^holo-ime exited 0 but .*failed=2/);
  assert.match(imeExitProblem(0, { ...good, invalid: 'probe' }), /^holo-ime exited 0 but .*invalid/);
  assert.match(imeExitProblem(0, { ...good, envError: { kind: 'target-closed' } }), /^holo-ime exited 0 but .*envError/);
  assert.match(imeExitProblem(0, { ...good, results: [...P(5), { name: 'x', pass: false }] }), /^holo-ime exited 0 but .*did not pass/);
  assert.match(imeExitProblem(0, { ...good, failed: 1, results: [...P(5), { name: 'x', pass: false }] }), /^holo-ime exited 0 but/);
  assert.match(imeExitProblem(0, null), /^holo-ime exited 0 but/);
  for (const e of [1, 2, 3]) assert.equal(imeExitProblem(e, { ...good, failed: 1 }), null);
});
// ---- H2-1 E1 residuals: type guards of imeExitProblem. Each assertion pins one mutation (named in the comment).
ok('imeExitProblem types: pass must be exactly true; failed must be exactly the number 0; results must be an array; invalid / envError / envErrorSeen are judged by != null (0, "", false are values)', () => {
  const P = (k) => Array.from({ length: k }, (_, i) => ({ name: 'c' + i, pass: true }));
  const good = { results: P(5), failed: 0, invalid: null, envError: null, envErrorSeen: null };
  assert.equal(imeExitProblem(0, good), null);
  assert.equal(imeExitProblem(0, { ...good, envErrorSeen: undefined }), null, 'a missing envErrorSeen (older result files) is fine');
  // `pass !== true` -> `!pass`: truthy non-true values must still count as "did not pass"
  for (const v of [1, 'true', 'yes', {}]) assert.match(imeExitProblem(0, { ...good, results: [...P(3), { name: 'x', pass: v }] }), /did not pass/, `pass: ${JSON.stringify(v)}`);
  assert.match(imeExitProblem(0, { ...good, results: [...P(3), null] }), /did not pass/, 'a null entry is not a pass');
  // `failed !== 0` -> `> 0`: negative / NaN-like numbers are not 0
  assert.match(imeExitProblem(0, { ...good, failed: -1 }), /failed=-1/);
  assert.match(imeExitProblem(0, { ...good, failed: Number.NaN }), /failed=NaN|numeric failed/);
  // `typeof failed` check removed: a string "0" must be rejected by the type check (its own message), not by the value check
  for (const f of ['0', false, null, undefined, [0]]) assert.match(imeExitProblem(0, { ...good, failed: f }), /no results\[\] \/ numeric failed/, `failed: ${JSON.stringify(f)}`);
  // `Array.isArray` removed: non-arrays must be reported (not throw, not slip through)
  for (const r of [null, undefined, 'abc', { length: 1, 0: { pass: true } }, 7]) {
    let msg; try { msg = imeExitProblem(0, { ...good, results: r }); } catch (e) { assert.fail(`results ${JSON.stringify(r)} threw ${e.message}`); }
    assert.match(msg, /no results\[\] \/ numeric failed/, `results: ${JSON.stringify(r)}`);
  }
  // `!= null` -> truthiness: every non-null value, however falsy, is a contradiction
  for (const v of [0, '', false, 'probe', {}, []]) {
    assert.match(imeExitProblem(0, { ...good, invalid: v }), /^holo-ime exited 0 but .*invalid=/, `invalid: ${JSON.stringify(v)}`);
    assert.match(imeExitProblem(0, { ...good, envError: v }), /^holo-ime exited 0 but .*envError/, `envError: ${JSON.stringify(v)}`);
    assert.match(imeExitProblem(0, { ...good, envErrorSeen: v }), /^holo-ime exited 0 but .*envErrorSeen/, `envErrorSeen: ${JSON.stringify(v)}`);
  }
  assert.match(imeExitProblem(0, { ...good, envErrorSeen: { kind: 'target-closed', step: 's', message: 'm' } }), /envErrorSeen \(target-closed\)/);
});

// ---- H2-1 G5: the halt wiring of the REAL holo-ime.mjs, behaviour level. holo-ime runs as a child with a FAKE cdp module (hook: VERIFY_HOLO_SELFTEST=1 + HOLO_IME_SELFTEST_CDP):
// every newPage() is counted and its goto() throws a CDP error (an environmental kind). With the freeze list 1,0 the loop must stop after the FIRST exception (1 page),
// keep that first exception as envError and exit 2. A halt that is reset in `finally`, or never set in `catch`, lets the second freeze setting run (2 pages).
const IME_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pld-imest-'));
const FAKE_CDP = path.join(IME_TMP, 'fake-cdp.mjs');
fs.writeFileSync(FAKE_CDP, [
  "import fs from 'node:fs';",
  'const count = process.env.FX_COUNT;',
  'export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));',
  'export const Browser = { async launch() { return {',
  "  async newPage() { fs.appendFileSync(count, 'page\\n'); return { async goto() { throw new Error('CDP timeout Page.navigate'); }, async eval() { return null; }, async close() {}, async send() {}, async waitFor() {} }; },",
  '  async close() {},',
  '}; } };',
  '',
].join('\n'));
function runIme(name, args) {
  const d = path.join(IME_TMP, name); fs.mkdirSync(d, { recursive: true });
  const count = path.join(d, 'pages.log'); const out = path.join(d, 'out');
  const env = { ...process.env, VERIFY_HOLO_SELFTEST: '1', HOLO_IME_SELFTEST_CDP: FAKE_CDP, FX_COUNT: count }; delete env.CI;
  const r = spawnSync(process.execPath, [path.join(HERE, 'holo-ime.mjs'), '--url', 'http://localhost:0/', '--out', out, ...args], { cwd: d, encoding: 'utf8', env });
  const pages = fs.existsSync(count) ? fs.readFileSync(count, 'utf8').split('\n').filter(Boolean).length : 0;
  const rf = path.join(out, 'result.json');
  return { code: r.status, pages, j: fs.existsSync(rf) ? JSON.parse(fs.readFileSync(rf, 'utf8')) : null, stdout: r.stdout, stderr: r.stderr };
}
ok('holo-ime.mjs (behaviour, fake cdp): the first exception halts the whole loop: freeze 1,0 -> exactly 1 page opened, envError and envErrorSeen are the FIRST exception, exit 2', () => {
  const r = runIme('g5a', ['--methods', 'proj', '--freeze', '1,0']);
  assert.equal(r.pages, 1, `the second freeze setting must not run after the first exception (pages opened: ${r.pages}); stderr: ${r.stderr.slice(0, 300)}`);
  assert.equal(r.code, 2); assert.equal(r.j.envError.kind, 'cdp-connection-lost'); assert.match(r.j.envError.step, /proj freeze=1 /); assert.equal(r.j.envErrorSeen.kind, 'cdp-connection-lost');
  assert.equal(r.j.failed, 0); assert.equal(r.j.diag.length, 1);
});
ok('holo-ime.mjs (behaviour, fake cdp): two methods x two freeze settings still stop after the very first exception (outer loop honours halt too)', () => {
  const r = runIme('g5b', ['--methods', 'proj,css3d', '--freeze', '1,0']);
  assert.equal(r.pages, 1, `pages opened: ${r.pages}`); assert.equal(r.code, 2);
});
ok('holo-ime.mjs (behaviour, fake cdp): control - the hook is inert without VERIFY_HOLO_SELFTEST=1 (the real cdp.mjs would be used, never the fake)', () => {
  const d = path.join(IME_TMP, 'g5c'); fs.mkdirSync(d, { recursive: true });
  const count = path.join(d, 'pages.log'); const env = { ...process.env, HOLO_IME_SELFTEST_CDP: FAKE_CDP, FX_COUNT: count }; delete env.VERIFY_HOLO_SELFTEST;
  const r = spawnSync(process.execPath, [path.join(HERE, 'holo-ime.mjs'), '--help'], { cwd: d, encoding: 'utf8', env });
  assert.equal(r.status, 0); assert.ok(!fs.existsSync(count), 'the fake cdp module must not be loaded without the self-test switch');
  const src = fs.readFileSync(path.join(HERE, 'holo-ime.mjs'), 'utf8');
  assert.match(src, /process\.env\.VERIFY_HOLO_SELFTEST === '1' && !process\.env\.CI && process\.env\.HOLO_IME_SELFTEST_CDP/);
});
fs.rmSync(IME_TMP, { recursive: true, force: true });
console.log(`\n${n} passed`);
