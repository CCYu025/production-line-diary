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
import { buildHandoffArgs, handoffAllowsDeviated, handoffExitProblem } from './known-on-main.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pld-vhst-'));
/** a main checkout and a LINKED worktree of it (what --base must be): returns {root, main, base}. Plain spawnSync: this runs before the later git() helper exists. */
function mkLinkedBase(name) {
  const root = path.join(TMP, name); const main = path.join(root, 'main'); const base = path.join(root, 'base');
  fs.mkdirSync(path.join(main, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(main, 'backend', 'server.js'), '// fake\n'); fs.writeFileSync(path.join(main, '.gitignore'), 'web/dist\nnode_modules\n.env*\n'); fs.writeFileSync(path.join(main, 'package.json'), '{"name":"x","private":true}');
  const g = (cwd, ...a) => { const e = { ...process.env }; delete e.GIT_DIR; delete e.GIT_WORK_TREE; delete e.GIT_INDEX_FILE; const r = spawnSync('git', ['-c', 'user.name=selftest', '-c', 'user.email=selftest@example.invalid', ...a], { cwd, encoding: 'utf8', env: e }); assert.equal(r.status, 0, 'git ' + a.join(' ') + ': ' + r.stderr); };
  g(main, 'init', '-q'); g(main, 'add', '-A'); g(main, 'commit', '-q', '-m', 'init'); g(main, 'worktree', 'add', '-q', '-b', 'wt', base);
  return { root, main, base };
}
let defaultBaseDir = null;
const defaultBase = () => (defaultBaseDir ??= mkLinkedBase('default-base').base);
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
function run(name, specs, { env = {}, out = null, item = 'os-handoff-4x', base = defaultBase() } = {}) {
  const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'branch.json'), JSON.stringify(specs.branch));
  if (specs.base) fs.writeFileSync(path.join(d, 'base.json'), JSON.stringify(specs.base));
  const o = out ?? path.join(d, 'out');
  const r = spawnSync(process.execPath, [path.join(HERE, 'verify-holo.mjs'), '--only', item, ...(item === 'os-handoff-4x' ? ['--full'] : []), '--base', base, '--out', o], {
    cwd: d, encoding: 'utf8', env: childEnv({ FX_DIR: d, ...env }),
  });
  const json = JSON.parse(fs.readFileSync(path.join(o, 'verify-holo.json'), 'utf8'));
  const it = json.items.find((i) => i.id === item);
  return { exit: r.status, it, out: o, json, last: lastLine(r.stdout), stderr: r.stderr };
}
const FILTER = process.env.SELFTEST_FILTER ? new RegExp(process.env.SELFTEST_FILTER) : null; // dev aid for mutation runs: only the cases whose name matches; unset = all (CI, delivery)
const ok = (name, fn) => { if (FILTER && !FILTER.test(name)) return; fn(); n++; console.log(`PASS ${name}`); };

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
  "const k0 = fs.existsSync(path.join(process.env.FX_DIR, 'ime-count')) ? Number(fs.readFileSync(path.join(process.env.FX_DIR, 'ime-count'), 'utf8')) : 0; fs.writeFileSync(path.join(process.env.FX_DIR, 'ime-args-' + k0 + '.json'), JSON.stringify(a));",
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

ok('(ime-7) exit 0 contradicting result.json (failed>0 / invalid / envError / results pass:false) -> FAIL "internal error: holo-ime exited 0 but", never PASS', () => {
  const base = IME_PASS.result;
  const cases = { failed: { ...base, failed: 3 }, invalid: { ...base, invalid: 'probe' }, env: { ...base, envError: { kind: 'target-closed', step: 's', message: 'm' } }, nopass: { ...base, results: [...checks(IME_CHECKS), { name: 'bad', pass: false }] } };
  for (const [k, result] of Object.entries(cases)) {
    const r = runIme('ime7' + k, [{ exit: 0, result }]);
    assert.equal(r.attempts, 1, k); assert.equal(r.it.status, 'FAIL', k); assert.match(r.it.reason, /^internal error: holo-ime exited 0 but /, k);
  }
});

// ---- H2-0 coordinator 10: gaps found by the L2 re-check (every case below has a mutation that makes it fail; see the PR body)
const runRaw = (name, args, env = {}) => {
  const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(HERE, 'verify-holo.mjs'), ...args], { cwd: d, encoding: 'utf8', env: childEnv(env) });
  return { exit: r.status, last: lastLine(r.stdout), stdout: r.stdout, stderr: r.stderr, dir: d };
};
const dumpHooks = (name, env) => JSON.parse(runRaw(name, ['--dump-hooks'], env).stdout);
const HOOK_VARS = { VERIFY_HOLO_SELFTEST_HANDOFF: '/x/fake-handoff.mjs', VERIFY_HOLO_SELFTEST_IME: '/x/fake-ime.mjs', VERIFY_HOLO_SELFTEST_TIMEOUT_MS: '1234', VERIFY_HOLO_SELFTEST_BASE_FAIL: 'boom',
  VERIFY_HOLO_SELFTEST_FAKEPASS: '1', VERIFY_HOLO_SELFTEST_BASELINE: '/x/other-baseline.json', VERIFY_HOLO_SELFTEST_BUNDLE: '/x/fake-bundle.mjs', VERIFY_HOLO_SELFTEST_FAKESTATUS: '{"ci-check":"FAIL"}', HOLO_IME_SELFTEST_CDP: '/x/fake-cdp.mjs' };
const INERT = { st: false, handoffScript: 'os-handoff.mjs', imeScript: 'holo-ime.mjs', imeStub: false, timeoutMs: 40 * 60 * 1000, baseFail: null, fakePass: false, baselineFile: 'holo-baseline.json', bundleScript: 'os-bundle.mjs', fakeStatus: null, imeCdpModule: null };

