// Self-test of base-guard.mjs (whitelist: no .env* entry at all except a tracked, unchanged template): node scripts/verify/base-guard.selftest.mjs   (exit 0 = all pass)
// Temp folders only, fake paths under "someone"; never the real-data folder. Directory junctions can always be made (no privilege on Windows);
// file symlinks need a privilege Windows may not grant, so those cases print (skip) when they cannot be created (the code does not care about the kind of link).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GIT_REDIRECT_VARS, checkBase, envOffenders, gitEnv, isPristineTracked } from './base-guard.mjs';
import { hashEnvInputs } from './base-cache.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pld-bgst-'));
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`PASS ${name}`); };
const git = (cwd, ...a) => { const r = spawnSync('git', ['-c', 'user.name=selftest', '-c', 'user.email=selftest@example.invalid', ...a], { cwd, encoding: 'utf8', env: gitEnv() }); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); };
const main = path.join(TMP, 'someone', 'main'); const base = path.join(TMP, 'someone', 'base');
fs.mkdirSync(path.join(main, 'web'), { recursive: true }); fs.mkdirSync(path.join(main, 'backend'), { recursive: true }); fs.writeFileSync(path.join(main, 'a.txt'), 'x');
// tracked template files, like the repo's own .env.example
const TEMPLATES = ['.env.example', '.env.sample', path.join('web', '.env.template')];
for (const t of TEMPLATES) fs.writeFileSync(path.join(main, t), 'DATA_DIR=/placeholder/path\n');
git(main, 'init', '-q'); git(main, 'add', '-A'); git(main, 'commit', '-q', '-m', 'init'); git(main, 'worktree', 'add', '-q', '-b', 'wt', base);
const R = { env: {} }; // env: {} = no GIT_* variable set
const gitB = (...x) => git(base, ...x);
const fwd = (p) => p.split(path.sep).join('/');
const SECRET = 'SENTINEL_9f3a';
/** make `rel` (a file with secret content) in the base, run fn, remove it */
const withFile = (rel, fn, text = SECRET + '\n') => { const f = path.join(base, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); try { return fn(f); } finally { fs.rmSync(f, { force: true }); } };
const withDir = (rel, fn) => { const d = path.join(base, rel); fs.mkdirSync(d, { recursive: true }); try { return fn(d); } finally { fs.rmSync(d, { recursive: true, force: true }); } };
/** a link of the given kind, or false when this machine refuses to make one (Windows without the privilege) */
const tryLink = (target, p, type) => { try { fs.symlinkSync(target, p, type); return true; } catch (e) { if (e.code === 'EPERM' || e.code === 'EACCES') return false; throw e; } };
const refused = (label) => { const r = checkBase(base, R); assert.ok(r && /^base guard: --base contains /.test(r), label + ' -> ' + r); assert.ok(!r.includes(SECRET), label + ': no file content in the message'); return r; };

