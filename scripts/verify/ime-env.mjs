// holo-ime: which exceptions are "the environment, not the product" (-> INVALID) and how a retried run is judged. Pure functions, no I/O.
// Designer ruling 2026-11-17. holo-ime.mjs uses classifyEnvError(); verify-holo.mjs uses envKindOf() and judgeRetry().
// Self-test: node scripts/verify/ime-env.selftest.mjs

/** THE one list of environmental exception kinds. Anything not matched here is a FAIL (a harness exception that is not on this list is treated as a real problem). */
export const ENV_ERROR_KINDS = {
  'page-not-ready': 'the lab page never became ready (waitFor timeout on window.__holoLab().frames, or window.__holoLab missing) before the first check',
  'cdp-connection-lost': 'the CDP connection broke or a CDP command timed out',
  'target-closed': 'the Chrome target (tab) was closed',
};

/** @returns {'page-not-ready'|'cdp-connection-lost'|'target-closed'|null} phase is the script's own marker of where it was ('page-ready' = before the first check) */
export function classifyEnvError(err, phase) {
  const m = String(err?.message ?? err ?? '');
  if (/Target closed|No target with given id|Session with given id not found|Inspected target navigated or closed/i.test(m)) return 'target-closed';
  if (/CDP timeout|WebSocket is not open|readyState \d|ECONNRESET|socket (hang up|closed)|fetch failed/i.test(m)) return 'cdp-connection-lost';
  if (phase === 'page-ready' && (/^waitFor timeout/.test(m) || /__holoLab/.test(m))) return 'page-not-ready';
  return null;
}

/** one attempt's result.json (+ exit code) -> { exit, failed, checks, invalid, envError } */
export const summarizeAttempt = (exit, j) => ({ exit, failed: j?.failed ?? null, checks: j?.results?.length ?? null, invalid: j?.invalid ?? null, envError: j?.envError ?? null });
export const envKindOf = (a) => (a?.envError && Object.hasOwn(ENV_ERROR_KINDS, a.envError.kind) ? a.envError.kind : null);
const envText = (e) => `${e.kind} at "${e.step}" (${String(e.message).slice(0, 160)})`;

/**
 * Judges a first attempt that ended in an environmental exception together with its single in-place retry.
 *  - retry has a real check failure / unknown outcome            -> FAIL
 *  - retry ends in the SAME environmental kind                   -> FAIL (two in a row: maybe the product's render loop did not start)
 *  - retry is PASS                                               -> INVALID (a retry never washes the first exception out)
 *  - retry is INVALID for another reason / another env kind      -> INVALID
 * Always records retried:true and the first exception; the reason always says "retried 1x".
 * @returns {{status:'FAIL'|'INVALID', reason:string, retried:true, firstAttempt:object, retry:object}}
 */
export function judgeRetry(first, retry) {
  const e1 = first.envError;
  const rec = { retried: true, firstAttempt: { kind: e1.kind, step: e1.step, message: e1.message }, retry };
  const head = `retried 1x after the first run ended in an environmental exception: ${envText(e1)}`;
  const k2 = envKindOf(retry);
  if (retry.exit === 1 || retry.failed > 0) return { ...rec, status: 'FAIL', reason: `${head}; the retry has ${retry.failed ?? '?'} failing check(s) (retried 1x)` };
  if (k2 && k2 === e1.kind) return { ...rec, status: 'FAIL', reason: `${head}; the retry ended in the SAME environmental exception (${envText(retry.envError)}): two consecutive ${e1.kind} exceptions, possibly the product's render loop did not start (retried 1x)` };
  if (retry.exit === 0) return { ...rec, status: 'INVALID', reason: `${head}; the retry was PASS (${retry.checks} checks) but a retry does not wash out the first exception: INVALID (retried 1x)` };
  if (retry.exit === 2) return { ...rec, status: 'INVALID', reason: `${head}; the retry was INVALID too: ${retry.envError ? envText(retry.envError) : retry.invalid} (retried 1x)` };
  return { ...rec, status: 'FAIL', reason: `${head}; the retry ended with exit ${retry.exit} and no usable result (retried 1x)` };
}

/** THE one definition of the arguments verify:holo gives holo-ime.mjs (README: method proj, freeze on and off). The real run and verify-holo.selftest.mjs both build the command line here. */
export const HOLO_IME_ARGS = ['--methods', 'proj', '--freeze', '1,0'];
export const buildImeArgs = (url, outDir) => ['--url', url, ...HOLO_IME_ARGS, '--out', outDir];

/** yields the items until stop() says halt. holo-ime.mjs iterates its freeze settings through this, so after the first exception (halt = true) no further combination runs
 *  (no overwritten envError / first exception, no extra CDP timeout). stop() is evaluated before every item. */
export function* untilHalt(items, stop) {
  for (const x of items) {
    if (stop()) return;
    yield x;
  }
}

/** exit 0 must agree with holo-ime's own result.json (same idea as os-handoff's handoffExitProblem): failed === 0, no invalid, no envError, every results[] entry pass:true,
 *  and `failed` equals the number of pass:false entries (holo-ime counts both together). Anything else = holo-ime itself is broken: FAIL, never PASS.
 *  @returns {string|null} a message when contradictory, else null */
export function imeExitProblem(exit, j) {
  if (exit !== 0) return null;
  if (!j || !Array.isArray(j.results) || typeof j.failed !== 'number') return 'holo-ime exited 0 but result.json has no results[] / numeric failed';
  const bad = j.results.filter((x) => x?.pass !== true).length;
  if (j.failed !== 0) return `holo-ime exited 0 but result.json has failed=${j.failed}`;
  if (bad > 0) return `holo-ime exited 0 but ${bad} entr${bad === 1 ? 'y' : 'ies'} in results[] did not pass`;
  if (j.invalid) return `holo-ime exited 0 but result.json has invalid=${JSON.stringify(j.invalid)}`;
  if (j.envError) return `holo-ime exited 0 but result.json has an envError (${j.envError.kind ?? '?'})`;
  return null;
}