ok('(h-1) every sub-hook (handoff script, holo-ime script, holo-ime url stub, holo-ime cdp module, timeout, base-fail, fake-pass, baseline file) is inert without VERIFY_HOLO_SELFTEST=1 (unset, "0", "true"), even with all their variables set; with "1" each one takes effect (control)', () => {
  for (const [i, v] of [undefined, '0', 'true'].entries()) {
    const d = dumpHooks(`hk${i}`, { ...HOOK_VARS, VERIFY_HOLO_SELFTEST: v });
    for (const k of Object.keys(INERT)) assert.deepEqual(d[k], INERT[k], `with VERIFY_HOLO_SELFTEST=${JSON.stringify(v)} the hook "${k}" must be inert (got ${JSON.stringify(d[k])})`);
  }
  const on = dumpHooks('hk-on', HOOK_VARS);
  assert.deepEqual(on, { st: true, handoffScript: 'fake-handoff.mjs', imeScript: 'fake-ime.mjs', imeStub: true, timeoutMs: 1234, baseFail: 'boom', fakePass: true, baselineFile: 'other-baseline.json', bundleScript: 'fake-bundle.mjs', fakeStatus: { 'ci-check': 'FAIL' }, imeCdpModule: 'fake-cdp.mjs' });
});
ok('(h-2) VERIFY_HOLO_SELFTEST=1 with every item a fake PASS (all items PASS) still never exits 0: exit 2, label SELFTEST (not PASS), json exitCode 2 and selftest:true', () => {
  const o = path.join(TMP, 'fp-out');
  const r = runRaw('fp', ['--full', '--out', o], { VERIFY_HOLO_SELFTEST_FAKEPASS: '1' });
  const json = JSON.parse(fs.readFileSync(path.join(o, 'verify-holo.json'), 'utf8'));
  assert.ok(json.items.length > 10 && json.items.every((i) => i.status === 'PASS'), 'premise: every item is PASS: ' + json.items.filter((i) => i.status !== 'PASS').map((i) => `${i.id}=${i.status}`).join(','));
  assert.match(r.last, /^VERIFY:HOLO SELFTEST (\d+)\/\1 pass — /); assert.doesNotMatch(r.last, /^VERIFY:HOLO (PASS|FAIL|INCOMPLETE)/);
  assert.equal(r.exit, 2); assert.equal(json.exitCode, 2); assert.equal(json.selftest, true);
});
ok('(h-3) the CI refusal leaves nothing behind: no pld-vh-* scratch folder in os.tmpdir() (own TEMP per child), while a normal run cleans its folder up too', () => {
  const countIn = (dir) => fs.readdirSync(dir).filter((x) => x.startsWith('pld-vh-') && x !== 'pld-vh-cache').length;
  const tmpOf = (n) => { const t = path.join(TMP, n); fs.mkdirSync(t, { recursive: true }); return { TEMP: t, TMP: t, TMPDIR: t, dir: t }; };
  const a = tmpOf('tmp-ci'); const r = runRaw('ci-leak', ['--only', 'redline-grep', '--out', path.join(TMP, 'ci-leak-out')], { CI: 'true', TEMP: a.TEMP, TMP: a.TMP, TMPDIR: a.TMPDIR });
  assert.equal(r.exit, 1); assert.match(r.last, /refused because CI is set/);
  assert.equal(countIn(a.dir), 0, 'a refused run must not leave a pld-vh-* folder: ' + fs.readdirSync(a.dir).join(','));
  const b = tmpOf('tmp-ok'); const r2 = runRaw('ci-ok', ['--only', 'redline-grep', '--out', path.join(TMP, 'ci-ok-out')], { TEMP: b.TEMP, TMP: b.TMP, TMPDIR: b.TMPDIR });
  assert.match(r2.last, /^VERIFY:HOLO SELFTEST/); assert.equal(countIn(b.dir), 0, 'a finished run removes its scratch folder');
});
ok('(h-4) entry-delta-vs-base: the --base worktree cannot be built -> FAIL (not INVALID), exit 1, value.baseUnavailable, says base (main) side / cannot be compared with main', () => {
  const emptyBase = mkLinkedBase('empty-base').base; // a linked worktree with no web/dist: verify-holo tries to build it, the hook makes that fail
  const r = run('eb', { branch: CLEAN }, { item: 'entry-delta-vs-base', base: emptyBase, env: { VERIFY_HOLO_SELFTEST_BASE_FAIL: 'could not build the --base worktree' } });
  assert.equal(r.it.status, 'FAIL', JSON.stringify(r.it)); assert.equal(r.exit, 1); assert.match(r.last, /^VERIFY:HOLO SELFTEST .*1 fail \(entry-delta-vs-base\)/);
  assert.equal(r.it.value.baseUnavailable, true); assert.match(r.it.reason, /base \(main\) side could not be started/); assert.match(r.it.reason, /could not build the --base worktree/); assert.match(r.it.reason, /cannot be compared with main/);
});
ok('(h-5) handoffAllowsDeviated / handoffExitProblem defaults mean "no --allow-deviated": DEVIATED-only is exit 3, exit 0 with DEVIATED and exit 3 under the flag are contradictions', () => {
  assert.equal(handoffAllowsDeviated(['--headed']), false); assert.equal(handoffAllowsDeviated(['--headed', '--allow-deviated']), true);
  const dev = { fail: 0, deviated: 3 };
  assert.notEqual(handoffExitProblem(0, dev), null, 'default: exit 0 with DEVIATED is a contradiction'); assert.equal(handoffExitProblem(3, dev), null, 'default: DEVIATED only is exit 3');
  assert.equal(handoffExitProblem(0, dev, { allowDeviated: true }), null); assert.notEqual(handoffExitProblem(3, dev, { allowDeviated: true }), null);
});
ok('(h-5b) real args WITHOUT --allow-deviated (baseline copy): exit 0 with DEVIATED rows -> FAIL internal error; DEVIATED-only exit 3 -> not an internal error', () => {
  const BLJ = JSON.parse(fs.readFileSync(path.join(HERE, 'holo-baseline.json'), 'utf8'));
  const noAllow = path.join(TMP, 'baseline-no-allow.json');
  fs.writeFileSync(noAllow, JSON.stringify({ ...BLJ, osHandoff: { ...BLJ.osHandoff, args: BLJ.osHandoff.args.filter((x) => x !== '--allow-deviated') } }));
  assert.ok(!handoffAllowsDeviated(buildHandoffArgs(JSON.parse(fs.readFileSync(noAllow, 'utf8')).osHandoff, 'u', 'o', 4)), 'premise: these args do not allow DEVIATED');
  const dev = mk(rowsOf({ i1: 30, dev: 5 }));
  const bad = run('nd1', { branch: { exit: 0, result: dev } }, { env: { VERIFY_HOLO_SELFTEST_BASELINE: noAllow } });
  assert.equal(bad.it.status, 'FAIL', JSON.stringify(bad.it)); assert.match(bad.it.reason, /internal error.*exited 0/);
  const good = run('nd2', { branch: { real: true, result: dev } }, { env: { VERIFY_HOLO_SELFTEST_BASELINE: noAllow } }); // the fake follows os-handoff's own rule: no flag -> DEVIATED only exits 3
  assert.doesNotMatch(String(good.it.reason ?? ''), /internal error/, JSON.stringify(good.it));
});
ok('(h-6) holo-ime verdict branches: fewer checks than the baseline -> FAIL; an exit code other than 0/1/2, or exit 0 without a result file -> INVALID (harness)', () => {
  const few = runIme('imeh1', [{ exit: 0, result: { ...IME_PASS.result, results: checks(IME_CHECKS - 1) } }]);
  assert.equal(few.it.status, 'FAIL'); assert.match(few.it.reason, new RegExp(`checks ${IME_CHECKS - 1} < baseline ${IME_CHECKS}`)); assert.equal(few.attempts, 1);
  const odd = runIme('imeh2', [{ exit: 9, result: IME_PASS.result }]);
  assert.equal(odd.it.status, 'INVALID'); assert.match(odd.it.reason, /holo-ime exit 9/);
  // H2-1 G2: an exit code outside 0/1/2 next to a COMPLETE PASS result.json is never a PASS (mutation: `r.code !== 0` loosened to `r.code > 3` lets exit 3 through)
  for (const code of [3, 4, 127]) {
    const r = runIme('imeh2-' + code, [{ exit: code, result: IME_PASS.result }]);
    assert.notEqual(r.it.status, 'PASS', `holo-ime exit ${code} with a full PASS result.json must not be PASS: ${JSON.stringify(r.it)}`);
    assert.equal(r.it.status, 'INVALID', `exit ${code}`); assert.match(r.it.reason, new RegExp(`holo-ime exit ${code}`)); assert.notEqual(r.exit, 0, 'and the overall exit is never 0');
  }
  const none = runIme('imeh3', [{ exit: 0 }]);
  assert.equal(none.it.status, 'INVALID'); assert.match(none.it.reason, /holo-ime exit 0/); assert.equal(none.it.value, null);
});
ok('(h-7) a retried holo-ime keeps the first attempt in result.attempt1.json next to the retry\'s result.json', () => {
  const r = runIme('imeh4', [imeEnv('page-not-ready'), IME_PASS]);
  const dir = path.join(TMP, 'imeh4', 'out', 'holo-ime');
  const a1 = JSON.parse(fs.readFileSync(path.join(dir, 'result.attempt1.json'), 'utf8')), a2 = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  assert.equal(a1.envError.kind, 'page-not-ready'); assert.equal(a1.results.length, 22); assert.equal(a2.results.length, IME_CHECKS); assert.equal(r.attempts, 2);
});
ok('(h-8) the real holo-ime command line (both attempts) is exactly the README one: --methods proj --freeze 1,0, nothing else but --url and --out', () => {
  const readme = fs.readFileSync(path.join(HERE, 'README.md'), 'utf8');
  assert.ok(readme.includes('`--methods proj --freeze 1,0`'), 'README must state the real holo-ime arguments');
  const r = runIme('imeh5', [imeEnv('page-not-ready'), IME_PASS]);
  const dir = path.join(TMP, 'imeh5', 'out', 'holo-ime');
  for (const k of [0, 1]) assert.deepEqual(JSON.parse(fs.readFileSync(path.join(TMP, 'imeh5', `ime-args-${k}.json`), 'utf8')), ['--url', 'http://localhost:0/', '--methods', 'proj', '--freeze', '1,0', '--out', dir]);
  assert.equal(r.attempts, 2);
});

