// End-to-end self-test of verify-holo.mjs's os-handoff-4x path (regression cases from the L2-i review). No browser, no server, no port, no package:
//   node scripts/verify/verify-holo.selftest.mjs      (exit 0 = all pass)
// It runs the REAL verify-holo.mjs as a child with VERIFY_HOLO_SELFTEST=1 (stubs the build and both servers, swaps the os-handoff script for a fake that
// replays <FX_DIR>/branch.json | base.json, shortens the command timer). The fake is written to a temp folder; nothing in the repo is modified.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pld-vhst-'));
const FAKE = path.join(TMP, 'fake-os-handoff.mjs');
fs.writeFileSync(FAKE, [
  "import fs from 'node:fs'; import path from 'node:path';",
  'const a = process.argv.slice(2); const arg = (k) => a[a.indexOf(k) + 1];',
  "const role = a.includes('--only') ? 'base' : 'branch';",
  "const spec = JSON.parse(fs.readFileSync(path.join(process.env.FX_DIR, role + '.json'), 'utf8'));",
  'if (spec.hang) setInterval(() => {}, 1000);',
  "else { if (spec.result) { fs.mkdirSync(arg('--out'), { recursive: true }); fs.writeFileSync(path.join(arg('--out'), 'result.json'), JSON.stringify(spec.result)); } process.exit(spec.exit); }",
  '',
].join('\n'));

const TIMEOUT = 'error: eval failed: Error: timeout waiting for phase switching-post (have switching-pre>station)';
const mk = (rows) => ({ summary: { total: rows.length, fail: rows.filter((r) => r.status === 'FAIL').length, deviated: rows.filter((r) => r.status === 'DEVIATED').length }, results: rows });
const rowsOf = ({ i1 = 0, i2 = 0, to = 0, dev = 0 }) => [
  ...Array.from({ length: to }, () => ({ id: 'I2', status: 'FAIL', notes: [TIMEOUT] })),
  ...Array.from({ length: i2 }, () => ({ id: 'I2', status: 'PASS', notes: [] })),
  ...Array.from({ length: i1 }, () => ({ id: 'I1', status: 'PASS', notes: [] })),
  ...Array.from({ length: dev }, () => ({ id: 'I1', status: 'DEVIATED', notes: ['x'] })),
];
const CLEAN = { exit: 0, result: mk(rowsOf({ i1: 100 })) };
const BRANCH_2_OF_18 = { exit: 1, result: mk(rowsOf({ to: 2, i2: 16, i1: 82 })) }; // 2 phase timeouts out of 18 I2 samples
const BASE_1_OF_60 = { exit: 1, result: mk(rowsOf({ to: 1, i2: 59 })) }; // limit 3 x 1 x 18/60 + 2 = 2.9 -> INVALID

let n = 0;
function run(name, specs, { env = {}, out = null } = {}) {
  const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'branch.json'), JSON.stringify(specs.branch));
  if (specs.base) fs.writeFileSync(path.join(d, 'base.json'), JSON.stringify(specs.base));
  const o = out ?? path.join(d, 'out');
  const r = spawnSync(process.execPath, [path.join(HERE, 'verify-holo.mjs'), '--only', 'os-handoff-4x', '--full', '--base', path.resolve(HERE, '..', '..'), '--out', o], {
    cwd: d, encoding: 'utf8', env: { ...process.env, VERIFY_HOLO_SELFTEST: '1', VERIFY_HOLO_SELFTEST_HANDOFF: FAKE, FX_DIR: d, ...env },
  });
  const it = JSON.parse(fs.readFileSync(path.join(o, 'verify-holo.json'), 'utf8')).items.find((i) => i.id === 'os-handoff-4x');
  return { exit: r.status, it, out: o };
}
const ok = (name, fn) => { fn(); n++; console.log(`PASS ${name}`); };

