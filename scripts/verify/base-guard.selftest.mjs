// Self-test of base-guard.mjs: node scripts/verify/base-guard.selftest.mjs   (exit 0 = all pass). Temp folders only, fake paths under "someone"; never the real-data folder.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBase, dataDirValues, envFilesIn, isPristineTracked } from './base-guard.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pld-bgst-'));
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`PASS ${name}`); };
const REAL = '工作' + '日誌';
const git = (cwd, ...a) => { const e = { ...process.env }; delete e.GIT_DIR; delete e.GIT_WORK_TREE; delete e.GIT_INDEX_FILE; const r = spawnSync('git', ['-c', 'user.name=selftest', '-c', 'user.email=selftest@example.invalid', ...a], { cwd, encoding: 'utf8', env: e }); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); };
const main = path.join(TMP, 'someone', 'main'); const base = path.join(TMP, 'someone', 'base');
fs.mkdirSync(path.join(main, 'web'), { recursive: true }); fs.writeFileSync(path.join(main, 'a.txt'), 'x');
// tracked template files with a PLACEHOLDER DATA_DIR, like the repo's own .env.example
const TEMPLATES = ['.env.example', '.env.sample', path.join('web', '.env.template')];
for (const t of TEMPLATES) fs.writeFileSync(path.join(main, t), 'DATA_DIR=/placeholder/path\n');
git(main, 'init', '-q'); git(main, 'add', '-A'); git(main, 'commit', '-q', '-m', 'init'); git(main, 'worktree', 'add', '-q', '-b', 'wt', base);
const R = { real: REAL };
const envFile = path.join(base, 'web', '.env.local'); fs.mkdirSync(path.join(base, 'web'), { recursive: true });