// ================================================================== H2-1 (prerequisites): gaps G1 G3 G6 G7 (--base path), B2 fail-fast, B1 base cache. Every case here has a mutation that makes it fail (PR body / handoff list them).
const REAL = '工作' + '日誌'; // assembled: this file must not contain the real-data folder name
const ownTmp = (n) => { const t = path.join(TMP, n); fs.mkdirSync(t, { recursive: true }); return { TEMP: t, TMP: t, TMPDIR: t, dir: t }; }; // a private os.tmpdir() for one child
const vhLeft = (dir) => fs.readdirSync(dir).filter((x) => x.startsWith('pld-vh-') && x !== 'pld-vh-cache'); // scratch folders a run left behind (the cache folder is the B1 cache, created only when written)
const walkFiles = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkFiles(path.join(d, e.name)) : [path.join(d, e.name)])) : []);

ok('(g1) --dump-hooks only prints: no verify-holo.json, no --out folder (default or given), no verify-out, no scratch folder', () => {
  const customOut = path.join(TMP, 'g1-custom-out');
  for (const [i, args] of [['--dump-hooks'], ['--dump-hooks', '--out', path.join(customOut, 'deep')]].entries()) {
    const t = ownTmp(`g1t${i}`);
    const r = runRaw(`g1c${i}`, args, { TEMP: t.TEMP, TMP: t.TMP, TMPDIR: t.TMPDIR });
    assert.equal(r.exit, 0); assert.doesNotThrow(() => JSON.parse(r.stdout), 'it prints the hook table as JSON');
    assert.deepEqual(fs.readdirSync(r.dir), [], `the working directory must stay empty (verify-out/holo, verify-holo.json): ${fs.readdirSync(r.dir).join(',')}`);
    assert.deepEqual(fs.readdirSync(t.dir), [], 'the temp directory must stay empty');
  }
  assert.equal(fs.existsSync(customOut), false, 'the --out folder must not be created');
});
ok('(g3) the early exits leave no pld-vh-* scratch folder behind: --help, --out with the real-data folder name (refused), --only with an unknown id', () => {
  const cases = { help: [['--help'], 0], realName: [['--out', path.join(TMP, 'g3-real-' + REAL, 'out')], 2], unknownId: [['--only', 'no-such-item'], 2] };
  for (const [k, [args, want]] of Object.entries(cases)) {
    const t = ownTmp(`g3t-${k}`);
    const r = runRaw(`g3-${k}`, args, { TEMP: t.TEMP, TMP: t.TMP, TMPDIR: t.TMPDIR });
    assert.equal(r.exit, want, `${k}: exit ${r.exit}; stderr ${r.stderr.slice(0, 200)}`);
    assert.deepEqual(vhLeft(t.dir), [], `${k} left a scratch folder: ${fs.readdirSync(t.dir).join(',')}`);
  }
});
ok('(g6) --out containing the real-data folder name: refused (exit 2) before anything is created; the folder (and its parents made for it) does not exist afterwards; a clean --out is created (control)', () => {
  const parent = path.join(TMP, 'g6-' + REAL); const out = path.join(parent, 'out');
  const r = runRaw('g6', ['--only', 'redline-grep', '--out', out]);
  assert.equal(r.exit, 2); assert.match(r.stderr, /refusing a path that contains the real-data folder name/);
  assert.equal(fs.existsSync(path.join(out, 'logs')), false, 'logs folder must not exist'); assert.equal(fs.existsSync(out), false, '--out folder must not exist'); assert.equal(fs.existsSync(parent), false, 'its parent must not exist');
  const okOut = path.join(TMP, 'g6-control', 'out'); runRaw('g6c', ['--only', 'redline-grep', '--out', okOut]);
  assert.ok(fs.existsSync(path.join(okOut, 'verify-holo.json')), 'control: a clean --out is created and written');
});
ok('(g7) --base that does not exist (path contains "someone"): stdout, stderr, verify-holo.json and every log show only the last folder (…/name), never the absolute path', () => {
  for (const item of ['c1-web', 'c1-os', 'entry-delta-vs-base']) {
    const base = path.join(TMP, 'someone', 'no-such-base-' + item); const o = path.join(TMP, 'g7-out-' + item);
    const r = runRaw('g7-' + item, ['--only', item, '--base', base, '--out', o]);
    const files = walkFiles(o); assert.ok(files.some((f) => f.endsWith('verify-holo.json')) && files.some((f) => f.endsWith(`${item}.log`)), 'premise: json and the item log exist');
    const blobs = { stdout: r.stdout, stderr: r.stderr, ...Object.fromEntries(files.map((f) => [path.relative(o, f), fs.readFileSync(f, 'utf8')])) };
    const it = JSON.parse(blobs['verify-holo.json']).items.find((i) => i.id === item);
    assert.equal(it.status, 'FAIL', `${item}: ${JSON.stringify(it)}`); assert.equal(it.value.baseUnavailable, true); assert.match(it.reason, new RegExp(`…/no-such-base-${item}`));
    for (const [name, text] of Object.entries(blobs)) for (const bad of [base, base.split(path.sep).join('/'), base.split('/').join('\\'), 'someone']) assert.ok(!text.includes(bad), `${item}: ${name} contains ${JSON.stringify(bad)}`);
  }
});
// ---- B2: fail-fast (quick stage first). FAKESTATUS makes each item a fake with the given status and every other item a fake PASS, so only the stage logic is under test.
const CD = ['lab-bundle', 'c1-web', 'c1-os', 'os-e2e', 'os-handoff', 'holo-ime', 'holo-still', 'holo-perf', 'holo-perf-20k'];
const AB = ['ci-check', 'ci-test', 'ci-typecheck', 'ci-test-web', 'ci-build', 'ci-bundle', 'entry-delta-vs-base', 'tests-untouched', 'redline-grep'];
function runFF(name, status, args = []) {
  const o = path.join(TMP, name + '-out');
  const r = runRaw(name, [...args, '--out', o], { VERIFY_HOLO_SELFTEST_FAKESTATUS: JSON.stringify(status) });
  const json = JSON.parse(fs.readFileSync(path.join(o, 'verify-holo.json'), 'utf8'));
  return { r, json, by: Object.fromEntries(json.items.map((i) => [i.id, i])) };
}
const skippedBecause = (x, ids) => CD.every((id) => x.by[id].status === 'SKIP' && x.by[id].reason === `not run: quick stage failed (${ids.join(', ')})`);
ok('(b2-1) a FAIL in A: C and D are SKIP "not run: quick stage failed (<id>)", exit 1, json.failFast {enabled, triggered, by}, summary line says FAIL-FAST; os-handoff-4x stays N/A without --full', () => {
  const x = runFF('b2a', { 'ci-check': 'FAIL' });
  assert.ok(skippedBecause(x, ['ci-check']), JSON.stringify(CD.map((id) => [id, x.by[id].status, x.by[id].reason])));
  assert.equal(x.by['os-handoff-4x'].status, 'N/A'); assert.equal(x.by['ci-check'].status, 'FAIL'); assert.ok(AB.filter((id) => id !== 'ci-check').every((id) => x.by[id].status === 'PASS'), 'the rest of A and B ran');
  assert.equal(x.r.exit, 1); assert.equal(x.json.exitCode, 1); assert.deepEqual(x.json.failFast, { enabled: true, triggered: true, by: ['ci-check'] });
  assert.match(x.r.last, /FAIL-FAST: C and D not run because the quick stage failed \(ci-check\)/); assert.match(x.r.last, /1 fail \(ci-check\)/); assert.match(x.r.last, /9 skip/); assert.ok(x.json.summary.skip.includes('c1-web'));
});
ok('(b2-2) everything PASS in A and B: C and D run as usual (fake PASS), failFast.triggered false, no FAIL-FAST in the summary', () => {
  const x = runFF('b2b', {});
  assert.ok(CD.every((id) => x.by[id].status === 'PASS'), JSON.stringify(CD.map((id) => [id, x.by[id].status]))); assert.deepEqual(x.json.failFast, { enabled: true, triggered: false, by: [] }); assert.doesNotMatch(x.r.last, /FAIL-FAST/);
});
ok('(b2-3) --no-fail-fast: C and D run even though A has a FAIL; exit still 1; failFast.enabled false; args.noFailFast true', () => {
  const x = runFF('b2c', { 'ci-check': 'FAIL' }, ['--no-fail-fast']);
  assert.ok(CD.every((id) => x.by[id].status === 'PASS'), JSON.stringify(CD.map((id) => [id, x.by[id].status]))); assert.equal(x.r.exit, 1); assert.deepEqual(x.json.failFast, { enabled: false, triggered: false, by: [] }); assert.equal(x.json.args.noFailFast, true);
});
ok('(b2-4) an INVALID counts too (group B), and several ids are all listed: C and D SKIP, exit 2 (no FAIL); with a FAIL and an INVALID the reason lists both in run order', () => {
  const inv = runFF('b2d', { 'redline-grep': 'INVALID' });
  assert.ok(skippedBecause(inv, ['redline-grep']), JSON.stringify(CD.map((id) => [id, inv.by[id].status, inv.by[id].reason]))); assert.equal(inv.r.exit, 2); assert.equal(inv.json.failFast.triggered, true); assert.match(inv.r.last, /1 invalid \(redline-grep\)/);
  const both = runFF('b2d2', { 'ci-test': 'FAIL', 'tests-untouched': 'INVALID' });
  assert.ok(skippedBecause(both, ['ci-test', 'tests-untouched']), JSON.stringify(both.by['c1-web'])); assert.equal(both.r.exit, 1); assert.deepEqual(both.json.failFast.by, ['ci-test', 'tests-untouched']);
});
ok('(b2-5) only the quick stage gates: a FAIL in C does not skip D; a SKIP in A (no --base) does not trigger; --only without any A/B item run does not trigger', () => {
  const c = runFF('b2e', { 'c1-web': 'FAIL' });
  assert.equal(c.by['c1-web'].status, 'FAIL'); assert.ok(['holo-ime', 'holo-still', 'holo-perf', 'holo-perf-20k', 'c1-os'].every((id) => c.by[id].status === 'PASS')); assert.equal(c.json.failFast.triggered, false); assert.equal(c.r.exit, 1);
  const s = runFF('b2g', { 'entry-delta-vs-base': 'SKIP' });
  assert.ok(CD.every((id) => s.by[id].status === 'PASS')); assert.equal(s.json.failFast.triggered, false);
  const only = runFF('b2i', { 'ci-check': 'FAIL' }, ['--only', 'c1-web']);
  assert.equal(only.by['c1-web'].status, 'PASS'); assert.equal(only.by['ci-check'].status, 'SKIP'); assert.equal(only.json.failFast.triggered, false);
  const both = runFF('b2i2', { 'ci-check': 'FAIL' }, ['--only', 'ci-check,c1-web']);
  assert.equal(both.by['ci-check'].status, 'FAIL'); assert.equal(both.by['c1-web'].status, 'SKIP'); assert.equal(both.by['c1-web'].reason, 'not run: quick stage failed (ci-check)');
});
ok('(b2-6) --quick is unchanged (C and D "skipped by --quick", failFast.enabled false); with --full a triggered fail-fast also skips os-handoff-4x', () => {
  const q = runFF('b2f', { 'ci-check': 'FAIL' }, ['--quick']);
  assert.ok(CD.every((id) => q.by[id].status === 'SKIP' && /skipped by --quick/.test(q.by[id].reason))); assert.deepEqual(q.json.failFast, { enabled: false, triggered: false, by: [] });
  const f = runFF('b2h', { 'ci-check': 'FAIL' }, ['--full']);
  assert.equal(f.by['os-handoff-4x'].status, 'SKIP'); assert.equal(f.by['os-handoff-4x'].reason, 'not run: quick stage failed (ci-check)'); assert.ok(skippedBecause(f, ['ci-check']));
});

