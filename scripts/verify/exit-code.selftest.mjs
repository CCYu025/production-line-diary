// node scripts/verify/exit-code.selftest.mjs   (exit 0 = all pass). Pure function, no child process, no port.
import assert from 'node:assert/strict';
import { overallExit } from './exit-code.mjs';

let k = 0;
const ok = (name, fn) => { fn(); k++; console.log(`PASS ${name}`); };
ok('all PASS, selftest=true -> 2 (a hooked run is never exit 0)', () => assert.equal(overallExit({ fail: 0, skip: 0, invalid: 0, selftest: true }), 2));
ok('all PASS, selftest=false -> 0', () => { assert.equal(overallExit({ fail: 0, skip: 0, invalid: 0, selftest: false }), 0); assert.equal(overallExit({}), 0); });
ok('any FAIL -> 1, with or without selftest, with or without SKIP/INVALID', () => {
  for (const selftest of [true, false]) for (const skip of [0, 1]) for (const invalid of [0, 2]) assert.equal(overallExit({ fail: 1, skip, invalid, selftest }), 1);
  assert.equal(overallExit({ fail: ['a', 'b'] }), 1);
});
ok('SKIP or INVALID without FAIL -> 2', () => {
  assert.equal(overallExit({ skip: 1 }), 2); assert.equal(overallExit({ invalid: 1 }), 2); assert.equal(overallExit({ skip: ['x'], invalid: ['y'] }), 2);
});
ok('interrupted run (incomplete) without FAIL -> 2', () => { assert.equal(overallExit({ incomplete: true }), 2); assert.equal(overallExit({ incomplete: true, fail: 1 }), 1); });
console.log(`exit-code selftest: ${k} groups passed`);
