// End-to-end self-test of verify-holo.mjs's os-handoff-4x path (regression cases from the L2-i review). No browser, no server, no port, no package:
//   node scripts/verify/verify-holo.selftest.mjs      (exit 0 = all pass)
// (CI is removed from the child env: with CI set the hooks are refused.) It runs the REAL verify-holo.mjs as a child with VERIFY_HOLO_SELFTEST=1 (stubs the build and both servers, swaps the os-handoff script for a fake that
// replays <FX_DIR>/branch.json | base.json, shortens the command timer). The fake is written to a temp folder; nothing in the repo is modified.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHandoffArgs, handoffAllowsDeviated } from './known-on-main.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pld-vhst-'));
const FAKE = path.join(TMP, 'fake-os-handoff.mjs');
fs.writeFileSync(FAKE, [
  "import fs from 'node:fs'; import path from 'node:path';",
  'const a = process.argv.slice(2); const arg = (k) => a[a.indexOf(k) + 1];',
  "const role = a.includes('--only') ? 'base' : 'branch';",
  "const spec = JSON.parse(fs.readFileSync(path.join(process.env.FX_DIR, role + '.json'), 'utf8'));",
  "if (spec.real) spec.exit = spec.result.summary.fail ? 1 : spec.result.summary.deviated && !a.includes('--allow-deviated') ? 3 : 0; // same rule as os-handoff.mjs:416, driven by the args verify-holo really passes",
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
/** child env: CI is always removed (on GitHub Actions CI is set and the hooks would be refused, condition 3), VERIFY_HOLO_SELFTEST=1 unless overridden; a value of undefined in `env` deletes the key */
function childEnv(env) {
  const e = { ...process.env, VERIFY_HOLO_SELFTEST: '1', VERIFY_HOLO_SELFTEST_HANDOFF: FAKE, ...env };
  if (!('CI' in env)) delete e.CI;
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}
const lastLine = (t) => t.trim().split(String.fromCharCode(10)).pop().trim();
function run(name, specs, { env = {}, out = null, item = 'os-handoff-4x' } = {}) {
  const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'branch.json'), JSON.stringify(specs.branch));
  if (specs.base) fs.writeFileSync(path.join(d, 'base.json'), JSON.stringify(specs.base));
  const o = out ?? path.join(d, 'out');
  const r = spawnSync(process.execPath, [path.join(HERE, 'verify-holo.mjs'), '--only', item, ...(item === 'os-handoff-4x' ? ['--full'] : []), '--base', path.resolve(HERE, '..', '..'), '--out', o], {
    cwd: d, encoding: 'utf8', env: childEnv({ FX_DIR: d, ...env }),
  });
  const json = JSON.parse(fs.readFileSync(path.join(o, 'verify-holo.json'), 'utf8'));
  const it = json.items.find((i) => i.id === item);
  return { exit: r.status, it, out: o, json, last: lastLine(r.stdout), stderr: r.stderr };
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
  const good0 = run('d4', { branch: { exit: 0, result: mk(rowsOf({ i1: 30, dev: 70 })) } }); assert.notEqual(good0.it.status, 'FAIL', 'under --allow-deviated a DEVIATED-only exit 0 is not an internal error');
});

ok('(5b) real args (holo-baseline.json via buildHandoffArgs) carry --allow-deviated; DEVIATED only -> os-handoff exits 0 -> PASS, not internal error; exit 3 under those args -> FAIL internal error', () => {
  const BLJ = JSON.parse(fs.readFileSync(path.join(HERE, 'holo-baseline.json'), 'utf8'));
  assert.ok(handoffAllowsDeviated(buildHandoffArgs(BLJ.osHandoff, 'u', 'o', 4)), 'premise: the real args allow DEVIATED');
  const dev = mk(rowsOf({ i1: 30, dev: BLJ.osHandoff4x.baselineDeviated }));
  const g = run('d5', { branch: { real: true, result: dev } });
  assert.notEqual(g.it.status, 'FAIL', JSON.stringify(g.it)); assert.doesNotMatch(String(g.it.reason ?? ''), /internal error/);
  const gp = run('d5b', { branch: { real: true, result: mk(rowsOf({ i1: BLJ.osHandoff4x.samples, dev: 0 })) } }); assert.equal(gp.it.status, 'PASS', JSON.stringify(gp.it));
  const bad = run('d6', { branch: { exit: 3, result: dev } }); assert.equal(bad.it.status, 'FAIL'); assert.match(bad.it.reason, /internal error.*exited 3/);
});