// ---- B1: the --base cache. A fake base worktree (a real git repo in the temp folder whose `npm run build` writes web/dist and counts itself), a fake os-bundle script that counts its calls,
// and a private cache directory (VERIFY_HOLO_CACHE_DIR). The real verify-holo.mjs decides everything.
const FAKE_BUNDLE = path.join(TMP, 'fake-bundle.mjs');
fs.writeFileSync(FAKE_BUNDLE, [
  "import fs from 'node:fs'; import path from 'node:path';",
  "const a = process.argv.slice(2); const arg = (k) => a[a.indexOf(k) + 1]; const dist = arg('--dist');",
  "fs.appendFileSync(path.join(process.env.FX_DIR, 'bundle-calls.log'), dist + String.fromCharCode(10));",
  "if (process.env.FX_ECHO_BASE) console.log('measuring ' + dist + ' (' + dist.split(String.fromCharCode(92)).join('/') + ')');",
  "const BS = String.fromCharCode(92); const mixed = dist.split(BS).join('/').replace('/', BS); // forward slashes with the first separator flipped: a mixed spelling",
  "const spellings = [dist, dist.split(BS).join('/'), JSON.stringify(dist), JSON.stringify(JSON.stringify(dist)), mixed, mixed.split(BS).join(BS + BS)];",
  "if (process.env.FX_SIDECAR) { fs.writeFileSync(arg('--json').replace(/[.]json$/, '') + '.raw.txt', spellings.join(String.fromCharCode(10))); fs.mkdirSync(path.join(path.dirname(arg('--json')), 'sub'), { recursive: true }); fs.writeFileSync(path.join(path.dirname(arg('--json')), 'sub', 'detail'), spellings.join(' ; ')); if (dist.startsWith(process.env.FX_BASE_ROOT)) fs.writeFileSync(path.join(process.env.FX_DIR, 'emitted.txt'), spellings.join(String.fromCharCode(10))); }",
  "fs.writeFileSync(arg('--json'), JSON.stringify({ dist, entryGzip: dist.startsWith(process.env.FX_BASE_ROOT) ? Number(process.env.FX_BASE_ENTRY || 50) : 100 }, null, 2));",
  '',
].join(String.fromCharCode(10)));
const git = (cwd, ...args) => { const e = { ...process.env }; delete e.GIT_DIR; delete e.GIT_WORK_TREE; delete e.GIT_INDEX_FILE; const r = spawnSync('git', ['-c', 'user.name=selftest', '-c', 'user.email=selftest@example.invalid', ...args], { cwd, encoding: 'utf8', env: e }); assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
function mkScenario(name, { under = null } = {}) {
  const root = path.join(TMP, ...(under ? [under] : []), 'b1-' + name); const main = path.join(root, 'main'); const base = path.join(root, 'base'); const cache = path.join(root, 'cache'); const fx = path.join(root, 'fx');
  for (const d of [main, path.join(main, 'backend'), fx]) fs.mkdirSync(d, { recursive: true });
  const w = (f, t) => fs.writeFileSync(path.join(main, f), t);
  w('package.json', JSON.stringify({ name: 'fake-base', version: '0.0.0', private: true, scripts: { build: 'node build.js' } }));
  w('build.js', "const fs = require('fs'); fs.mkdirSync('web/dist', { recursive: true }); fs.writeFileSync('web/dist/index.html', 'built ' + (process.env.FX_TAG || '1')); fs.appendFileSync(process.env.FX_DIR + '/builds.log', 'b\\n');\n");
  w('.gitignore', 'web/dist\nnode_modules\n.env*\n'); w('package-lock.json', '{}\n'); w(path.join('backend', 'server.js'), '// fake\n');
  git(main, 'init', '-q'); git(main, 'add', '-A'); git(main, 'commit', '-q', '-m', 'init'); git(main, 'worktree', 'add', '-q', '-b', 'wt', base); // --base is a LINKED worktree, like pld-wt/h2-base
  fs.mkdirSync(path.join(base, 'node_modules'), { recursive: true }); fs.writeFileSync(path.join(base, 'node_modules', '.package-lock.json'), '{"installed":1}\n'); // gitignored: git status stays clean
  return { root, main, base, cache, fx, n: 0 };
}
function goB1(sc, { args = [], env = {}, only = 'entry-delta-vs-base', out = null, script = path.join(HERE, 'verify-holo.mjs'), base = sc.base } = {}) {
  const o = out ?? path.join(sc.root, `out${++sc.n}`);
  const r = spawnSync(process.execPath, [script, '--only', only, '--base', base, '--out', o, ...args], {
    cwd: sc.root, encoding: 'utf8', env: childEnv({ VERIFY_HOLO_SELFTEST_BUNDLE: FAKE_BUNDLE, FX_DIR: sc.fx, FX_BASE_ROOT: sc.base, VERIFY_HOLO_CACHE_DIR: sc.cache, ...env }),
  });
  const jf = path.join(o, 'verify-holo.json');
  const json = fs.existsSync(jf) ? JSON.parse(fs.readFileSync(jf, 'utf8')) : null;
  return { r, out: o, json, it: json?.items.find((i) => i.id === only), builds: lines(path.join(sc.fx, 'builds.log')).length, baseMeasures: lines(path.join(sc.fx, 'bundle-calls.log')).filter((l) => l.startsWith(sc.base)).length, calls: lines(path.join(sc.fx, 'bundle-calls.log')).length };
}
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : []);
const snap = (dir) => JSON.stringify(walkFiles(dir).sort().map((f) => [path.relative(dir, f), fs.readFileSync(f, 'utf8')]));
const entryFile = (sc) => walkFiles(sc.cache).find((f) => /base-[0-9a-f]+\.json$/.test(f));

