// Self-test for known-on-main.mjs. No server, no packages: node scripts/verify/known-on-main.selftest.mjs  (exit 0 = all pass)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyFails, countKnown } from './known-on-main.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BL = JSON.parse(fs.readFileSync(path.join(HERE, 'holo-baseline.json'), 'utf8'));
const allow = BL.osHandoff4x.knownOnMain;
assert.equal(allow.length, 1, 'the allowlist has exactly one entry');

const TIMEOUT = 'error: eval failed: Error: timeout waiting for phase switching-post (have switching-pre>station)';
const row = (id, status, notes) => ({ id, test: 't', kind: 'switch', variant: 'first-click', throttle: 4, planned: 0, achieved: null, status, attempts: 3, notes });
const mk = (rows) => ({ summary: { total: rows.length, fail: rows.filter((r) => r.status === 'FAIL').length, deviated: 0 }, results: rows });
// round-trip through real files, like the result.json verify-holo reads
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pld-kom-'));
const load = (name, obj) => { const p = path.join(dir, `${name}.json`); fs.writeFileSync(p, JSON.stringify(obj)); return JSON.parse(fs.readFileSync(p, 'utf8')); };
let n = 0; const ok = (name, fn) => { fn(); n++; console.log(`PASS ${name}`); };

ok('all FAILs are I2 phase timeouts -> allKnown', () => {
  const c = classifyFails(load('a', mk([row('I2', 'FAIL', [TIMEOUT]), row('I2', 'FAIL', [TIMEOUT.replace('switching', 'exiting')]), row('I2', 'PASS', [])])), allow);
  assert.equal(c.allKnown, true); assert.equal(c.known.length, 2); assert.equal(c.unknown.length, 0);
});
ok('one leaked click (I2 FAIL, other message) mixed in -> not allKnown', () => {
  const c = classifyFails(load('b', mk([row('I2', 'FAIL', [TIMEOUT]), row('I2', 'FAIL', ['click leaked to the page underneath: navigated to /records'])])), allow);
  assert.equal(c.allKnown, false); assert.equal(c.unknown.length, 1);
});
ok('I2 but not a phase timeout (eval failed otherwise) -> not allKnown', () => {
  assert.equal(classifyFails(load('c', mk([row('I2', 'FAIL', ['error: eval failed: Error: element not found'])])), allow).allKnown, false);
  assert.equal(classifyFails(load('c2', mk([row('I2', 'FAIL', ['error: eval failed: Error: timeout waiting for selector x'])])), allow).allKnown, false);
});
ok('timeout text on a non-I2 sample (I1) -> not allKnown', () => {
  assert.equal(classifyFails(load('d', mk([row('I1', 'FAIL', [TIMEOUT])])), allow).allKnown, false);
});
ok('a timeout note plus another note on the same sample -> not allKnown', () => {
  assert.equal(classifyFails(load('e', mk([row('I2', 'FAIL', [TIMEOUT, 'typed text swallowed'])])), allow).allKnown, false);
});
ok('FAIL sample with no notes -> not allKnown', () => {
  assert.equal(classifyFails(load('f', mk([row('I2', 'FAIL', [])])), allow).allKnown, false);
  assert.equal(classifyFails(load('f2', mk([row('I2', 'FAIL', undefined)])), allow).allKnown, false);
});
ok('no FAIL at all / empty / missing results -> not allKnown', () => {
  assert.equal(classifyFails(load('g', mk([row('I2', 'PASS', [])])), allow).allKnown, false);
  assert.equal(classifyFails(load('g2', mk([])), allow).allKnown, false);
  assert.equal(classifyFails(null, allow).allKnown, false);
  assert.equal(classifyFails({}, allow).allKnown, false);
});
ok('summary.fail disagrees with FAIL rows -> not allKnown', () => {
  const r = mk([row('I2', 'FAIL', [TIMEOUT])]); r.summary.fail = 2;
  assert.equal(classifyFails(load('h', r), allow).allKnown, false);
});
ok('empty / missing allowlist knows nothing', () => {
  const r = load('i', mk([row('I2', 'FAIL', [TIMEOUT])]));
  assert.equal(classifyFails(r, []).allKnown, false); assert.equal(classifyFails(r, undefined).allKnown, false);
});
ok('countKnown counts only allowlisted FAIL rows (base re-measurement)', () => {
  assert.equal(countKnown(load('j', mk([row('I2', 'PASS', []), row('I2', 'PASS', [])])), allow), 0);
  assert.equal(countKnown(load('j2', mk([row('I2', 'FAIL', [TIMEOUT]), row('I2', 'FAIL', ['other'])])), allow), 1);
});
fs.rmSync(dir, { recursive: true, force: true });
console.log(`known-on-main selftest: ${n} groups passed`);