ok('main checkout = refused; linked worktree = accepted; a plain folder / a missing folder = refused (fail closed)', () => {
  assert.match(checkBase(main, R), /main checkout/); assert.equal(checkBase(base, R), null);
  const plain = path.join(TMP, 'someone', 'plain'); fs.mkdirSync(plain, { recursive: true }); assert.match(checkBase(plain, R), /not a readable git worktree/);
  assert.match(checkBase(path.join(TMP, 'someone', 'nope'), R), /not a readable git worktree/);
  assert.match(checkBase(path.join(main, '.'), R), /main checkout/, 'same answer for another spelling of the main path');
});
ok('DATA_DIR: outside backend/data/example, the real-data folder name, empty, relative escape, sibling folder, exported/quoted forms = refused; inside the example folder (relative, absolute, a copy below it) = accepted; other keys and comments ignored', () => {
  const o = path.join(TMP, 'someone', 'other');
  const bad = [`DATA_DIR=${o}`, `DATA_DIR=${path.join(TMP, 'someone', 'x' + REAL)}`, 'DATA_DIR=', 'DATA_DIR=../x', 'DATA_DIR=backend/data/example/../../..', 'DATA_DIR=backend/data/example-copy', 'DATA_DIR=backend/data/example/' + REAL, // inside the example folder but with the real-data folder name: still refused
     `export DATA_DIR="${o}"`, `  DATA_DIR = '${o}'  # c`, `OTHER=1\nDATA_DIR=${o}\n`, `DATA_DIR=backend/data/example\nDATA_DIR=${o}`];
  for (const line of bad) { fs.writeFileSync(envFile, line + '\n'); const r = checkBase(base, R); assert.ok(r && /DATA_DIR in \.env\.local/.test(r), JSON.stringify(line) + ' -> ' + r); }
  const good = ['DATA_DIR=backend/data/example', `DATA_DIR=${path.join(base, 'backend', 'data', 'example')}`, `DATA_DIR="${path.join(base, 'backend', 'data', 'example', 'copy')}"`, '# DATA_DIR=/elsewhere\nX=1', 'MY_DATA_DIR=/elsewhere', ''];
  for (const line of good) { fs.writeFileSync(envFile, line + '\n'); assert.equal(checkBase(base, R), null, JSON.stringify(line)); }
  fs.rmSync(envFile);
  // templates: skipped ONLY when git tracks them and the working tree equals HEAD; the files that ARE loaded (.env, .env.local, .env.production...) are always judged
  const T = TEMPLATES.map((t) => path.join(base, t)); const gitB = (...x) => git(base, ...x);
  assert.equal(checkBase(base, R), null, '(1) tracked and untouched templates with a placeholder DATA_DIR are not judged');
  for (const [i, f] of T.entries()) {
    const rel = TEMPLATES[i].split(path.sep).join('/'); const name = path.basename(f);
    fs.writeFileSync(f, `DATA_DIR=${o}
`); assert.match(checkBase(base, R), new RegExp('DATA_DIR in ' + name.replace(/[.]/g, '[.]')), '(2) tracked but edited (unstaged) -> judged: ' + rel);
    gitB('add', '--', rel); assert.match(checkBase(base, R), /DATA_DIR in/, '(2b) edited and staged -> judged: ' + rel);
    gitB('checkout', 'HEAD', '--', rel); assert.equal(checkBase(base, R), null, 'restored to HEAD -> not judged again: ' + rel);
  }
  const untracked = path.join(base, 'web', '.env.example'); fs.writeFileSync(untracked, `DATA_DIR=${o}
`);
  assert.match(checkBase(base, R), /DATA_DIR in .env.example/, '(3) an untracked .env.example (new, in web/) -> judged'); fs.rmSync(untracked);
  gitB('rm', '-q', '--cached', '--', '.env.example'); assert.match(checkBase(base, R), /DATA_DIR in \.env\.example/, 'in HEAD with identical bytes but NOT tracked any more (removed from the index) -> judged'); gitB('reset', '-q', 'HEAD', '--', '.env.example'); assert.equal(checkBase(base, R), null, 'tracked again -> not judged');
  fs.writeFileSync(path.join(base, '.env.sample'), 'DATA_DIR=/placeholder/path\n'); // same bytes as HEAD: still pristine
  assert.equal(checkBase(base, R), null, 'rewritten with identical bytes = pristine');
  const staged = path.join(base, 'web', '.env.sample'); fs.writeFileSync(staged, `DATA_DIR=${o}
`); gitB('add', '--', 'web/.env.sample'); assert.match(checkBase(base, R), /DATA_DIR in .env.sample/, 'new file staged but not in HEAD -> judged'); gitB('rm', '-q', '-f', '--', 'web/.env.sample');
  assert.equal(isPristineTracked(base, path.join(base, '.env.example')), true); assert.equal(isPristineTracked(path.join(TMP, 'someone', 'nope'), path.join(TMP, 'someone', 'nope', '.env.example')), false, 'no git information = not pristine (fail closed)');
  fs.writeFileSync(path.join(base, '.env.production'), `DATA_DIR=${o}
`); assert.match(checkBase(base, R), /DATA_DIR in .env.production/, 'a mode file that vite loads is judged'); fs.rmSync(path.join(base, '.env.production'));
  fs.writeFileSync(path.join(base, '.env'),`DATA_DIR=${o}\n`); assert.match(checkBase(base, R), /DATA_DIR in \.env of --base/, 'the repo-root .env counts'); fs.rmSync(path.join(base, '.env'));
});
ok('the reason never contains a DATA_DIR value or any .env content', () => {
  const secret = path.join(TMP, 'someone', 'SENTINEL_9f3a'); fs.writeFileSync(envFile, `SECRET=SENTINEL_77\nDATA_DIR=${secret}\n`);
  const r = checkBase(base, R); assert.ok(r && !r.includes('SENTINEL') && !r.includes(TMP) && !r.includes('someone'), r); fs.rmSync(envFile);
  assert.ok(!checkBase(main, R).includes(TMP));
});
ok('dataDirValues / envFilesIn: parsing details', () => {
  assert.deepEqual(dataDirValues('A=1\r\nDATA_DIR="a b"\r\nexport DATA_DIR=c # x\nXDATA_DIR=z'), ['a b', 'c']);
  fs.writeFileSync(envFile, ''); fs.writeFileSync(path.join(base, 'web', 'env.txt'), ''); fs.writeFileSync(path.join(base, 'web', '.envrc'), '');
  assert.deepEqual(envFilesIn([path.join(base, 'web'), path.join(TMP, 'nope')]).map((f) => path.basename(f)), ['.env.local', '.env.template']);
});
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${n} passed`);