ok('(b1-1) base side by commit: first run builds and measures base (cached false, entry written); the second run hits: no build, no base measurement, same number and time, cached true, key summary and "CACHED" in json and log; the branch side is measured every time', () => {
  const sc = mkScenario('s1'); const head = git(sc.base, 'rev-parse', 'HEAD');
  const a = goB1(sc); assert.equal(a.it.status, 'PASS', JSON.stringify(a.it)); assert.equal(a.it.value.cached, false); assert.equal(a.builds, 1); assert.equal(a.baseMeasures, 1); assert.equal(walkFiles(sc.cache).length, 1);
  assert.equal(a.it.value.baseEntryGzip, 50); assert.equal(a.it.value.branchEntryGzip, 100); assert.equal(a.it.value.deltaBytes, 50); assert.equal(a.it.value.baseCache.buildCached, false);
  const b = goB1(sc); assert.equal(b.it.status, 'PASS'); assert.equal(b.it.value.cached, true); assert.equal(b.builds, 1, 'no second build'); assert.equal(b.baseMeasures, 1, 'no second base measurement'); assert.equal(b.calls, 3, 'branch measured again');
  assert.equal(b.it.value.baseEntryGzip, 50); assert.equal(b.it.value.measuredAt, a.it.value.measuredAt, 'the original measurement time is reported'); assert.equal(b.it.value.baseCache.buildCached, true); assert.equal(b.it.value.baseCache.entryCached, true);
  const k = b.it.value.baseCache; assert.equal(k.mode, 'on'); assert.equal(k.key.baseHead, head.slice(0, 12)); assert.equal(k.key.node, process.version); assert.equal(k.key.lockHash.length, 12);
  assert.deepEqual(Object.keys(k.key.scripts), ['bundle-graph.mjs', 'holo-baseline.json', 'os-bundle.mjs'], 'the verification scripts that decide the result are part of the key'); assert.equal(k.key.params, 'entry-gzip9-static-graph-v1');
  assert.match(fs.readFileSync(path.join(b.out, 'logs', 'entry-delta-vs-base.log'), 'utf8'), /base build: CACHED/); assert.match(fs.readFileSync(path.join(b.out, 'logs', 'entry-delta-vs-base.log'), 'utf8'), /base entry size: CACHED 50 B/);
  assert.equal(b.json.args.noCache, false);
});
ok('(b1-2) a different base HEAD does not hit (rebuild + re-measure, a second entry); the new commit then hits', () => {
  const sc = mkScenario('s2'); goB1(sc); goB1(sc);
  git(sc.base, 'commit', '-q', '--allow-empty', '-m', 'second');
  const c = goB1(sc); assert.equal(c.it.value.cached, false); assert.equal(c.builds, 2); assert.equal(c.baseMeasures, 2); assert.equal(walkFiles(sc.cache).length, 2);
  const d = goB1(sc); assert.equal(d.it.value.cached, true); assert.equal(d.builds, 2);
});
ok('(b1-3) a dirty base worktree is never cached: no read (always rebuilt and re-measured, cached false, mode off) and no write (cache folder bit-identical); clean again -> the earlier entry hits', () => {
  const sc = mkScenario('s3'); goB1(sc); goB1(sc); const before = snap(sc.cache);
  fs.writeFileSync(path.join(sc.base, 'junk.txt'), 'x');
  const c = goB1(sc); assert.equal(c.it.value.cached, false); assert.equal(c.it.value.baseCache.mode, 'off'); assert.match(c.it.value.baseCache.reason, /not clean/); assert.equal(c.builds, 2); assert.equal(c.baseMeasures, 2); assert.equal(snap(sc.cache), before, 'a dirty run must not write the cache');
  const d = goB1(sc); assert.equal(d.it.value.cached, false); assert.equal(d.builds, 3); assert.equal(snap(sc.cache), before);
  fs.rmSync(path.join(sc.base, 'junk.txt'));
  const e = goB1(sc); assert.equal(e.it.value.cached, true); assert.equal(e.builds, 3);
  fs.writeFileSync(path.join(sc.base, 'package.json'), fs.readFileSync(path.join(sc.base, 'package.json'), 'utf8') + ' '); // a modified TRACKED file is dirty too
  const f = goB1(sc); assert.equal(f.it.value.cached, false); assert.equal(f.it.value.baseCache.mode, 'off'); assert.equal(f.builds, 4);
});
ok('(b1-4) --no-cache neither reads nor writes: an existing cache is ignored and left bit-identical, a missing cache folder is not created; args.noCache true', () => {
  const sc = mkScenario('s4'); goB1(sc); goB1(sc); const before = snap(sc.cache);
  const c = goB1(sc, { args: ['--no-cache'] }); assert.equal(c.it.value.cached, false); assert.equal(c.it.value.baseCache.mode, 'off'); assert.match(c.it.value.baseCache.reason, /--no-cache/); assert.equal(c.builds, 2); assert.equal(c.baseMeasures, 2); assert.equal(snap(sc.cache), before); assert.equal(c.json.args.noCache, true);
  const sc2 = mkScenario('s4b'); const d = goB1(sc2, { args: ['--no-cache'] }); assert.equal(d.it.status, 'PASS'); assert.equal(fs.existsSync(sc2.cache), false, '--no-cache must not even create the cache folder');
});
ok('(b1-5) a corrupt or malformed cache entry is a miss (rebuild, re-measure, entry rewritten), never a crash and never a hit; afterwards the rewritten entry hits', () => {
  const sc = mkScenario('s5'); goB1(sc); const valid = JSON.parse(fs.readFileSync(entryFile(sc), 'utf8'));
  const variants = {
    garbage: 'not json{', empty: '', jsonNull: 'null', jsonArray: '[]', truncated: JSON.stringify(valid).slice(0, 40), otherDigest: JSON.stringify({ ...valid, digest: 'x' + valid.digest.slice(1) }), schema2: JSON.stringify({ ...valid, schema: 2 }),
    gzipString: JSON.stringify({ ...valid, entryGzip: '50' }), gzipNegative: JSON.stringify({ ...valid, entryGzip: -5 }), gzipNaN: '{"schema":1,"entryGzip":NaN}', distShort: JSON.stringify({ ...valid, distHash: 'abc' }), keyAltered: JSON.stringify({ ...valid, key: { ...valid.key, baseHead: 'f'.repeat(40) } }),
    badTime: JSON.stringify({ ...valid, measuredAt: 'yesterday' }), noBuiltAt: JSON.stringify({ ...valid, builtAt: undefined }),
  };
  let builds = 1;
  for (const [k, text] of Object.entries(variants)) {
    fs.writeFileSync(entryFile(sc), text);
    const r = goB1(sc); builds++;
    assert.ok(r.json, `${k}: no json (crash?) ${r.r.stderr.slice(0, 300)}`); assert.doesNotMatch(r.r.stderr, /Error|at .*\(/, `${k}: stderr ${r.r.stderr.slice(0, 300)}`);
    assert.equal(r.it.status, 'PASS', `${k}: ${JSON.stringify(r.it)}`); assert.equal(r.it.value.cached, false, `${k}: must not be a hit`); assert.equal(r.builds, builds, `${k}: must rebuild`);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(entryFile(sc), 'utf8')), `${k}: entry rewritten as valid json`);
  }
  const last = goB1(sc); assert.equal(last.it.value.cached, true); assert.equal(last.builds, builds);
  fs.rmSync(sc.cache, { recursive: true }); fs.writeFileSync(sc.cache, 'a file where the folder should be'); // unwritable cache location: still a normal (uncached) result
  const w = goB1(sc); assert.equal(w.it.status, 'PASS'); assert.equal(w.it.value.cached, false); assert.match(fs.readFileSync(path.join(w.out, 'logs', 'entry-delta-vs-base.log'), 'utf8'), /could not write the entry/);
});
ok('(b1-6) the dist is part of the hit: a base web/dist that no longer matches the stored hash (edited, deleted) is rebuilt and RE-MEASURED, the stored number is not reused for different bytes', () => {
  const sc = mkScenario('s6'); goB1(sc); goB1(sc);
  fs.writeFileSync(path.join(sc.base, 'web', 'dist', 'index.html'), 'tampered');
  const c = goB1(sc); assert.equal(c.it.value.cached, false); assert.equal(c.builds, 2); assert.equal(c.baseMeasures, 2); assert.equal(fs.readFileSync(path.join(sc.base, 'web', 'dist', 'index.html'), 'utf8'), 'built 1', 'rebuilt');
  fs.rmSync(path.join(sc.base, 'web', 'dist'), { recursive: true });
  const d = goB1(sc); assert.equal(d.it.value.cached, false); assert.equal(d.builds, 3);
  const e = goB1(sc); assert.equal(e.it.value.cached, true); assert.equal(e.builds, 3);
});
ok('(b1-7) cache directory rules: VERIFY_HOLO_CACHE_DIR must be absolute, must not contain the real-data folder name, must not be inside this repo or the --base worktree -> refused (exit 2), nothing created', () => {
  const sc = mkScenario('s7'); const repo = path.resolve(HERE, '..', '..');
  const bad = { relative: 'rel-cache', realName: path.join(TMP, 'b1-s7', 'c-' + REAL), insideRepo: path.join(repo, 'verify-out', 'cache-x'), insideBase: path.join(sc.base, 'cache-x') };
  for (const [k, dir] of Object.entries(bad)) {
    const r = goB1(sc, { env: { VERIFY_HOLO_CACHE_DIR: dir } });
    assert.equal(r.r.status, 2, `${k}: exit ${r.r.status}`); assert.match(r.r.stderr, /refusing the cache directory/); assert.equal(r.json, null, `${k}: nothing may be written`);
    if (path.isAbsolute(dir)) assert.equal(fs.existsSync(dir), false, `${k}: the folder must not be created`);
  }
  assert.equal(fs.existsSync(path.join(sc.root, 'rel-cache')), false);
});
ok('(g7b) the base path is also scrubbed from child-process output in the logs (every spelling: as given, resolved, / or \\)', () => {
  // an existing --base: its absolute path shows up in what os-bundle / npm print; the item log must show …/<name> instead
  const sc = mkScenario('g7b'); const r = goB1(sc, { env: { FX_ECHO_BASE: '1' } });
  const log = fs.readFileSync(path.join(r.out, 'logs', 'entry-delta-vs-base.log'), 'utf8');
  assert.ok(log.includes('…/' + path.basename(sc.base))); for (const bad of [sc.base, sc.base.split(path.sep).join('/')]) assert.ok(!log.includes(bad), `log contains ${bad}`);
});

