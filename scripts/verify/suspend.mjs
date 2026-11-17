// Wall-clock suspend detection for verify-holo (Windows Modern Standby freezes node and Chrome together; a frozen item looked like an ordinary timeout).
// Pure functions, no server, no timers here. Self-test: node scripts/verify/suspend.selftest.mjs
// Heartbeats are Date.now() values recorded every 5 s while verify-holo runs. A gap strictly longer than 60 s between two neighbours means the process was suspended.
// This module never prevents sleep and never touches power settings (that is the user's decision).

export const HEARTBEAT_MS = 5000;
export const SUSPEND_GAP_MS = 60000;

/** all gaps (ms epoch start/end, seconds) between neighbouring heartbeats that are strictly longer than the threshold */
export function findGaps(heartbeats, thresholdMs = SUSPEND_GAP_MS) {
  const gaps = [];
  for (let i = 1; i < heartbeats.length; i++) {
    const d = heartbeats[i] - heartbeats[i - 1];
    if (d > thresholdMs) gaps.push({ startMs: heartbeats[i - 1], endMs: heartbeats[i], seconds: Math.round(d / 1000) });
  }
  return gaps;
}

/** local HH:MM:SS of an epoch ms */
export const clock = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };

/**
 * Gaps that overlap the item's run [itemStart, itemEnd] (touching at a boundary does not count).
 * @returns {{suspended: boolean, gaps: {start: string, startMs: number, seconds: number}[]}}
 */
export function classifySuspend(heartbeats, itemStart, itemEnd, thresholdMs = SUSPEND_GAP_MS) {
  const gaps = findGaps(heartbeats, thresholdMs).filter((g) => g.startMs < itemEnd && g.endMs > itemStart).map((g) => ({ start: clock(g.startMs), startMs: g.startMs, seconds: g.seconds }));
  return { suspended: gaps.length > 0, gaps };
}

/**
 * Turn a finished item result into INVALID when a suspend overlapped its run. Takes precedence over timeouts.
 * ONLY for items marked time-sensitive (browser, performance, input timing: ITEM_DEFS flag in verify-holo.mjs). Everything else is static: its result does not
 * depend on the clock (a build, a test run, a diff scan), so a FAIL stays a FAIL and a PASS stays a PASS (the top-level suspendedGaps still records the gap).
 * The default is "not time-sensitive": a new item is never reclassified unless it is explicitly marked.
 * Only a real overlap changes anything (a FAIL elsewhere stays a FAIL); the original verdict and its evidence stay in value.
 * SKIP / N/A items did not run: untouched.
 */
export function applySuspend(res, suspend, timeSensitive = false) {
  if (!timeSensitive || !suspend.suspended || res.status === 'SKIP' || res.status === 'N/A') return res;
  const g = suspend.gaps[0];
  const more = suspend.gaps.length > 1 ? ` (+${suspend.gaps.length - 1} more)` : '';
  return {
    ...res, status: 'INVALID',
    value: { ...(res.value && typeof res.value === 'object' ? res.value : { originalValue: res.value ?? null }), suspendedGaps: suspend.gaps.map(({ start, seconds }) => ({ start, seconds })), originalStatus: res.status, originalReason: res.reason ?? null },
    reason: `system suspended (gap ${g.seconds}s at ${g.start})${more}, rerun required`,
  };
}

/**
 * A command of the item hit the 40 minute timer and was killed. If the item already shows a FAIL, that FAIL is real evidence: it stays FAIL (the timeout is added to the reason).
 * Otherwise the result is incomplete: INVALID. Both messages say the run was aborted on the timeout. SKIP / N/A untouched.
 */
export function applyTimeout(res, timedOut) {
  if (!timedOut || res.status === 'SKIP' || res.status === 'N/A') return res;
  const note = 'a command hit the timeout and was aborted';
  if (res.status === 'FAIL') return { ...res, reason: `${res.reason ?? 'FAIL'} (${note}: the FAIL stands)` };
  return { ...res, status: 'INVALID', reason: `aborted on timeout: ${note}${res.reason ? `; ${res.reason}` : ''}, result is inconclusive` };
}
