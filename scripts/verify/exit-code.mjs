// verify-holo's overall exit code, as a pure function (checked by exit-code.selftest.mjs and, end to end, by verify-holo.selftest.mjs).
//   1  any FAIL
//   2  no FAIL, but something is not a pass: a SKIP / INVALID item, an interrupted run (`incomplete`), or the VERIFY_HOLO_SELFTEST hooks are on (`selftest`: a stubbed run never exits 0)
//   0  everything PASS, no test hooks
// Each count may be a number or an array (its length is used).
const n = (x) => (Array.isArray(x) ? x.length : Number(x) || 0);
export function overallExit({ fail = 0, skip = 0, invalid = 0, selftest = false, incomplete = false } = {}) {
  if (n(fail) > 0) return 1;
  if (selftest || incomplete || n(skip) > 0 || n(invalid) > 0) return 2;
  return 0;
}
