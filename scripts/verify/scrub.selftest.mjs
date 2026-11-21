// Self-test of scrub.mjs (pure functions + a folder sweep): node scripts/verify/scrub.selftest.mjs   (exit 0 = all pass)
// The end-to-end proof (a whole --out folder of a real verify-holo run has no base path in any file) is verify-holo.selftest.mjs (f2-*).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathRegex, scrubPathText, scrubTree } from './scrub.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pld-scst-'));
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`PASS ${name}`); };
const WIN = 'C:\\Users\\someone\\pld-wt\\h2-base';
const SHORT = '…/h2-base';
const S = (text, given = WIN) => scrubPathText(text, { given, resolved: WIN, shortName: SHORT });

ok('every spelling of a Windows path is scrubbed: backslashes, forward slashes, JSON-escaped (\\\\), escaped twice (\\\\\\\\), mixed, doubled, other drive-letter / folder case', () => {
  const spellings = [
    'C:\\Users\\someone\\pld-wt\\h2-base', 'C:/Users/someone/pld-wt/h2-base', 'C:\\\\Users\\\\someone\\\\pld-wt\\\\h2-base', 'C:\\\\\\\\Users\\\\\\\\someone\\\\\\\\pld-wt\\\\\\\\h2-base',
    'C:/Users\\someone/pld-wt\\h2-base', 'C:\\Users/someone\\pld-wt/h2-base', 'C:\\\\Users/someone\\\\pld-wt/h2-base', 'C://Users//someone//pld-wt//h2-base', 'c:\\users\\SOMEONE\\pld-wt\\H2-BASE',
  ];
  for (const sp of spellings) {
    const out = S(`before ${sp}\\web\\dist after`);
    assert.ok(!/someone/i.test(out), `${JSON.stringify(sp)} -> ${out}`); assert.ok(out.includes(SHORT), out);
    const json = S(JSON.stringify({ dist: sp + '\\web\\dist' }));
    assert.ok(!/someone/i.test(json), `in json: ${json}`); assert.doesNotThrow(() => JSON.parse(json), 'the scrubbed json is still json');
  }
});
ok('JSON.stringify of the real path (the os-bundle `dist` field on Windows: doubled backslashes) is scrubbed and stays valid JSON', () => {
  const text = JSON.stringify({ dist: WIN + '\\web\\dist', chunks: ['assets/a.js'] }, null, 2);
  assert.ok(text.includes('C:\\\\Users'), 'premise: the JSON text has doubled backslashes');
  const out = S(text); assert.ok(!/someone/.test(out), out); assert.equal(JSON.parse(out).dist, `${SHORT}\\web\\dist`);
});
ok('the --base value as typed (relative, with / or \\) is scrubbed too, and a posix absolute path works the same', () => {
  const given = '..\\h2-base';
  assert.equal(S('x ..\\h2-base\\web y', given), 'x …/h2-base\\web y'); assert.equal(S('x ../h2-base/web y', given), 'x …/h2-base/web y');
  const posix = '/home/someone/pld-wt/h2-base';
  const o = scrubPathText('a /home/someone/pld-wt/h2-base/web b \\home\\someone\\pld-wt\\h2-base c', { given: posix, resolved: posix, shortName: SHORT });
  assert.ok(!/someone/.test(o), o);
});
ok('text without the path is unchanged; a different folder with another name is untouched; short or empty values scrub nothing', () => {
  const t = 'C:\\Users\\someone\\other\\work and h2-base alone';
  assert.equal(S(t), t);
  assert.equal(scrubPathText('abc', { given: '', resolved: '', shortName: SHORT }), 'abc'); assert.equal(scrubPathText('a/b', { given: 'a/b', resolved: 'a/b', shortName: SHORT }), 'a/b');
  assert.equal(pathRegex(''), null);
});
ok('scrubTree: rewrites every file that has the path (any extension, nested, json and log and extensionless), leaves clean files and binary files byte-identical, returns what it changed', () => {
  const d = path.join(TMP, 'tree'); fs.mkdirSync(path.join(d, 'sub', 'deep'), { recursive: true });
  const w = (f, t) => { fs.writeFileSync(path.join(d, f), t); };
  w('a.json', JSON.stringify({ dist: WIN + '\\web\\dist' })); w('logs.log', `x ${WIN.replace(/\\/g, '/')}/web\n`); w('noext', WIN); w(path.join('sub', 'deep', 'b.txt'), 'C:\\\\Users\\\\someone\\\\pld-wt\\\\h2-base'); w('clean.json', '{"a":1}');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]), Buffer.from(WIN)]); fs.writeFileSync(path.join(d, 'shot.png'), png); fs.writeFileSync(path.join(d, 'bin.dat'), png);
  const changed = scrubTree(d, S).map((f) => path.relative(d, f).split(path.sep).join('/')).sort();
  assert.deepEqual(changed, ['a.json', 'logs.log', 'noext', 'sub/deep/b.txt']);
  for (const f of changed) assert.ok(!/someone/.test(fs.readFileSync(path.join(d, f), 'utf8')), f);
  assert.equal(fs.readFileSync(path.join(d, 'clean.json'), 'utf8'), '{"a":1}'); assert.ok(fs.readFileSync(path.join(d, 'shot.png')).equals(png)); assert.ok(fs.readFileSync(path.join(d, 'bin.dat')).equals(png));
  assert.deepEqual(scrubTree(d, S), [], 'a second sweep changes nothing');
  assert.deepEqual(scrubTree(path.join(TMP, 'does-not-exist'), S), []);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${n} passed`);
