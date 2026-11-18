// The OS director's phase names, as the verification scripts need them. ONE place on the script side:
// os-handoff.mjs builds its scenario table from TRANSITIONS, known-on-main.mjs builds the phase-timeout note pattern from PHASES / TRANSITIONS.
// The product's own list is the `Phase` type in web/src/features/os/director/reducer.ts (a TS type: node cannot import it, and the product does not export a runtime list).
// os-phases.selftest.mjs reads that file and fails if the two ever differ, so nothing here is a silent hand copy.
// os-common.mjs writes the timeout error ("timeout waiting for phase <name> (have <phase>><phase>...)") from the same names.

/** every value data-os-phase can take (same order as the Phase type) */
export const PHASES = ['boot', 'hub', 'entering-pre', 'entering-post', 'station', 'exiting-pre', 'exiting-post', 'switching-pre', 'switching-post'];

/** the three transitions: the phase stamped at the start (pre), at the handoff (post), and where the transition ends */
export const TRANSITIONS = {
  enter: { pre: 'entering-pre', post: 'entering-post', end: 'station' },
  exit: { pre: 'exiting-pre', post: 'exiting-post', end: 'hub' },
  switch: { pre: 'switching-pre', post: 'switching-post', end: 'station' },
};
