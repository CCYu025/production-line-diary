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