ok('(7) every item that needs --base (c1-web, c1-os) with a base server that cannot start / build -> FAIL (exit 1, SELFTEST label), saying base (main) side could not be started; not INVALID', () => {
  for (const item of ['c1-web', 'c1-os']) {
    const r = run(`i-${item}`, { branch: CLEAN }, { item, env: { VERIFY_HOLO_SELFTEST_BASE_FAIL: 'could not build the --base worktree' } });
    assert.equal(r.it.status, 'FAIL', `${item}: ${r.it.reason}`); assert.equal(r.exit, 1);
    assert.match(r.last, /^VERIFY:HOLO SELFTEST .*1 fail \(/);
    assert.match(r.it.reason, /base \(main\) side could not be started/); assert.match(r.it.reason, /could not build the --base worktree/); assert.match(r.it.reason, /cannot be compared with main/);
    assert.equal(r.it.value.baseUnavailable, true);
  }
});
// ---- hard conditions of the VERIFY_HOLO_SELFTEST hook (designer ruling). Cases 6b/6c run the real redline-grep item only (static git scan: no build, no server, no port).
const runStatic = (name, env) => {
  const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true }); const o = path.join(d, 'out');
  const r = spawnSync(process.execPath, [path.join(HERE, 'verify-holo.mjs'), '--only', 'redline-grep', '--out', o], { cwd: d, encoding: 'utf8', env: childEnv(env) });
  const jf = path.join(o, 'verify-holo.json');
  return { exit: r.status, last: lastLine(r.stdout), stderr: r.stderr, json: fs.existsSync(jf) ? JSON.parse(fs.readFileSync(jf, 'utf8')) : null };
};
ok('(6a) hook enabled: the result is never PASS and never exit 0 — clean run = SELFTEST + exit 2 + "selftest": true; a run with a FAIL = SELFTEST + exit 1 (not 0), still not PASS', () => {
  const clean = run('f1', { branch: CLEAN });
  assert.equal(clean.it.status, 'PASS', 'the item itself still judges normally');
  assert.match(clean.last, /^VERIFY:HOLO SELFTEST /); assert.doesNotMatch(clean.last, /VERIFY:HOLO (PASS|FAIL|INCOMPLETE)/);
  assert.equal(clean.exit, 2); assert.equal(clean.json.selftest, true); assert.equal(clean.json.exitCode, 2);
  const bad = run('f2', { branch: BRANCH_2_OF_18, base: { hang: true } }, { env: { VERIFY_HOLO_SELFTEST_TIMEOUT_MS: '4000' } });
  assert.equal(bad.it.status, 'FAIL'); assert.match(bad.last, /^VERIFY:HOLO SELFTEST /); assert.equal(bad.exit, 1); assert.equal(bad.json.selftest, true);
});
ok('(6b) only the exact string "1" enables the hook: "true", "0", "", " 1" are ignored with a stderr warning (no selftest marker, label is not SELFTEST); a control without the variable has no warning', () => {
  for (const [i, v] of ['true', '0', '', ' 1', '1 '].entries()) {
    const r = runStatic(`g${i}`, { VERIFY_HOLO_SELFTEST: v });
    assert.match(r.stderr, /WARNING: VERIFY_HOLO_SELFTEST=.* ignored/, `value ${JSON.stringify(v)} must warn`);
    assert.doesNotMatch(r.last, /^VERIFY:HOLO SELFTEST/, `value ${JSON.stringify(v)} must not enable the hook`);
    assert.ok(r.json && !('selftest' in r.json), `value ${JSON.stringify(v)}: json must not carry selftest`);
  }
  const ctl = runStatic('g-ctl', { VERIFY_HOLO_SELFTEST: undefined });
  assert.doesNotMatch(ctl.stderr, /WARNING/); assert.doesNotMatch(ctl.last, /SELFTEST/);
  const on = runStatic('g-on', {}); assert.match(on.last, /^VERIFY:HOLO SELFTEST/); assert.doesNotMatch(on.stderr, /WARNING/);
});
ok('(6c) CI set (non-empty) + VERIFY_HOLO_SELFTEST=1: refused -> FAIL, exit 1, no item run, no json; CI empty string does not refuse; CI set without the hook is not refused', () => {
  const r = runStatic('h1', { CI: 'true' });
  assert.equal(r.exit, 1); assert.match(r.last, /^VERIFY:HOLO FAIL .*refused.*CI/); assert.match(r.stderr, /refused/); assert.equal(r.json, null);
  const r2 = runStatic('h2', { CI: '1' }); assert.equal(r2.exit, 1); assert.equal(r2.json, null);
  const empty = runStatic('h3', { CI: '' }); assert.match(empty.last, /^VERIFY:HOLO SELFTEST/, 'empty CI is "not set"');
  const noHook = runStatic('h4', { CI: 'true', VERIFY_HOLO_SELFTEST: undefined }); assert.doesNotMatch(noHook.stderr, /refused/); assert.ok(noHook.json);
});

