// Self-test of base-guard.mjs: node scripts/verify/base-guard.selftest.mjs   (exit 0 = all pass). Temp folders only, fake paths under "someone"; never the real-data folder.
// Links: directory junctions can always be made (no privilege on Windows); file symlinks need a privilege Windows may not grant, so those cases are SKIPPED with a note when they cannot be created (the code does the same either way).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GIT_REDIRECT_VARS, checkBase, dataDirAmbiguous, dataDirValues, envFilesIn, gitEnv, isPristineTracked } from './base-guard.mjs';
import { hashEnvInputs } from './base-cache.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pld-bgst-'));
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`PASS ${name}`); };
const REAL = '工作' + '日誌';
const git = (cwd, ...a) => { const r = spawnSync('git', ['-c', 'user.name=selftest', '-c', 'user.email=selftest@example.invalid', ...a], { cwd, encoding: 'utf8', env: gitEnv() }); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); };
const main = path.join(TMP, 'someone', 'main'); const base = path.join(TMP, 'someone', 'base');
fs.mkdirSync(path.join(main, 'web'), { recursive: true }); fs.writeFileSync(path.join(main, 'a.txt'), 'x');
// tracked template files with a PLACEHOLDER DATA_DIR, like the repo's own .env.example
const TEMPLATES = ['.env.example', '.env.sample', path.join('web', '.env.template')];
for (const t of TEMPLATES) fs.writeFileSync(path.join(main, t), 'DATA_DIR=/placeholder/path\n');
git(main, 'init', '-q'); git(main, 'add', '-A'); git(main, 'commit', '-q', '-m', 'init'); git(main, 'worktree', 'add', '-q', '-b', 'wt', base);
const R = { real: REAL, env: {} }; // env: {} = no GIT_* variable set (the real process env is only used by the verify-holo integration)
const envFile = path.join(base, 'web', '.env.local'); fs.mkdirSync(path.join(base, 'web'), { recursive: true });
const o = path.join(TMP, 'someone', 'other');
const fwd = (p) => p.split(path.sep).join('/');
const BS = String.fromCharCode(92);
const withEnv = (name, text, fn) => { const f = path.join(base, 'web', name); fs.writeFileSync(f, text); try { return fn(f); } finally { fs.rmSync(f, { force: true }); } };
/** a link of the given kind, or false when this machine refuses to make one (Windows without the privilege) */
const tryLink = (target, p, type) => { try { fs.symlinkSync(target, p, type); return true; } catch (e) { if (e.code === 'EPERM' || e.code === 'EACCES') return false; throw e; } };

