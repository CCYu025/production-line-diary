// Self-test for suspend.mjs. No server, no packages: node scripts/verify/suspend.selftest.mjs  (exit 0 = all pass)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySuspend, applyTimeout, classifySuspend, clock, findGaps } from './suspend.mjs';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log(`PASS ${name}`); };
const T0 = Date.UTC(2026, 10, 17, 1, 0, 0);
const beats = (...offsetsSec) => offsetsSec.map((s) => T0 + s * 1000);
const regular = (fromS, toS) => { const a = []; for (let s = fromS; s <= toS; s += 5) a.push(s); return a; };

ok('no gap: regular 5 s heartbeats', () => {
  const c = classifySuspend(beats(...regular(0, 120)), T0, T0 + 120000);
  assert.equal(c.suspended, false); assert.deepEqual(c.gaps, []);
});
ok('61 s gap inside the item -> suspended, with start clock and seconds', () => {
  const c = classifySuspend(beats(0, 5, 10, 71, 76, 81), T0, T0 + 81000);
  assert.equal(c.suspended, true); assert.equal(c.gaps.length, 1); assert.equal(c.gaps[0].seconds, 61); assert.equal(c.gaps[0].start, clock(T0 + 10000));
});
ok('exactly 60 s is not a suspend', () => {
  assert.equal(classifySuspend(beats(0, 60, 65), T0, T0 + 65000).suspended, false);
  assert.deepEqual(findGaps(beats(0, 60)), []);
});
ok('gap outside the item -> not suspended (gap before start, gap after end, touching a boundary)', () => {
  const hb = beats(0, 5, 100, 105, 110, 200);
  assert.equal(classifySuspend(hb, T0 + 100000, T0 + 110000).suspended, false); // gap 5..100 ends exactly at itemStart; gap 110..200 starts exactly at itemEnd
  assert.equal(classifySuspend(hb, T0 + 101000, T0 + 109000).suspended, false);
  assert.equal(classifySuspend(hb, T0 + 50000, T0 + 120000).suspended, true);   // an item that straddles the 5..100 gap
});
ok('item that was FAIL with a suspend inside -> INVALID, FAIL evidence kept in value', () => {
  const s = classifySuspend(beats(0, 5, 200), T0, T0 + 200000);
  const r = applySuspend({ status: 'FAIL', value: { fail: 2, hits: ['a'] }, threshold: { fail: 0 }, reason: '2 failing sample(s)' }, s, true);
  assert.equal(r.status, 'INVALID'); assert.match(r.reason, /^system suspended \(gap 195s at \d\d:\d\d:\d\d\), rerun required$/);
  assert.equal(r.value.fail, 2); assert.deepEqual(r.value.hits, ['a']); assert.equal(r.value.originalStatus, 'FAIL'); assert.equal(r.value.originalReason, '2 failing sample(s)');
  assert.deepEqual(r.value.suspendedGaps, [{ start: clock(T0 + 5000), seconds: 195 }]); assert.deepEqual(r.threshold, { fail: 0 });
});
ok('suspend takes precedence over a timeout INVALID; a PASS during a suspend is INVALID too; null value handled', () => {
  const s = classifySuspend(beats(0, 100), T0, T0 + 100000);
  assert.match(applySuspend({ status: 'INVALID', value: null, reason: 'a command timed out and was killed: result is inconclusive' }, s, true).reason, /^system suspended/);
  assert.equal(applySuspend({ status: 'PASS', value: { a: 1 } }, s, true).status, 'INVALID');
  assert.deepEqual(applySuspend({ status: 'INVALID', value: null }, s, true).value.suspendedGaps, [{ start: clock(T0), seconds: 100 }]);
});
ok('no overlap: result untouched (a FAIL stays FAIL); SKIP / N/A never changed', () => {
  const none = classifySuspend(beats(0, 5, 10), T0, T0 + 10000);
  const f = { status: 'FAIL', value: { x: 1 }, reason: 'r' };
  assert.equal(applySuspend(f, none, true), f);
  const gap = classifySuspend(beats(0, 100), T0, T0 + 100000);
  assert.equal(applySuspend({ status: 'SKIP', value: null }, gap, true).status, 'SKIP'); assert.equal(applySuspend({ status: 'N/A', value: null }, gap, true).status, 'N/A');
});
ok('more than one gap in an item: first reported, count noted, all listed', () => {
  const s = classifySuspend(beats(0, 70, 71, 200), T0, T0 + 200000);
  const r = applySuspend({ status: 'PASS', value: {} }, s, true);
  assert.equal(r.value.suspendedGaps.length, 2); assert.match(r.reason, /\(\+1 more\)/);
});
// ---------- L2-i fix 3: the suspend reclassification is a whitelist (time-sensitive items only)
ok('static item (not marked time-sensitive): FAIL / PASS inside a suspend gap stay as they are, exit-relevant status unchanged', () => {
  const gap = classifySuspend(beats(0, 5, 200), T0, T0 + 200000);
  const f = { status: 'FAIL', value: { exit: 1 }, reason: 'exit 1' };
  assert.equal(applySuspend(f, gap), f); assert.equal(applySuspend(f, gap, false), f);
  const p = { status: 'PASS', value: { exit: 0 } };
  assert.equal(applySuspend(p, gap), p, 'default is NOT time-sensitive');
  assert.equal(applySuspend(f, gap, true).status, 'INVALID', 'the same result of a time-sensitive item is INVALID');
});
ok('ITEM_DEFS in verify-holo.mjs: only the time-sensitive items are flagged; the static ones (ci-*, entry-delta-vs-base, tests-untouched, redline-grep, lab-bundle) are not', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-holo.mjs'), 'utf8');
  const m = /const ITEM_DEFS = (\[[\s\S]*?\n\]);/.exec(src);
  assert.ok(m, 'ITEM_DEFS found');
  const defs = new Function(`const T = true; return ${m[1]};`)();
  const flagged = defs.filter((d) => d[2] === true).map((d) => d[0]).sort();
  assert.deepEqual(flagged, ['c1-os', 'c1-web', 'holo-ime', 'holo-perf', 'holo-perf-20k', 'holo-still', 'os-e2e', 'os-handoff', 'os-handoff-4x']);
  for (const id of ['ci-check', 'ci-test', 'ci-typecheck', 'ci-test-web', 'ci-build', 'ci-bundle', 'entry-delta-vs-base', 'tests-untouched', 'redline-grep', 'lab-bundle']) assert.ok(defs.some((d) => d[0] === id && !d[2]), id);
});
// ---------- L2-i fix 2: timeout vs FAIL
ok('applyTimeout: a FAIL stays FAIL (timeout noted); PASS / INVALID become INVALID "aborted on timeout"; SKIP / N/A and no timeout untouched', () => {
  const f = applyTimeout({ status: 'FAIL', value: { fail: 3 }, reason: '3 failing sample(s)' }, true);
  assert.equal(f.status, 'FAIL'); assert.match(f.reason, /3 failing sample\(s\).*timeout.*aborted/); assert.deepEqual(f.value, { fail: 3 });
  const p = applyTimeout({ status: 'PASS', value: {} }, true); assert.equal(p.status, 'INVALID'); assert.match(p.reason, /aborted on timeout/);
  const i = applyTimeout({ status: 'INVALID', reason: 'os-handoff exit null, no result.json' }, true); assert.equal(i.status, 'INVALID'); assert.match(i.reason, /aborted on timeout.*no result\.json/);
  const noReason = applyTimeout({ status: 'FAIL', value: null }, true); assert.equal(noReason.status, 'FAIL'); assert.match(noReason.reason, /timeout/);
  const x = { status: 'PASS', value: {} }; assert.equal(applyTimeout(x, false), x);
  assert.equal(applyTimeout({ status: 'SKIP' }, true).status, 'SKIP'); assert.equal(applyTimeout({ status: 'N/A' }, true).status, 'N/A');
});
console.log(`suspend selftest: ${n} passed`);
