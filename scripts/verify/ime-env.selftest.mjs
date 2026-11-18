// Self-test of ime-env.mjs (pure functions): node scripts/verify/ime-env.selftest.mjs   (exit 0 = all pass)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_ERROR_KINDS, HOLO_IME_ARGS, buildImeArgs, classifyEnvError, envKindOf, judgeRetry, summarizeAttempt, untilHalt } from './ime-env.mjs';
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
console.log(`\n${n} passed`);