// ================================================================== verification-tool PR (F1-F5, lab-bundle P4): every case below has a mutation that makes it fail (the PR body lists them).
const BS = String.fromCharCode(92);
const flipFirst = (p) => p.split(BS).join('/').replace('/', BS);
/** every spelling of a path that the sweep must remove (the same ones the fake bundle emits, plus the doubled-slash and lower-case forms) */
const spellingsOf = (p) => [p, p.split(BS).join('/'), p.split('/').join(BS), JSON.stringify(p).slice(1, -1), JSON.stringify(JSON.stringify(p)).slice(1, -1), flipFirst(p), flipFirst(p).split(BS).join(BS + BS)];
const filesText = (dir) => walkFiles(dir).map((f) => [path.relative(dir, f), fs.readFileSync(f, 'utf8')]);

ok('(f1-1) F1: gitignored build inputs are part of the key. web/.env.local added, edited, removed; node_modules/.package-lock.json edited: each is a MISS (rebuild + re-measure) with web/dist untouched; unchanged again = hit', () => {
  const sc = mkScenario('f1a'); const envFile = path.join(sc.base, 'web', '.env.local'); fs.mkdirSync(path.join(sc.base, 'web'), { recursive: true });
  const a = goB1(sc); assert.equal(a.it.value.cached, false); assert.equal(a.builds, 1);
  const b = goB1(sc); assert.equal(b.it.value.cached, true, 'premise: the unchanged base hits'); assert.equal(b.builds, 1);
  assert.equal(git(sc.base, 'status', '--porcelain'), '', 'premise: the base worktree stays clean (the inputs are gitignored)');
  fs.writeFileSync(envFile, 'VITE_FLAG=1'); assert.equal(git(sc.base, 'status', '--porcelain'), '', 'premise: .env.local is invisible to git');
  const c = goB1(sc); assert.equal(c.it.value.cached, false, 'a new web/.env.local must not hit the old entry'); assert.equal(c.builds, 2); assert.equal(c.baseMeasures, 2); assert.equal(c.it.value.baseCache.mode, 'on'); assert.equal(walkFiles(sc.cache).length, 2);
  const c2 = goB1(sc); assert.equal(c2.it.value.cached, true); assert.equal(c2.builds, 2);
  fs.writeFileSync(envFile, 'VITE_FLAG=2');
  const d = goB1(sc); assert.equal(d.it.value.cached, false, 'edited .env.local content'); assert.equal(d.builds, 3);
  fs.rmSync(envFile);
  const e = goB1(sc); assert.equal(e.it.value.cached, true, 'removed again = the original key: its entry hits'); assert.equal(e.builds, 3);
  fs.writeFileSync(path.join(sc.base, 'node_modules', '.package-lock.json'), '{"installed":2}\n');
  const f = goB1(sc); assert.equal(f.it.value.cached, false, 'a changed installed tree (node_modules/.package-lock.json)'); assert.equal(f.builds, 4); assert.equal(f.it.value.baseCache.mode, 'on');
  const g = goB1(sc); assert.equal(g.it.value.cached, true); assert.equal(g.builds, 4);
});
ok('(f1-2) F1: node_modules/.package-lock.json missing = not cacheable: no read, no write (cache folder bit-identical), rebuilt every time, reason in baseCache; restoring it makes the earlier entry hit again', () => {
  const sc = mkScenario('f1b'); const lock = path.join(sc.base, 'node_modules', '.package-lock.json'); const original = fs.readFileSync(lock, 'utf8');
  goB1(sc); goB1(sc); const before = snap(sc.cache);
  fs.rmSync(lock);
  const a = goB1(sc); assert.equal(a.it.status, 'PASS'); assert.equal(a.it.value.cached, false); assert.equal(a.it.value.baseCache.mode, 'off'); assert.match(a.it.value.baseCache.reason, /package-lock\.json is missing/); assert.equal(a.builds, 2); assert.equal(snap(sc.cache), before, 'no write');
  const b = goB1(sc); assert.equal(b.it.value.cached, false); assert.equal(b.builds, 3, 'and no read: rebuilt again although a valid entry for the same commit exists');
  fs.writeFileSync(lock, original);
  const c = goB1(sc); assert.equal(c.it.value.cached, true); assert.equal(c.builds, 3);
  const sc2 = mkScenario('f1b2'); fs.rmSync(path.join(sc2.base, 'node_modules'), { recursive: true }); const d = goB1(sc2); assert.equal(d.it.value.baseCache.mode, 'off'); assert.equal(fs.existsSync(sc2.cache), false, 'a base with no node_modules at all never creates the cache folder');
});
ok('(f1-3) F1: the VITE_* variables of the run are part of the key (a build reads them); a variable vite does not expose is not', () => {
  const sc = mkScenario('f1c'); goB1(sc, { env: { VITE_X: undefined } });
  const a = goB1(sc, { env: { VITE_X: '1' } }); assert.equal(a.it.value.cached, false); assert.equal(a.builds, 2);
  const b = goB1(sc, { env: { VITE_X: '1' } }); assert.equal(b.it.value.cached, true);
  const c = goB1(sc, { env: { VITE_X: '2' } }); assert.equal(c.it.value.cached, false); assert.equal(c.builds, 3);
  const d = goB1(sc, { env: { VITE_X: undefined, SOME_UNRELATED_VARIABLE: 'x' } }); assert.equal(d.it.value.cached, true, 'the original key (no VITE_X) hits; an unrelated variable changes nothing'); assert.equal(d.builds, 3);
  assert.equal(a.it.value.baseCache.key.envHash.length, 12); assert.equal(a.it.value.baseCache.key.nodeModulesHash.length, 12);
});
ok('(f5-1) F5: the verification scripts that decide the number are part of the key by CONTENT, through the real verify-holo.mjs: a clone of scripts/verify whose bundle-graph.mjs, holo-baseline.json or os-bundle.mjs changes by one byte misses; unchanged = hit', () => {
  const cloneRoot = path.join(TMP, 'f5-clone'); const cv = path.join(cloneRoot, 'scripts', 'verify'); fs.mkdirSync(cv, { recursive: true });
  for (const f of fs.readdirSync(HERE)) if (/[.](?:mjs|json)$/.test(f) && f !== 'verify-holo.selftest.mjs') fs.copyFileSync(path.join(HERE, f), path.join(cv, f));
  const sc = mkScenario('f5'); const script = path.join(cv, 'verify-holo.mjs'); const go = () => goB1(sc, { script });
  const a = go(); assert.equal(a.it.status, 'PASS', JSON.stringify(a.it) + a.r.stderr.slice(0, 300)); assert.equal(a.it.value.cached, false); assert.equal(a.builds, 1);
  const b = go(); assert.equal(b.it.value.cached, true, 'premise: the clone itself hits'); assert.equal(b.builds, 1);
  const k0 = b.it.value.baseCache.keyDigest;
  for (const [i, f] of ['bundle-graph.mjs', 'holo-baseline.json', 'os-bundle.mjs'].entries()) {
    const p = path.join(cv, f); const orig = fs.readFileSync(p);
    fs.writeFileSync(p, Buffer.concat([orig, Buffer.from(f.endsWith('.json') ? ' ' : '\n// changed\n')]));
    const m = go(); assert.equal(m.it.value.cached, false, f + ' changed must miss'); assert.notEqual(m.it.value.baseCache.keyDigest, k0, f); assert.equal(m.builds, 2 + i);
    fs.writeFileSync(p, orig);
    const back = go(); assert.equal(back.it.value.cached, true, f + ' restored: the original entry hits'); assert.equal(back.it.value.baseCache.keyDigest, k0);
  }
});
ok('(f2-1) F2: nothing under --out contains the --base path in ANY spelling (raw, forward, JSON-escaped, double-escaped, mixed, doubled) - not the logs, not verify-holo.json, not entry-delta-base.json "dist", not the sub-script sidecars (any extension, nested)', () => {
  const sc = mkScenario('f2', { under: 'someone' }); const out = path.join(TMP, 'f2-out');
  const r = goB1(sc, { out, env: { FX_ECHO_BASE: '1', FX_SIDECAR: '1' } });
  assert.equal(r.it.status, 'PASS', JSON.stringify(r.it)); assert.ok(r.baseMeasures >= 1, 'premise: the base was measured');
  const emitted = fs.readFileSync(path.join(sc.fx, 'emitted.txt'), 'utf8'); assert.ok(/someone/.test(emitted), 'premise: the sub-script really emitted base paths');
  const files = filesText(out); const names = files.map(([n2]) => n2.split(path.sep).join('/'));
  for (const must of ['entry-delta-base.json', 'entry-delta-base.raw.txt', 'sub/detail', 'verify-holo.json', 'logs/entry-delta-vs-base.log']) assert.ok(names.includes(must), 'premise: ' + must + ' exists: ' + names.join(','));
  const bad = [...spellingsOf(sc.base), ...spellingsOf(path.join(sc.base, 'web', 'dist')), 'someone'];
  for (const [name, text] of files) for (const b of bad) assert.ok(!text.toLowerCase().includes(b.toLowerCase()), name + ' contains ' + JSON.stringify(b));
  const dj = JSON.parse(fs.readFileSync(path.join(out, 'entry-delta-base.json'), 'utf8')); assert.match(dj.dist, /^…\/base/, 'the dist field keeps the last folder: ' + dj.dist); assert.equal(dj.entryGzip, 50, 'the measurement itself is untouched');
  assert.equal(r.it.value.baseEntryGzip, 50);
});
ok('(f4) F4: --only with nothing in it ("", ",", " ", ", ,", --only=) is a usage error: exit 2, usage printed, no item started, no server, no --out folder, no default verify-out, no scratch folder', () => {
  for (const [i, args] of [['--only', ''], ['--only', ','], ['--only', ' '], ['--only', ', ,'], ['--only='], ['--only', ' , ']].entries()) {
    const t = ownTmp('f4t' + i); const o = path.join(TMP, 'f4-out' + i);
    // FAKEPASS: if the check were missing the run would fall through to "all items"; every item is a harmless fake PASS then (no npm, no server, no browser), so a regression fails the assertions instead of starting real work
    const r = runRaw('f4c' + i, [...args, '--out', o], { TEMP: t.TEMP, TMP: t.TMP, TMPDIR: t.TMPDIR, VERIFY_HOLO_SELFTEST_FAKEPASS: '1' });
    assert.equal(r.exit, 2, JSON.stringify(args) + ': exit ' + r.exit + ' ' + r.stderr.slice(0, 200)); assert.match(r.stderr, /--only needs at least one item id/); assert.match(r.stderr, /npm run verify:holo/, 'usage is printed');
    assert.equal(fs.existsSync(o), false, JSON.stringify(args) + ': --out must not be created'); assert.deepEqual(fs.readdirSync(r.dir), [], 'the working directory (default verify-out) stays empty'); assert.deepEqual(fs.readdirSync(t.dir), [], 'no scratch folder');
    assert.doesNotMatch(r.stdout, /^verify:holo /m, 'no run started');
  }
  const ctl = runRaw('f4ctl', ['--only', 'redline-grep', '--out', path.join(TMP, 'f4-ctl-out')]); assert.match(ctl.last, /^VERIFY:HOLO SELFTEST/, 'control: a real id still runs');
  const ws = runRaw('f4ws', ['--only', ' redline-grep , ', '--out', path.join(TMP, 'f4-ws-out')]); assert.match(ws.last, /^VERIFY:HOLO SELFTEST/, 'control: ids are trimmed, an empty piece beside a real id is ignored');
});

