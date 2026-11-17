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