ok('main checkout = refused; linked worktree = accepted; a plain folder / a missing folder = refused (fail closed)', () => {
  assert.match(checkBase(main, R), /main checkout/); assert.equal(checkBase(base, R), null);
  const plain = path.join(TMP, 'someone', 'plain'); fs.mkdirSync(plain, { recursive: true }); assert.match(checkBase(plain, R), /not a readable git worktree/);
  assert.match(checkBase(path.join(TMP, 'someone', 'nope'), R), /not a readable git worktree/);
  assert.match(checkBase(path.join(main, '.'), R), /main checkout/, 'same answer for another spelling of the main path');
});
ok('(B10) git redirect variables: any of GIT_DIR / GIT_COMMON_DIR / GIT_WORK_TREE / GIT_INDEX_FILE set (non-empty) = refused by name, even for a perfectly good linked worktree; empty = not set; the guard\'s own git calls run without them', () => {
  for (const k of GIT_REDIRECT_VARS) {
    const r = checkBase(base, { real: REAL, env: { [k]: 'zzz-secret' } }); assert.match(r, new RegExp('environment variable ' + k)); assert.ok(!r.includes('zzz-secret'), 'names only');
    assert.equal(checkBase(base, { real: REAL, env: { [k]: '' } }), null, k + ' empty is not set');
  }
  assert.deepEqual(Object.keys(gitEnv({ GIT_DIR: 'a', GIT_COMMON_DIR: 'b', GIT_WORK_TREE: 'c', GIT_INDEX_FILE: 'd', KEEP: 'e' })), ['KEEP']);
  // behaviour: with a bogus GIT_INDEX_FILE in THIS process, the guard's git calls must still see the real index (cleared); without clearing, the tracked template would look untracked
  const saved = process.env.GIT_INDEX_FILE; process.env.GIT_INDEX_FILE = path.join(TMP, 'someone', 'no-such-index');
  try { assert.equal(isPristineTracked(base, path.join(base, '.env.example')), true, 'GIT_INDEX_FILE must not reach the guard\'s git calls'); } finally { if (saved === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = saved; }
});
ok('DATA_DIR: outside backend/data/example, the real-data folder name, empty, sibling folder = refused; inside the example folder (relative or absolute with forward slashes, a copy below it, the same value twice) = accepted; other keys and comments ignored', () => {
  const bad = [`DATA_DIR=${fwd(o)}`, `DATA_DIR=${fwd(path.join(TMP, 'someone', 'x' + REAL))}`, 'DATA_DIR=', 'DATA_DIR=../x', 'DATA_DIR=backend/data/example-copy', 'DATA_DIR=backend/data/example/' + REAL, `OTHER=1\nDATA_DIR=${fwd(o)}\n`, `DATA_DIR=backend/data/example\nDATA_DIR=${fwd(o)}`];
  for (const line of bad) { fs.writeFileSync(envFile, line + '\n'); const r = checkBase(base, R); assert.ok(r && /DATA_DIR in \.env\.local/.test(r), JSON.stringify(line) + ' -> ' + r); }
  const ex = fwd(path.join(base, 'backend', 'data', 'example'));
  const good = ['DATA_DIR=backend/data/example', `DATA_DIR=${ex}`, `DATA_DIR=${ex}/copy`, 'export DATA_DIR = backend/data/example', 'DATA_DIR=backend/data/example\nDATA_DIR=backend/data/example', '# DATA_DIR=/elsewhere\nX=1', 'MY_DATA_DIR=/elsewhere', ''];
  for (const line of good) { fs.writeFileSync(envFile, line + '\n'); assert.equal(checkBase(base, R), null, JSON.stringify(line)); }
  fs.rmSync(envFile); fs.writeFileSync(path.join(base, '.env'), `DATA_DIR=${fwd(o)}\n`); assert.match(checkBase(base, R), /DATA_DIR in \.env of --base/, 'the repo-root .env counts'); fs.rmSync(path.join(base, '.env'));
});
ok('(B2) DATA_DIR ambiguity = refused (fail closed, no attempt to reproduce dotenv): quotes of every kind, #, $, backtick, a second "=", escape sequences (\\n \\t \\\\ ...), a trailing backslash, ".." segments, two different definitions in one file', () => {
  const ex = 'backend/data/example';
  const bad = { dq: `"${ex}"`, sq: `'${ex}'`, bt: '`' + ex + '`', hash: `${ex} # note`, hashIn: `${ex}#x`, dollar: `${ex}/$HOME`, eq: `${ex}/a=b`, nl: `backend${BS}new`, tab: `${ex}${BS}tab`, dbl: `${ex}${BS}${BS}x`, trail: `${ex}${BS}`, bs0: `${ex}${BS}0`, dots: `${ex}/a/../b`, dotsBack: `${ex}${BS}..${BS}x` };
  for (const [k, v] of Object.entries(bad)) { fs.writeFileSync(envFile, `DATA_DIR=${v}\n`); const r = checkBase(base, R); assert.ok(r && /DATA_DIR in \.env\.local/.test(r), k + ' -> ' + r); assert.equal(dataDirAmbiguous(v), true, k); }
  fs.writeFileSync(envFile, `DATA_DIR=${ex}\nDATA_DIR=${ex}/b\n`); assert.match(checkBase(base, R), /defined more than once with different values/);
  assert.equal(dataDirAmbiguous('C:' + BS + 'Users' + BS + 'x' + BS + 'y'), false, 'a Windows path with plain separators is not an escape'); assert.equal(dataDirAmbiguous(ex), false);
  fs.rmSync(envFile);
});
ok('the reason never contains a DATA_DIR value or any .env content', () => {
  const secret = fwd(path.join(TMP, 'someone', 'SENTINEL_9f3a'));
  for (const text of [`SECRET=SENTINEL_77\nDATA_DIR=${secret}\n`, `DATA_DIR="${secret}"\n`, `DATA_DIR=${secret}#SENTINEL_78\n`, `DATA_DIR=${secret}\nDATA_DIR=${secret}2\n`]) {
    withEnv('.env.local', text, () => { const r = checkBase(base, R); assert.ok(r && !r.includes('SENTINEL') && !r.includes(TMP) && !r.includes('someone'), r); });
  }
  assert.ok(!checkBase(main, R).includes(TMP));
});
ok('dataDirValues / envFilesIn: parsing details (raw values, no unquoting; any letter case; every kind of entry)', () => {
  assert.deepEqual(dataDirValues('A=1\r\nDATA_DIR="a b"\r\nexport DATA_DIR=c # x\nXDATA_DIR=z'), ['"a b"', 'c # x']);
  fs.writeFileSync(envFile, ''); fs.writeFileSync(path.join(base, 'web', 'env.txt'), ''); fs.writeFileSync(path.join(base, 'web', '.envrc'), '');
  assert.deepEqual(envFilesIn([path.join(base, 'web'), path.join(TMP, 'nope')]).map((f) => path.basename(f)), ['.env.local', '.env.template']);
  fs.rmSync(envFile);
});
ok('templates: skipped ONLY when git tracks them and the working tree equals HEAD; the files that ARE loaded (.env, .env.local, .env.production...) are always judged', () => {
  const T = TEMPLATES.map((t) => path.join(base, t)); const gitB = (...x) => git(base, ...x);
  assert.equal(checkBase(base, R), null, '(1) tracked and untouched templates with a placeholder DATA_DIR are not judged');
  for (const [i, f] of T.entries()) {
    const rel = fwd(TEMPLATES[i]); const name = path.basename(f);
    fs.writeFileSync(f, `DATA_DIR=${fwd(o)}\n`); assert.match(checkBase(base, R), new RegExp('DATA_DIR in ' + name.replace(/[.]/g, '[.]')), '(2) tracked but edited (unstaged) -> judged: ' + rel);
    gitB('add', '--', rel); assert.match(checkBase(base, R), /DATA_DIR in/, '(2b) edited and staged -> judged: ' + rel);
    gitB('checkout', 'HEAD', '--', rel); assert.equal(checkBase(base, R), null, 'restored to HEAD -> not judged again: ' + rel);
  }
  const untracked = path.join(base, 'web', '.env.example'); fs.writeFileSync(untracked, `DATA_DIR=${fwd(o)}\n`);
  assert.match(checkBase(base, R), /DATA_DIR in \.env\.example/, '(3) an untracked .env.example (new, in web/) -> judged'); fs.rmSync(untracked);
  gitB('rm', '-q', '--cached', '--', '.env.example'); assert.match(checkBase(base, R), /DATA_DIR in \.env\.example/, 'in HEAD with identical bytes but NOT tracked any more (removed from the index) -> judged'); gitB('reset', '-q', 'HEAD', '--', '.env.example'); assert.equal(checkBase(base, R), null, 'tracked again -> not judged');
  fs.writeFileSync(path.join(base, '.env.sample'), 'DATA_DIR=/placeholder/path\n'); assert.equal(checkBase(base, R), null, 'rewritten with identical bytes = pristine');
  const staged = path.join(base, 'web', '.env.sample'); fs.writeFileSync(staged, `DATA_DIR=${fwd(o)}\n`); gitB('add', '--', 'web/.env.sample'); assert.match(checkBase(base, R), /DATA_DIR in \.env\.sample/, 'new file staged but not in HEAD -> judged'); gitB('rm', '-q', '-f', '--', 'web/.env.sample');
  assert.equal(isPristineTracked(base, path.join(base, '.env.example')), true); assert.equal(isPristineTracked(path.join(TMP, 'someone', 'nope'), path.join(TMP, 'someone', 'nope', '.env.example')), false, 'no git information = not pristine (fail closed)');
  fs.writeFileSync(path.join(base, '.env.production'), `DATA_DIR=${fwd(o)}\n`); assert.match(checkBase(base, R), /DATA_DIR in \.env\.production/, 'a mode file that vite loads is judged'); fs.rmSync(path.join(base, '.env.production'));
});
ok('(B1, n4) env file names: any letter case (.ENV, .Env.Local, .ENV.PRODUCTION.LOCAL) and dotted mode names (.env.production.local) are judged by the guard and listed for the cache hash', () => {
  for (const name of ['.ENV', '.Env.Local', '.ENV.PRODUCTION.LOCAL', '.env.production.local', '.env.development', '.eNv']) {
    withEnv(name, `DATA_DIR=${fwd(o)}\n`, () => { const r = checkBase(base, R); assert.ok(r && r.includes('DATA_DIR in ' + name), name + ' -> ' + r); assert.ok(envFilesIn([path.join(base, 'web')]).some((f) => path.basename(f) === name), name + ' is listed'); });
  }
  const web = path.join(base, 'web'); const H = () => hashEnvInputs({ dirs: [web], env: {} }); const h0 = H();
  for (const name of ['.ENV', '.Env.Local', '.env.production.local', '.ENV.PRODUCTION.LOCAL']) withEnv(name, 'A=1', () => assert.notEqual(H(), h0, name + ' must change the cache hash'));
  assert.equal(H(), h0);
});
ok('(B4, n1) env entries that are not readable regular files fail closed: a directory named .env / .env.local, a junction to a directory, a dangling link; a symlink to a file is followed and judged by its content (file-symlink cases are skipped when this machine cannot create them)', () => {
  const dirEnv = path.join(base, 'web', '.env.local'); fs.mkdirSync(dirEnv);
  assert.match(checkBase(base, R), /not a regular file/, 'a directory named .env.local'); fs.rmdirSync(dirEnv);
  const rootDir = path.join(base, '.env'); fs.mkdirSync(rootDir); assert.match(checkBase(base, R), /\.env in --base is not a regular file/, 'n1: an unreadable .env (a directory) never passes'); fs.rmdirSync(rootDir);
  const targetDir = path.join(TMP, 'someone', 'linkdir'); fs.mkdirSync(targetDir, { recursive: true });
  assert.ok(tryLink(targetDir, envFile, 'junction'), 'a junction can always be made'); assert.match(checkBase(base, R), /not a regular file/, 'a junction to a directory'); fs.rmSync(envFile, { recursive: true, force: true });
  const gone = path.join(TMP, 'someone', 'gonedir'); fs.mkdirSync(gone, { recursive: true });
  assert.ok(tryLink(gone, envFile, 'junction')); fs.rmdirSync(gone); assert.match(checkBase(base, R), /cannot read \.env\.local in --base/, 'a dangling junction (its target was removed) is a broken link: refused'); fs.rmSync(envFile, { recursive: true, force: true });
  const targetFile = path.join(TMP, 'someone', 'linked.env');
  if (!tryLink(targetFile, envFile, 'file')) { console.log('  (skip) file symlinks cannot be created on this machine: the dangling / followed-link cases are not exercised here'); return; }
  assert.match(checkBase(base, R), /cannot read \.env\.local|not a regular file/, 'a dangling link'); // target does not exist yet
  fs.writeFileSync(targetFile, `DATA_DIR=${fwd(o)}\n`); assert.match(checkBase(base, R), /DATA_DIR in \.env\.local/, 'a link to a file with a bad DATA_DIR is judged by that content (the old isFile() filter skipped links)');
  fs.writeFileSync(targetFile, 'DATA_DIR=backend/data/example\n'); assert.equal(checkBase(base, R), null, 'a link to a file with the example DATA_DIR is fine');
  const h = hashEnvInputs({ dirs: [path.join(base, 'web')], env: {} }); fs.writeFileSync(targetFile, 'DATA_DIR=backend/data/example\n# changed\n'); assert.notEqual(hashEnvInputs({ dirs: [path.join(base, 'web')], env: {} }), h, 'a linked env file is part of the cache hash');
  fs.rmSync(envFile, { force: true });
});
ok('(B3, n3) realpath: a junction below the example folder that leads outside, the example folder itself being a junction to outside, and a --base that is a junction to the main checkout are all refused', () => {
  const outside = path.join(TMP, 'someone', 'outside'); fs.mkdirSync(outside, { recursive: true });
  const exDir = path.join(base, 'backend', 'data', 'example'); fs.mkdirSync(exDir, { recursive: true });
  const link = path.join(exDir, 'link'); assert.ok(tryLink(outside, link, 'junction'));
  withEnv('.env.local', 'DATA_DIR=backend/data/example/link/x\n', () => assert.match(checkBase(base, R), /DATA_DIR in \.env\.local of --base is not the example data/, 'below a junction that leaves the example folder'));
  withEnv('.env.local', 'DATA_DIR=backend/data/example/link\n', () => assert.match(checkBase(base, R), /not the example data/, 'the junction itself'));
  fs.rmSync(link, { recursive: true, force: true });
  withEnv('.env.local', 'DATA_DIR=backend/data/example/real-subfolder\n', () => assert.equal(checkBase(base, R), null, 'control: a normal subfolder (not created yet) is fine'));
  fs.rmSync(path.join(base, 'backend'), { recursive: true, force: true }); fs.mkdirSync(path.join(base, 'backend', 'data'), { recursive: true });
  assert.ok(tryLink(outside, path.join(base, 'backend', 'data', 'example'), 'junction'));
  withEnv('.env.local', 'DATA_DIR=backend/data/example\n', () => assert.match(checkBase(base, R), /resolves outside the base worktree/, 'the example folder itself leads outside the base'));
  fs.rmSync(path.join(base, 'backend'), { recursive: true, force: true });
  const jbase = path.join(TMP, 'someone', 'jbase'); assert.ok(tryLink(main, jbase, 'junction'));
  assert.match(checkBase(jbase, R), /main checkout/, 'a base reached through a junction to the main checkout is still the main checkout'); fs.rmSync(jbase, { recursive: true, force: true });
  assert.equal(checkBase(base, R), null);
});
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${n} passed`);
