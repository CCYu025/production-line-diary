// Known-on-main classification for the os-handoff 4x item (designer ruling 2026-11-17).
// Pure functions, no server, no file writes. Used by verify-holo.mjs; self-test: known-on-main.selftest.mjs.
//
// Rule: if EVERY FAIL sample of a 4x run is on the allowlist (holo-baseline.json osHandoff4x.knownOnMain), the run is not
// a plain FAIL: verify-holo re-measures the same samples on the --base (main) worktree. Any other FAIL stays a FAIL.
// Never used for the 1x os-handoff item.

/** a FAIL row of os-handoff result.json counts as "known" only if it has this entry's id and EVERY note matches the entry's pattern */
export function matchesKnown(row, entry) {
  if (!row || row.status !== 'FAIL' || row.id !== entry.id) return false;
  const notes = Array.isArray(row.notes) ? row.notes : [];
  if (!notes.length) return false;
  const re = new RegExp(entry.notePattern);
  return notes.every((n) => typeof n === 'string' && re.test(n));
}

/**
 * @param {{results?: object[], summary?: {fail?: number}}|null} result parsed os-handoff result.json
 * @param {object[]} allowlist baseline osHandoff4x.knownOnMain
 * @returns {{fails: object[], known: object[], unknown: object[], allKnown: boolean}}
 *   allKnown is true only when there is at least one FAIL, every FAIL row is on the allowlist,
 *   and the number of FAIL rows equals summary.fail (an inconsistent file is never "known").
 */
export function classifyFails(result, allowlist) {
  const rows = Array.isArray(result?.results) ? result.results : [];
  const fails = rows.filter((r) => r && r.status === 'FAIL');
  const list = Array.isArray(allowlist) ? allowlist : [];
  const known = fails.filter((r) => list.some((e) => matchesKnown(r, e)));
  const unknown = fails.filter((r) => !known.includes(r));
  const consistent = result?.summary?.fail === undefined || result.summary.fail === fails.length;
  return { fails, known, unknown, allKnown: fails.length > 0 && unknown.length === 0 && consistent };
}

/** number of allowlisted FAIL rows in a result (used on the --base re-measurement) */
export function countKnown(result, allowlist) {
  return classifyFails(result, allowlist).known.length;
}

/**
 * Judge the --base (main) re-measurement. Pure.
 * A re-run that itself failed (no usable result.json, or an exit code other than 0/1: os-handoff exits 1 when it has FAIL samples, which is a normal result)
 * cannot be compared with anything: kind 'rerun-failed' (the caller still reports FAIL, the conservative direction, but must NOT say "main showed none").
 * @param {{exitCode: number|null, result: object|null, allowlist: object[], logPath?: string}} p
 * @returns {{kind: 'rerun-failed'|'known'|'none', hits: number, baseSamples: number|null, message: string}}
 */
export function judgeBaseRerun({ exitCode, result, allowlist, logPath = '' }) {
  const total = result?.summary?.total;
  const usable = result && typeof total === 'number' && Array.isArray(result.results) && (exitCode === 0 || exitCode === 1);
  if (!usable) {
    return { kind: 'rerun-failed', hits: 0, baseSamples: typeof total === 'number' ? total : null, message: `base re-run failed (exit ${exitCode ?? 'none'}${result ? '' : ', no result.json'}${logPath ? `, log ${logPath}` : ''}), so it cannot be compared with main: not known-on-main` };
  }
  const hits = countKnown(result, allowlist);
  return { kind: hits >= 1 ? 'known' : 'none', hits, baseSamples: total, message: hits >= 1 ? `main shows ${hits} too` : `main showed none in ${total} I2 samples` };
}

/**
 * Ratio rule (designer ruling 2026-11-17). INVALID (known-on-main) needs BOTH: (1) main timed out at least once in the same run,
 * and (2) branchTimeouts <= 3 * baseTimeouts * (branchSamples / baseSamples) + 2. Either one missing = FAIL.
 * Why a ratio: a fixed threshold does not depend on the sample count; the ratio answers "is this a pre-existing property of main at this rate".
 * Denominators are I2 sample counts: the branch's I2 rows in the 4x run, and the I2 rows of the --base re-run.
 * @returns {{invalid: boolean, limit: number|null, reason: string}}
 */
export function ratioVerdict({ branchTimeouts, branchSamples, baseTimeouts, baseSamples }) {
  if (!(baseTimeouts >= 1)) return { invalid: false, limit: null, reason: 'main showed no timeout in the same run' };
  if (!(baseSamples > 0) || !(branchSamples > 0)) return { invalid: false, limit: null, reason: 'sample counts are not usable' };
  const limit = 3 * baseTimeouts * (branchSamples / baseSamples) + 2;
  return branchTimeouts <= limit
    ? { invalid: true, limit, reason: `branch ${branchTimeouts}/${branchSamples} timeouts <= limit ${limit.toFixed(2)} (3 x ${baseTimeouts} x ${branchSamples}/${baseSamples} + 2): within what main shows` }
    : { invalid: false, limit, reason: `branch ${branchTimeouts}/${branchSamples} timeouts > limit ${limit.toFixed(2)} (3 x ${baseTimeouts} x ${branchSamples}/${baseSamples} + 2): more than main's rate explains` };
}

/** I2 sample count of an os-handoff result (rows with id I2) */
export const countI2 = (result) => (Array.isArray(result?.results) ? result.results.filter((r) => r && r.id === 'I2').length : 0);

/**
 * The whole known-on-main decision after the base re-run. Pure.
 * @returns {{status: 'INVALID'|'FAIL', value: object, message: string}}
 */
export function knownOnMainDecision({ branchResult, baseExit, baseResult, allowlist, logPath = '' }) {
  const branchTimeouts = countKnown(branchResult, allowlist);
  const branchSamples = countI2(branchResult);
  const jb = judgeBaseRerun({ exitCode: baseExit, result: baseResult, allowlist, logPath });
  if (jb.kind === 'rerun-failed') {
    return { status: 'FAIL', value: { branchTimeouts, branchSamples, baseTimeouts: null, baseSamples: jb.baseSamples, limit: null, baseExit }, message: `${branchTimeouts} I2 phase timeout(s), but ${jb.message}` };
  }
  const baseSamples = countI2(baseResult) || jb.baseSamples;
  const rv = ratioVerdict({ branchTimeouts, branchSamples, baseTimeouts: jb.hits, baseSamples });
  const value = { branchTimeouts, branchSamples, baseTimeouts: jb.hits, baseSamples, limit: rv.limit, baseExit };
  if (rv.invalid) return { status: 'INVALID', value, message: `${branchTimeouts} FAIL sample(s), all I2 phase timeouts; ${rv.reason} (known-on-main, not caused by this branch): needs designer/L2 judgement` };
  return { status: 'FAIL', value, message: `${branchTimeouts} I2 phase timeout(s); ${rv.reason}: not known-on-main` };
}