ok('(a) stale result.json: a second run into the same --out whose os-handoff crashes (exit 1, no file) does not read the first run\'s clean result', () => {
  const o = path.join(TMP, 'a1-out');
  const first = run('a1', { branch: CLEAN }, { out: o }); assert.equal(first.it.status, 'PASS');
  const second = run('a1', { branch: { exit: 1, result: null } }, { out: o });
  assert.equal(second.it.status, 'INVALID'); assert.equal(second.it.value, null); assert.match(second.it.reason, /no result\.json/);
});
ok('(a) stale base result: base re-run that crashes (exit 1, no file) after an earlier INVALID run in the same --out is FAIL "base re-run failed", not INVALID from the old file', () => {
  const o = path.join(TMP, 'a2-out');
  const first = run('a2', { branch: BRANCH_2_OF_18, base: BASE_1_OF_60 }, { out: o }); assert.equal(first.it.status, 'INVALID');
  const second = run('a2', { branch: BRANCH_2_OF_18, base: { exit: 1, result: null } }, { out: o });
  assert.equal(second.it.status, 'FAIL'); assert.match(second.it.reason, /base re-run failed/); assert.match(second.it.reason, /cannot be compared with main/); assert.equal(second.exit, 1);
});
ok('(1) base server cannot be started / built -> FAIL (exit 1) saying it is the base side and cannot be compared with main', () => {
  const r = run('b1', { branch: BRANCH_2_OF_18, base: BASE_1_OF_60 }, { env: { VERIFY_HOLO_SELFTEST_BASE_FAIL: 'could not build the --base worktree' } });
  assert.equal(r.it.status, 'FAIL'); assert.equal(r.exit, 1); assert.match(r.it.reason, /base \(main\) side could not be started/); assert.match(r.it.reason, /could not build the --base worktree/); assert.match(r.it.reason, /cannot be compared with main/);
  assert.equal(r.it.value.baseUnavailable, true);
  const ctl = run('b1ctl', { branch: BRANCH_2_OF_18, base: BASE_1_OF_60 }); assert.equal(ctl.it.status, 'INVALID', 'control: with a base server the same data is INVALID (known-on-main)');
});
ok('(2) a command killed by the timer: FAIL already observed -> FAIL (timeout noted); nothing observed -> INVALID "aborted on timeout"', () => {
  const failKept = run('c1', { branch: BRANCH_2_OF_18, base: { hang: true } }, { env: { VERIFY_HOLO_SELFTEST_TIMEOUT_MS: '4000' } });
  assert.equal(failKept.it.status, 'FAIL'); assert.equal(failKept.exit, 1); assert.match(failKept.it.reason, /timeout/); assert.match(failKept.it.reason, /aborted/);
  const none = run('c2', { branch: { hang: true } }, { env: { VERIFY_HOLO_SELFTEST_TIMEOUT_MS: '4000' } });
  assert.equal(none.it.status, 'INVALID'); assert.match(none.it.reason, /aborted on timeout/);
});
ok('(5) exit 2 (usage error) with a clean-looking result.json -> FAIL internal error; exit 3 with DEVIATED 0 -> FAIL; exit 0 with FAIL rows -> FAIL', () => {
  const e2 = run('d1', { branch: { exit: 2, result: CLEAN.result } });
  assert.equal(e2.it.status, 'FAIL'); assert.equal(e2.exit, 1); assert.match(e2.it.reason, /internal error.*exited 2/);
  const e3 = run('d2', { branch: { exit: 3, result: CLEAN.result } }); assert.equal(e3.it.status, 'FAIL'); assert.match(e3.it.reason, /internal error.*exited 3/);
  const e0 = run('d3', { branch: { exit: 0, result: BRANCH_2_OF_18.result } }); assert.equal(e0.it.status, 'FAIL'); assert.match(e0.it.reason, /internal error.*exited 0/);
  const good3 = run('d4', { branch: { exit: 3, result: mk(rowsOf({ i1: 30, dev: 70 })) } }); assert.notEqual(good3.it.status, 'FAIL', 'a consistent exit 3 is not an internal error');
});
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`verify-holo selftest: ${n} groups passed`);
