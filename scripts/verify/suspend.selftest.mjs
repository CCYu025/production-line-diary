// Self-test for suspend.mjs. No server, no packages: node scripts/verify/suspend.selftest.mjs  (exit 0 = all pass)
import assert from 'node:assert/strict';
import { applySuspend, classifySuspend, clock, findGaps } from './suspend.mjs';

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
  const r = applySuspend({ status: 'FAIL', value: { fail: 2, hits: ['a'] }, threshold: { fail: 0 }, reason: '2 failing sample(s)' }, s);
  assert.equal(r.status, 'INVALID'); assert.match(r.reason, /^system suspended \(gap 195s at \d\d:\d\d:\d\d\), rerun required$/);
  assert.equal(r.value.fail, 2); assert.deepEqual(r.value.hits, ['a']); assert.equal(r.value.originalStatus, 'FAIL'); assert.equal(r.value.originalReason, '2 failing sample(s)');
  assert.deepEqual(r.value.suspendedGaps, [{ start: clock(T0 + 5000), seconds: 195 }]); assert.deepEqual(r.threshold, { fail: 0 });
});
ok('suspend takes precedence over a timeout INVALID; a PASS during a suspend is INVALID too; null value handled', () => {
  const s = classifySuspend(beats(0, 100), T0, T0 + 100000);
  assert.match(applySuspend({ status: 'INVALID', value: null, reason: 'a command timed out and was killed: result is inconclusive' }, s).reason, /^system suspended/);
  assert.equal(applySuspend({ status: 'PASS', value: { a: 1 } }, s).status, 'INVALID');
  assert.deepEqual(applySuspend({ status: 'INVALID', value: null }, s).value.suspendedGaps, [{ start: clock(T0), seconds: 100 }]);
});
ok('no overlap: result untouched (a FAIL stays FAIL); SKIP / N/A never changed', () => {
  const none = classifySuspend(beats(0, 5, 10), T0, T0 + 10000);
  const f = { status: 'FAIL', value: { x: 1 }, reason: 'r' };
  assert.equal(applySuspend(f, none), f);
  const gap = classifySuspend(beats(0, 100), T0, T0 + 100000);
  assert.equal(applySuspend({ status: 'SKIP', value: null }, gap).status, 'SKIP'); assert.equal(applySuspend({ status: 'N/A', value: null }, gap).status, 'N/A');
});
ok('more than one gap in an item: first reported, count noted, all listed', () => {
  const s = classifySuspend(beats(0, 70, 71, 200), T0, T0 + 200000);
  const r = applySuspend({ status: 'PASS', value: {} }, s);
  assert.equal(r.value.suspendedGaps.length, 2); assert.match(r.reason, /\(\+1 more\)/);
});
console.log(`suspend selftest: ${n} passed`);
