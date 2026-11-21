// Self-test of base-guard.mjs: node scripts/verify/base-guard.selftest.mjs   (exit 0 = all pass). Temp folders only, fake paths under "someone"; never the real-data folder.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBase, dataDirValues, envFilesIn } from './base-guard.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pld-bgst-'));
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`PASS ${name}`); };
const REAL = '工作' + '日誌';
const git = (cwd, ...a) => { const e = { ...process.env }; delete e.GIT_DIR; delete e.GIT_WORK_TREE; delete e.GIT_INDEX_FILE; const r = spawnSync('git', ['-c', 'user.name=selftest', '-c', 'user.email=selftest@example.invalid', ...a], { cwd, encoding: 'utf8', env: e }); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); };
const main = path.join(TMP, 'someone', 'main'); const base = path.join(TMP, 'someone', 'base');
fs.mkdirSync(main, { recursive: true }); fs.writeFileSync(path.join(main, 'a.txt'), 'x');
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
  // tracked template files that nothing loads (the repo's own .env.example has a placeholder DATA_DIR on purpose) are not judged; the files that ARE loaded still are
  for (const t of ['.env.example', '.env.sample', '.env.template']) fs.writeFileSync(path.join(base, t), `DATA_DIR=${o}\n`);
  assert.equal(checkBase(base, R), null, 'template env files are not judged');
  fs.writeFileSync(path.join(base, '.env.production'), `DATA_DIR=${o}\n`); assert.match(checkBase(base, R), /DATA_DIR in \.env\.production/, 'a mode file that vite loads is judged'); fs.rmSync(path.join(base, '.env.production'));
  for (const t of ['.env.example', '.env.sample', '.env.template']) fs.rmSync(path.join(base, t));
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
  assert.deepEqual(envFilesIn([path.join(base, 'web'), path.join(TMP, 'nope')]).map((f) => path.basename(f)), ['.env.local']);
});
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${n} passed`);