ok('main checkout = refused; linked worktree = accepted; a plain folder / a missing folder = refused (fail closed)', () => {
  assert.match(checkBase(main, R), /main checkout/); assert.equal(checkBase(base, R), null);
  const plain = path.join(TMP, 'someone', 'plain'); fs.mkdirSync(plain, { recursive: true }); assert.match(checkBase(plain, R), /not a readable git worktree/);
  assert.match(checkBase(path.join(TMP, 'someone', 'nope'), R), /not a readable git worktree/);
  assert.match(checkBase(path.join(main, '.'), R), /main checkout/, 'same answer for another spelling of the main path');
});
ok('git redirect variables: any of GIT_DIR / GIT_COMMON_DIR / GIT_WORK_TREE / GIT_INDEX_FILE set (non-empty) = refused by name, even for a perfectly good linked worktree; empty = not set; the guard\'s own git calls run without them', () => {
  for (const k of GIT_REDIRECT_VARS) {
    const r = checkBase(base, { env: { [k]: 'zzz-secret' } }); assert.match(r, new RegExp('environment variable ' + k)); assert.ok(!r.includes('zzz-secret'), 'names only');
    assert.equal(checkBase(base, { env: { [k]: '' } }), null, k + ' empty is not set');
  }
  assert.deepEqual(Object.keys(gitEnv({ GIT_DIR: 'a', GIT_COMMON_DIR: 'b', GIT_WORK_TREE: 'c', GIT_INDEX_FILE: 'd', KEEP: 'e' })), ['KEEP']);
  const saved = process.env.GIT_INDEX_FILE; process.env.GIT_INDEX_FILE = path.join(TMP, 'someone', 'no-such-index');
  try { assert.equal(isPristineTracked(base, path.join(base, '.env.example')), true, 'GIT_INDEX_FILE must not reach the guard\'s git calls (else the tracked template would look untracked)'); } finally { if (saved === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = saved; }
});
ok('whitelist: a base with only tracked, unchanged templates (and nothing else called .env*) is accepted; the contents of those templates are irrelevant and never read', () => {
  assert.equal(checkBase(base, R), null); assert.deepEqual(envOffenders(base), []);
});
ok('names (any letter case, any depth): .env, .ENV, .env.local, .Env.Production.Local, .env.development, web/.env.local, backend/.env, a/b/c/.env -> refused, naming the relative path and never the content', () => {
  for (const rel of ['.env', '.ENV', '.env.local', '.Env.Production.Local', '.env.development', '.eNv', 'web/.env.local', 'backend/.env', 'a/b/c/.env', 'web/deep/.ENV.PRODUCTION.LOCAL']) {
    withFile(rel, () => { const r = refused(rel); assert.ok(r.includes(rel), rel + ' named in: ' + r); assert.ok(envOffenders(base).includes(rel), rel); });
  }
  withFile('.envrc', () => assert.equal(checkBase(base, R), null, '.envrc is not an env file name'));
  withFile('env.txt', () => assert.equal(checkBase(base, R), null)); withFile('web/dotenv', () => assert.equal(checkBase(base, R), null)); withFile('web/.environment', () => assert.equal(checkBase(base, R), null, '.environment: no dot after .env'));
});
ok('entry kinds: a directory named .env / .env.local, a junction named .env, a junction to a folder whose name is .env.*, a dangling junction, and (when file symlinks can be made) a file symlink named .env, a symlink to a file called .env, a dangling file symlink = all refused', () => {
  withDir('.env', () => refused('directory .env')); withDir('web/.Env.Local', () => refused('directory web/.Env.Local'));
  const t1 = path.join(TMP, 'someone', 'targets', 'somewhere'); fs.mkdirSync(t1, { recursive: true });
  assert.ok(tryLink(t1, path.join(base, '.env'), 'junction')); try { refused('junction named .env'); } finally { fs.rmSync(path.join(base, '.env'), { recursive: true, force: true }); }
  const t2 = path.join(TMP, 'someone', 'targets', '.env.store'); fs.mkdirSync(t2, { recursive: true });
  assert.ok(tryLink(t2, path.join(base, 'innocent'), 'junction')); try { refused('junction to a folder named .env.store'); } finally { fs.rmSync(path.join(base, 'innocent'), { recursive: true, force: true }); }
  const gone = path.join(TMP, 'someone', 'targets', 'gone'); fs.mkdirSync(gone, { recursive: true });
  assert.ok(tryLink(gone, path.join(base, '.env.local'), 'junction')); fs.rmdirSync(gone); try { refused('dangling junction named .env.local'); } finally { fs.rmSync(path.join(base, '.env.local'), { recursive: true, force: true }); }
  const tf = path.join(TMP, 'someone', 'targets', '.env'); fs.writeFileSync(tf, SECRET);
  if (!tryLink(tf, path.join(base, 'plain-name'), 'file')) { console.log('  (skip) file symlinks cannot be created on this machine: the file-symlink cases are not exercised here'); return; }
  try { refused('file symlink to a file called .env'); } finally { fs.rmSync(path.join(base, 'plain-name'), { force: true }); }
  const other = path.join(TMP, 'someone', 'targets', 'other.txt'); fs.writeFileSync(other, SECRET);
  assert.ok(tryLink(other, path.join(base, '.env'), 'file')); try { refused('file symlink named .env'); } finally { fs.rmSync(path.join(base, '.env'), { force: true }); }
  assert.ok(tryLink(path.join(TMP, 'someone', 'targets', 'no-such-file'), path.join(base, 'web', '.env.local'), 'file')); try { refused('dangling file symlink'); } finally { fs.rmSync(path.join(base, 'web', '.env.local'), { force: true }); }
});
ok('templates (.env.example / .env.sample / .env.template, any case): skipped ONLY when git tracks them and the working tree equals HEAD; edited (unstaged or staged), untracked, new in another folder, removed from the index = refused; restored = accepted again', () => {
  const T = TEMPLATES.map((t) => path.join(base, t));
  assert.equal(checkBase(base, R), null, '(1) tracked and untouched templates are not judged');
  for (const [i, f] of T.entries()) {
    const rel = fwd(TEMPLATES[i]);
    fs.writeFileSync(f, SECRET + '\n'); assert.ok(refused('(2) edited ' + rel).includes(rel));
    gitB('add', '--', rel); refused('(2b) edited and staged ' + rel);
    gitB('checkout', 'HEAD', '--', rel); assert.equal(checkBase(base, R), null, 'restored to HEAD -> accepted again: ' + rel);
  }
  withFile('web/.env.example', () => refused('(3) an untracked .env.example in web/'));
  withFile('web/.ENV.EXAMPLE', () => refused('an untracked upper-case template in web/'));
  gitB('rm', '-q', '--cached', '--', '.env.example'); refused('in HEAD with identical bytes but no longer tracked'); gitB('reset', '-q', 'HEAD', '--', '.env.example'); assert.equal(checkBase(base, R), null, 'tracked again -> accepted');
  fs.writeFileSync(path.join(base, '.env.sample'), 'DATA_DIR=/placeholder/path\n'); assert.equal(checkBase(base, R), null, 'rewritten with identical bytes = unchanged');
  fs.writeFileSync(path.join(base, 'web', '.env.sample'), SECRET + '\n'); gitB('add', '--', 'web/.env.sample'); refused('new file staged but not in HEAD'); gitB('rm', '-q', '-f', '--', 'web/.env.sample');
  assert.equal(isPristineTracked(path.join(TMP, 'someone', 'nope'), path.join(TMP, 'someone', 'nope', '.env.example')), false, 'no git information = not pristine (fail closed)');
  const lnTarget = path.join(TMP, 'someone', 'targets', 'tmpl'); fs.mkdirSync(lnTarget, { recursive: true });
  fs.rmSync(path.join(base, '.env.example')); assert.ok(tryLink(lnTarget, path.join(base, '.env.example'), 'junction')); try { refused('a tracked template replaced by a junction'); } finally { fs.rmSync(path.join(base, '.env.example'), { recursive: true, force: true }); gitB('checkout', 'HEAD', '--', '.env.example'); }
  assert.equal(checkBase(base, R), null);
});
ok('the scan covers the whole tree but not .git, node_modules, web/node_modules, web/dist (never loaded / build output)', () => {
  for (const rel of ['node_modules/pkg/.env', 'web/node_modules/x/.env', 'web/dist/.env', 'web/dist/assets/.env.local']) withFile(rel, () => assert.equal(checkBase(base, R), null, rel + ' is excluded'));
  for (const rel of ['docs/node_modules/.env', 'src/web/dist/.env']) withFile(rel, () => refused('only the named folders are excluded: ' + rel));
});
ok('the message never contains file content (secret in the file, in the name list, even many offenders); at most three paths are named', () => {
  for (const rel of ['.env', 'web/.env.local', 'backend/.env', 'a/.env', 'b/.env']) { fs.mkdirSync(path.join(base, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), SECRET); }
  try { const r = checkBase(base, R); assert.ok(!r.includes(SECRET) && !r.includes(TMP), r); assert.match(r, /and 2 more/); } finally { for (const rel of ['.env', 'web/.env.local', 'backend/.env', 'a', 'b']) fs.rmSync(path.join(base, rel), { recursive: true, force: true }); }
});
ok('the cache hash uses the same names: .ENV, .Env.Local, .env.production.local, .ENV.PRODUCTION.LOCAL change it (defence in depth: such a base is refused anyway)', () => {
  const web = path.join(base, 'web'); const H = () => hashEnvInputs({ dirs: [web], env: {} }); const h0 = H();
  for (const name of ['.ENV', '.Env.Local', '.env.production.local', '.ENV.PRODUCTION.LOCAL']) withFile('web/' + name, () => assert.notEqual(H(), h0, name + ' must change the cache hash'));
  assert.equal(H(), h0);
});
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${n} passed`);
