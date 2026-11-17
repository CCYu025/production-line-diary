// Self-test of ime-env.mjs (pure functions): node scripts/verify/ime-env.selftest.mjs   (exit 0 = all pass)
import assert from 'node:assert/strict';
import { ENV_ERROR_KINDS, classifyEnvError, envKindOf, judgeRetry, summarizeAttempt } from './ime-env.mjs';
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
console.log(`\n${n} passed`);