// ---- holo-ime environmental exceptions (H2-0 coordinator 8): a fake holo-ime replays <FX_DIR>/ime.json (one spec per attempt); the REAL verify-holo decides.
const FAKE_IME = path.join(TMP, 'fake-holo-ime.mjs');
fs.writeFileSync(FAKE_IME, [
  "import fs from 'node:fs'; import path from 'node:path';",
  "const a = process.argv.slice(2); const out = a[a.indexOf('--out') + 1];",
  "const cf = path.join(process.env.FX_DIR, 'ime-count'); const k = fs.existsSync(cf) ? Number(fs.readFileSync(cf, 'utf8')) : 0; fs.writeFileSync(cf, String(k + 1));",
  "const spec = JSON.parse(fs.readFileSync(path.join(process.env.FX_DIR, 'ime.json'), 'utf8'))[k] ?? { exit: 9 };",
  "if (spec.result) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(spec.result)); } process.exit(spec.exit);",
  '',
].join(String.fromCharCode(10)));
const checks = (k) => Array.from({ length: k }, (_, i) => ({ name: 'c' + i, pass: true }));
const IME_CHECKS = JSON.parse(fs.readFileSync(path.join(HERE, 'holo-baseline.json'), 'utf8')).holoIme.checks; // the fake must meet the real baseline, not a hand-written number
const IME_PASS = { exit: 0, result: { results: checks(IME_CHECKS), failed: 0, invalid: null, envError: null } };
const imeEnv = (kind, k = 22) => ({ exit: 2, result: { results: checks(k), failed: 0, invalid: null, envError: { kind, step: 'proj freeze=0 page-ready', message: 'waitFor timeout: window.__holoLab && window.__holoLab().frames > 10' } } });
const IME_FAIL = { exit: 1, result: { results: [...checks(10), { name: 'bad', pass: false }], failed: 1, invalid: null, envError: null } };
function runIme(name, specs) {
  const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'ime.json'), JSON.stringify(specs));
  const r = run(name, { branch: {} }, { item: 'holo-ime', env: { VERIFY_HOLO_SELFTEST_IME: FAKE_IME } });
  const f = path.join(d, 'ime-count');
  return { ...r, attempts: fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0 };
}
ok('(ime-1) env exception then retry PASS -> INVALID (not PASS): JSON value.retried=true with the first exception, summary text says "retried 1x", exactly 2 attempts', () => {
  const r = runIme('ime1', [imeEnv('page-not-ready'), IME_PASS]);
  assert.equal(r.attempts, 2); assert.equal(r.it.status, 'INVALID');
  assert.equal(r.it.value.retried, true); assert.equal(r.it.value.firstAttempt.kind, 'page-not-ready'); assert.equal(r.it.value.firstAttempt.step, 'proj freeze=0 page-ready'); assert.match(r.it.value.firstAttempt.message, /waitFor timeout/);
  assert.match(r.it.reason, /retried 1x/); assert.match(r.it.reason, /does not wash out/);
  assert.match(fs.readFileSync(path.join(TMP, 'ime1', 'out', 'verify-holo.json'), 'utf8'), /retried 1x/);
});
ok('(ime-2) two consecutive environmental exceptions of the SAME kind -> FAIL (render loop may not start), says retried 1x', () => {
  const r = runIme('ime2', [imeEnv('page-not-ready'), imeEnv('page-not-ready')]);
  assert.equal(r.attempts, 2); assert.equal(r.it.status, 'FAIL'); assert.match(r.it.reason, /two consecutive page-not-ready/); assert.match(r.it.reason, /retried 1x/); assert.equal(r.it.value.retried, true);
});
ok('(ime-3) environmental exception, retry has a real failing check -> FAIL', () => {
  const r = runIme('ime3', [imeEnv('cdp-connection-lost'), IME_FAIL]);
  assert.equal(r.it.status, 'FAIL'); assert.equal(r.it.value.retried, true);
});
ok('(ime-4) clean PASS: no retry (1 attempt), retried:false', () => {
  const r = runIme('ime4', [IME_PASS, IME_PASS]);
  assert.equal(r.attempts, 1); assert.equal(r.it.status, 'PASS'); assert.equal(r.it.value.retried, false);
});
ok('(ime-5) a real FAIL (exit 1) is never retried, even if the result file also mentions an environmental exception seen after the failure', () => {
  const bad = { exit: 1, result: { ...IME_FAIL.result, envErrorSeen: { kind: 'target-closed', step: 'x', message: 'Target closed' } } };
  const r = runIme('ime5', [bad, IME_PASS]);
  assert.equal(r.attempts, 1); assert.equal(r.it.status, 'FAIL');
});
ok('(ime-6) INVALID by the probe (no env error) is not retried; an exit 2 with an environmental kind NOT on the list is FAIL, not INVALID', () => {
  const probe = runIme('ime6a', [{ exit: 2, result: { results: [], failed: 0, invalid: 'IME probe composition did not fire', envError: null } }, IME_PASS]);
  assert.equal(probe.attempts, 1); assert.equal(probe.it.status, 'INVALID');
  const unknown = runIme('ime6b', [imeEnv('some-new-kind'), IME_PASS]);
  assert.equal(unknown.attempts, 1); assert.equal(unknown.it.status, 'FAIL'); assert.match(unknown.it.reason, /not on the list/);
});
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`verify-holo selftest: ${n} groups passed`);