// ================================================================== base guard (base-guard.mjs) and "no .env content leaks" (designer additions to the verification-tool PR)
const SENTINEL = 'SENTINEL_9f3a';
const anyFileText = (...dirs) => dirs.flatMap((d) => filesText(d));
const noLeak = (needle, blobs, what) => { if (needle.length < 4) return; for (const [name, text] of blobs) assert.ok(!String(text).includes(needle), what + ': ' + name + ' contains the secret'); };
const GUARD_ITEMS = ['entry-delta-vs-base', 'c1-web', 'c1-os'];
/** run one item against sc.base, with .env.local content; everything needing base must FAIL, and the cache folder must not be touched */
function guarded(sc, item, extra = {}) { return goB1(sc, { only: item, ...extra }); }

ok('(bg-1) a MAIN checkout as --base is refused: every item that needs base (entry-delta-vs-base, c1-web, c1-os) is FAIL (not SKIP / INVALID) with a base-guard message, exit 1; nothing of the base is built, measured or cached; the linked worktree of the same repo is accepted (control)', () => {
  const sc = mkScenario('bg1');
  for (const item of GUARD_ITEMS) {
    const r = goB1(sc, { only: item, base: sc.main });
    assert.equal(r.it.status, 'FAIL', item + ': ' + JSON.stringify(r.it)); assert.equal(r.r.status, 1, item + ' exit'); assert.match(r.it.reason, /base guard: --base is a main checkout/); assert.equal(r.it.value.baseUnavailable, true);
    assert.equal(r.builds, 0, item + ': no base build'); assert.equal(r.baseMeasures, 0); assert.equal(fs.existsSync(sc.cache), false, item + ': the cache folder must not be created (no key was computed, nothing read or written)');
  }
  const ok1 = goB1(sc, { only: 'entry-delta-vs-base' }); assert.equal(ok1.it.status, 'PASS', JSON.stringify(ok1.it));
});
ok('(bg-2) --base whose .env* has DATA_DIR outside backend/data/example (or with the real-data folder name) is refused, and a DATA_DIR inside <base>/backend/data/example is accepted; the refusal comes BEFORE the cache is read: an existing valid cache entry is neither used nor changed', () => {
  const sc = mkScenario('bg2'); const envFile = path.join(sc.base, 'web', '.env.local'); fs.mkdirSync(path.join(sc.base, 'web'), { recursive: true });
  goB1(sc); const warm = goB1(sc); assert.equal(warm.it.value.cached, true, 'premise: a valid cache entry exists'); const before = snap(sc.cache); const builds = warm.builds;
  const real = path.join(TMP, 'someone', 'x' + REAL); const other = path.join(TMP, 'someone', 'other');
  for (const [k, line] of Object.entries({ real: 'DATA_DIR=' + real, other: 'DATA_DIR=' + other, relative: 'DATA_DIR=../elsewhere', empty: 'DATA_DIR=', exported: 'export DATA_DIR="' + other + '"', outsideBySibling: 'DATA_DIR=backend/data/example-copy', escape: 'DATA_DIR=backend/data/example/../../..' })) {
    fs.writeFileSync(envFile, '# a comment\nVITE_OK=1\n' + line + '\n');
    for (const item of GUARD_ITEMS) {
      const r = goB1(sc, { only: item });
      assert.equal(r.it.status, 'FAIL', k + '/' + item + ': ' + JSON.stringify(r.it)); assert.equal(r.r.status, 1); assert.match(r.it.reason, /base guard: DATA_DIR in \.env\.local of --base/); assert.equal(r.it.value.baseUnavailable, true);
      assert.equal(r.builds, builds, k + '/' + item + ': no base build'); assert.equal(snap(sc.cache), before, k + '/' + item + ': the cache was not read-then-written or changed');
      noLeak(line.slice(line.indexOf('=') + 1).replace(/"/g, ''), [['stdout', r.r.stdout], ['stderr', r.r.stderr], ...filesText(r.out), ...filesText(sc.cache)], k + '/' + item + ' DATA_DIR value');
    }
  }
  for (const line of ['DATA_DIR=backend/data/example', 'DATA_DIR=' + path.join(sc.base, 'backend', 'data', 'example').split(path.sep).join('/'), 'DATA_DIR=' + path.join(sc.base, 'backend', 'data', 'example', 'copy-1').split(path.sep).join('/'), 'OTHER=1']) {
    fs.writeFileSync(envFile, line + '\n'); const r = goB1(sc, { only: 'entry-delta-vs-base' });
    assert.equal(r.it.status, 'PASS', line.slice(0, 20) + ': ' + JSON.stringify(r.it));
  }
  fs.writeFileSync(path.join(sc.base, '.env'), 'DATA_DIR=' + other + '\n'); fs.rmSync(envFile);
  const rootEnv = goB1(sc, { only: 'entry-delta-vs-base' }); assert.equal(rootEnv.it.status, 'FAIL', 'a repo-root .env counts too'); assert.match(rootEnv.it.reason, /DATA_DIR in \.env of --base/);
});
ok('(bg-3) the refusal also covers the known-on-main re-run (baseServer): a main-checkout --base turns os-handoff-4x\'s known I2 timeouts into FAIL with the base-guard message, never INVALID (the timeouts are not excused)', () => {
  const sc = mkScenario('bg3');
  const r = run('bg3r', { branch: BRANCH_2_OF_18, base: BASE_1_OF_60 }, { base: sc.main });
  assert.equal(r.it.status, 'FAIL', JSON.stringify(r.it)); assert.equal(r.exit, 1); assert.match(r.it.reason, /base guard: --base is a main checkout/); assert.equal(r.it.value.baseUnavailable, true);
});
ok('(bg-4) no .env content leaks: a unique string in web/.env.local (and in a VITE_ variable of the run) appears in NO file of the cache folder, NO file under --out (logs, verify-holo.json, sub-script output), not in stdout / stderr; only hashes are stored', () => {
  const sc = mkScenario('bg4'); fs.mkdirSync(path.join(sc.base, 'web'), { recursive: true });
  fs.writeFileSync(path.join(sc.base, 'web', '.env.local'), 'VITE_SECRET=' + SENTINEL + '\nDATA_DIR=backend/data/example\n# ' + SENTINEL + ' comment\n'); fs.writeFileSync(path.join(sc.base, '.env'), 'EXTRA=' + SENTINEL + '2\n');
  const a = goB1(sc, { env: { VITE_FROM_ENV: SENTINEL + '3', FX_ECHO_BASE: '1', FX_SIDECAR: '1' } }); const b = goB1(sc, { env: { VITE_FROM_ENV: SENTINEL + '3' } });
  assert.equal(a.it.status, 'PASS', JSON.stringify(a.it)); assert.equal(b.it.value.cached, true, 'premise: the cache was written and used with these inputs');
  assert.ok(walkFiles(sc.cache).length >= 1 && walkFiles(a.out).length >= 3, 'premise: there is something to scan');
  for (const needle of [SENTINEL, SENTINEL + '2', SENTINEL + '3']) noLeak(needle, [['a.stdout', a.r.stdout], ['a.stderr', a.r.stderr], ['b.stdout', b.r.stdout], ['b.stderr', b.r.stderr], ...anyFileText(sc.cache, a.out, b.out)], 'env content');
  const kv = a.it.value.baseCache.key; assert.match(kv.envHash, /^[0-9a-f]{12}$/); assert.match(JSON.parse(fs.readFileSync(walkFiles(sc.cache)[0], 'utf8')).key.envHash, /^[0-9a-f]{64}$/);
});
ok('(bg-5, n21) one run with several items that need base (entry-delta-vs-base, c1-web, c1-os): all of them FAIL, none is SKIP or INVALID, exit 1; a git redirect variable (GIT_DIR / GIT_WORK_TREE / GIT_COMMON_DIR / GIT_INDEX_FILE) in the environment makes the guard refuse even a good linked worktree, naming the variable and nothing else', () => {
  const sc = mkScenario('bg5');
  const r = goB1(sc, { only: 'entry-delta-vs-base,c1-web,c1-os', base: sc.main, args: ['--no-fail-fast'] });
  for (const id of GUARD_ITEMS) { const it = r.json.items.find((i) => i.id === id); assert.equal(it.status, 'FAIL', id + ': ' + JSON.stringify(it)); assert.match(it.reason, /base guard: --base is a main checkout/); }
  assert.equal(r.r.status, 1); assert.deepEqual(r.json.summary.fail, GUARD_ITEMS); assert.deepEqual(r.json.summary.invalid, []);
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) {
    const g = goB1(sc, { only: 'entry-delta-vs-base', env: { [k]: path.join(sc.root, 'zzz-leak-check') } });
    assert.equal(g.it.status, 'FAIL', k); assert.match(g.it.reason, new RegExp('base guard: the environment variable ' + k)); assert.ok(!g.json && true || !JSON.stringify(g.json).includes('zzz-leak-check'), k + ': the value must not be echoed'); assert.equal(g.builds, 0);
  }
});
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`verify-holo selftest: ${n} groups passed`);
