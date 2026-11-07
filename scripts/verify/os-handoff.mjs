// I1-I4: OS-mode transition input gating (spec §5.1, §9.2).
//   I1  before the handoff of ENTER / EXIT / SWITCH the first click or key press jumps the transition to its end and reaches nothing underneath;
//       the next click hits its target. Sampled at the offsets below, measured against in-page phase-change stamps.
//   I2  first click right after the handoff (0/10/25/50 ms after the *-post stamp) hits the destination target directly.
//   I3  canvas#os-overlay is pointer-events:none in every state; document.elementFromPoint never returns it (dense grid sampler over
//       enter, exit and short transitions, palette open/close).
//   I4  enter -> Esc -> enter at 100 ms intervals x10: consistent final phase/route/focus, no leftover overlay.
//
// How the offsets are really hit (X0 weakness fixed): the page hook (os-common HOOK_SRC) stamps every data-os-phase change with
// performance.now(). The click is armed BEFORE the transition is triggered (`__at(phase, since, offset, lead)` resolves in-page exactly
// when stamp+offset-lead is reached; Node then sends the CDP input right away). After the click the ACHIEVED offset is computed from the
// stamps (pointerdown/keydown time - phase stamp). |achieved - planned| > 25 ms (or landing in another phase) => the sample is DEVIATED:
// it is retried (the CDP latency `lead` is learned per throttle) and, if it never lands, reported as DEVIATED (inconclusive, never a pass).
//
// node scripts/verify/os-handoff.mjs --url http://localhost:3114/ [--throttles 1,4] [--only i1,key,switch,i2,i3,i4] [--reps 3] [--headed]
// Must run against a server started with serve.mjs (fresh copy of the example data).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { sleep } from './cdp.mjs';
import { SEL, SORT_EXPR, PHASE_EXPR, VISIBLE_FN, q, hudCh, osUrl, launchChrome, openPage, waitPhase, centerOf, calibrate } from './os-common.mjs';

const { values: A } = parseArgs({
  options: {
    url: { type: 'string' }, out: { type: 'string', default: 'verify-out/os-handoff' },
    throttles: { type: 'string', default: '1,4' }, only: { type: 'string', default: 'i1,key,switch,i2,i3,i4' },
    viewport: { type: 'string', default: '1440x900' }, 'cdp-port': { type: 'string', default: '9601' },
    reps: { type: 'string', default: '3' }, osdebug: { type: 'string', default: '' },
    'enter-step': { type: 'string', default: '50' }, 'exit-step': { type: 'string', default: '50' }, 'switch-step': { type: 'string', default: '25' },
    tolerance: { type: 'string', default: '25' }, attempts: { type: 'string', default: '3' }, kinds: { type: 'string', default: 'enter,exit,switch' },
    'strict-focus': { type: 'boolean', default: false }, 'allow-deviated': { type: 'boolean', default: false },
    headed: { type: 'boolean', default: false }, verbose: { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
  },
});
if (A.help || !A.url) {
  console.log(`node scripts/verify/os-handoff.mjs --url http://localhost:3114/ [--throttles 1,4] [--only i1,key,switch,i2,i3,i4] [--reps 3]
  [--viewport 1440x900] [--out dir] [--osdebug a,b] [--enter-step 50 --exit-step 50 --switch-step 25] [--tolerance 25] [--attempts 3] [--kinds enter,exit,switch]
  [--strict-focus] [--allow-deviated] [--headed] [--cdp-port 9601]
  exit code: 1 any FAIL; 3 no FAIL but DEVIATED samples (inconclusive; --allow-deviated ignores them); 0 clean`);
  process.exit(A.help ? 0 : 2);
}
const [VW, VH] = A.viewport.split('x').map(Number);
const throttles = A.throttles.split(',').map(Number);
const only = new Set(A.only.split(','));
const TOL = +A.tolerance, ATTEMPTS = +A.attempts;
const range = (a, b, s) => { const r = []; for (let o = a; o <= b; o += s) r.push(o); return r; };

// ---------------------------------------------------------------- scenario table
const SC = {
  enter: {
    pre: 'entering-pre', post: 'entering-post', end: 'station', total: 1200, handoff: 875,
    url: () => osUrl(A.url, { osdebug: A.osdebug }), ready: q(SEL.hudCh02),
    offsets: range(0, 850, +A['enter-step']), keyOffsets: [50, 400, 850], variants: ['sort', 'hud'],
    focusCandidates: [hudCh(5), SEL.exit, SEL.hudCh02],
  },
  exit: {
    pre: 'exiting-pre', post: 'exiting-post', end: 'hub', total: 900, handoff: 300,
    url: () => osUrl(A.url, { hash: '#/records', osdebug: A.osdebug }), ready: q(SEL.back),
    offsets: range(0, 300, +A['exit-step']), keyOffsets: [50, 150, 250], variants: ['hud'],
    // I2 offsets are measured from the *-post stamp (= handoff). Exit: 300..900 ms after the transition start == 0..600 ms after the handoff;
    // the input gate must never swallow any of them (clicks/keys reach the hub directly).
    postOffsets: [0, 10, 25, 50, 100, 200, 300, 400, 500, 600],
    focusCandidates: [SORT_EXPR_SEL()],
  },
  switch: {
    pre: 'switching-pre', post: 'switching-post', end: 'station', total: 300, handoff: 75,
    url: () => osUrl(A.url, { hash: '#/records', osdebug: A.osdebug }), ready: q(SEL.back),
    offsets: range(0, 75, +A['switch-step']), keyOffsets: [25, 50], variants: ['back', 'kpi'], triggers: ['hash', 'palette'],
    focusCandidates: [SEL.back],
  },
};
/** CSS version of the sort control (focus candidate list uses selectors) */
function SORT_EXPR_SEL() { return 'main th[aria-sort] button, main button[aria-label*="排序"]'; }
const POST_OFFSETS = [0, 10, 25, 50]; // default; a scenario may override with postOffsets (exit covers up to 900 ms from its start)
let browser, pts;
const results = [];
const leads = {}; // learned CDP round-trip compensation per throttle

// ---------------------------------------------------------------- trigger helpers
/** Things that must be done BEFORE the wait is armed (e.g. open the palette). */
async function prepare(p, kind, trigger) {
  if (kind === 'switch' && trigger === 'palette') {
    await p.key('k', { modifiers: 2 });
    await p.waitFor(q(SEL.palette), 3000);
    await p.eval(`(${q(SEL.paletteInput)}).focus()`);
    await p.insertText('dash');
    await sleep(120);
  }
}
/** Starts the transition (the wait promise must already be armed). */
async function fire(p, kind, trigger) {
  if (kind === 'enter') {
    const c = (await centerOf(p, q(SEL.hudCh02))) ?? pts.hud;
    await p.mouseMove(c.x, c.y); await p.mouseDown(c.x, c.y); await p.mouseUp(c.x, c.y);
  } else if (kind === 'exit') {
    const c = (await centerOf(p, q(SEL.back))) ?? pts.back;
    await p.mouseMove(c.x, c.y); await p.mouseDown(c.x, c.y); await p.mouseUp(c.x, c.y);
  } else if (trigger === 'palette') {
    await p.key('Enter');
  } else {
    await p.eval(`location.hash='#/dashboard'`);
  }
}
async function openFor(kind, throttle) {
  const sc = SC[kind];
  const p = await openPage(browser, sc.url(), { width: VW, height: VH, throttle });
  if (kind === 'enter') await waitPhase(p, 'hub', 15000); else await waitPhase(p, 'station', 15000);
  await p.waitFor(sc.ready, 10000);
  await sleep(kind === 'switch' ? 900 : 700);
  return p;
}
const pointOf = async (p, variant) => {
  if (variant === 'sort') return (await centerOf(p, SORT_EXPR)) ?? pts.sort;
  if (variant === 'hud') return (await centerOf(p, q(SEL.hudCh02))) ?? pts.hud;
  if (variant === 'back') return (await centerOf(p, q(SEL.back))) ?? pts.back;
  if (variant === 'kpi') return pts.kpi ?? pts.back;
  throw new Error('variant ' + variant);
};

const afterState = (p) => p.eval(`(()=>({phase:${PHASE_EXPR},hash:location.hash,dialogs:document.querySelectorAll('[role=dialog],[role=alertdialog]').length,
  activeIsSort:(()=>{const s=${SORT_EXPR};return !!s&&document.activeElement===s})(),active:(document.activeElement&&document.activeElement.tagName)||null}))()`);

/** Assertions after a swallowed gesture; returns problems[] (empty = ok). */
async function assertSwallowed(p, sc, hashAtEvent, achieved) {
  const bad = [];
  let st; const t0 = Date.now();
  do { st = await afterState(p); if (st.phase === sc.end) break; await sleep(15); } while (Date.now() - t0 < 500);
  if (st.phase !== sc.end) bad.push(`phase=${st.phase} (want ${sc.end})`);
  if (st.hash !== hashAtEvent) bad.push(`hash changed ${hashAtEvent} -> ${st.hash} (a click/key reached the page underneath)`);
  if (/sort=asc/.test(st.hash)) bad.push('sort=asc in hash');
  if (st.dialogs) bad.push(`${st.dialogs} dialog(s) opened`);
  if (st.activeIsSort) bad.push('underlying sort control got focus');
  // stale-timer check: once at the end phase it must stay there until the planned total has long passed
  await sleep(Math.max(0, sc.total - (achieved ?? 0)) + 250);
  const tl = await p.eval('__phases.map(x=>x.phase+"@"+Math.round(x.now))');
  const names = tl.map((x) => x.split('@')[0]);
  const firstEnd = names.indexOf(sc.end, names.lastIndexOf(sc.pre));
  if (firstEnd >= 0 && names.length - 1 > firstEnd) bad.push('phase regressed after the jump: ' + tl.slice(-5).join(' > '));
  if (bad.length) bad.push('timeline: ' + tl.slice(-6).join(' > '));
  return bad;
}

/** second, real gesture on the true target after a swallowed one; returns a problem string or null */
async function followUp(p, kind, input, key) {
  await sleep(150);
  if (kind === 'enter') {
    if (input === 'key') { await p.eval(`(${SORT_EXPR})?.focus()`); await p.key(key); }
    else { const c = (await centerOf(p, SORT_EXPR)) ?? pts.sort; await p.click(c.x, c.y); }
    return p.waitFor(`/sort=asc/.test(location.hash)`, 1500).then(() => null, () => 'follow-up on the sort control did not produce sort=asc');
  }
  const want = kind === 'exit' ? 'entering-pre' : 'exiting-pre';
  const sel = kind === 'exit' ? SEL.hudCh02 : SEL.back;
  if (input === 'key') { await p.eval(`(${q(sel)})?.focus()`); await p.key(key); }
  else { const c = (await centerOf(p, q(sel))) ?? (kind === 'exit' ? pts.hud : pts.back); await p.click(c.x, c.y); }
  return p.waitFor(`${PHASE_EXPR}==='${want}'`, 1500, 15).then(() => null, () => `follow-up on ${sel} did not start ${want}`);
}

// ---------------------------------------------------------------- one attempt of an I1 sample
async function preOnce({ kind, variant, trigger, input, key, offset, throttle }) {
  const sc = SC[kind]; const notes = [];
  const lead = leads[throttle] ?? 4;
  const p = await openFor(kind, throttle);
  try {
    await prepare(p, kind, trigger);
    const tp = input === 'pointer' ? await pointOf(p, variant) : null;
    const since = await p.eval('__phases.length');
    const armed = p.eval(`__at(${JSON.stringify([sc.pre])},${since},${offset},${lead},6000)`, true);
    armed.catch(() => {}); // the error (if any) surfaces at `await armed`
    await fire(p, kind, trigger);
    let focus = null;
    if (input === 'key') {
      focus = await p.eval(`(()=>{for(const s of ${JSON.stringify(sc.focusCandidates)}){const e=document.querySelector(s);if(!e)continue;try{e.focus()}catch(x){}
        if(document.activeElement===e) return s;} const a=document.activeElement; return a&&a!==document.body?('(existing) '+a.tagName.toLowerCase()+(a.getAttribute('data-os')?'[data-os='+a.getAttribute('data-os')+']':'')):'body'})()`);
    } else if (tp) await p.mouseMove(tp.x, tp.y);
    const arm = await armed;
    if (input === 'pointer') { await p.mouseDown(tp.x, tp.y); await p.mouseUp(tp.x, tp.y); } else await p.key(key);
    const evType = input === 'pointer' ? 'pointerdown' : 'keydown';
    const ev = (await p.eval(`__ev.filter(e=>e.t===${JSON.stringify(evType)}&&e.now>${arm.e.now})`))[0];
    if (!ev) return { status: 'FAIL', achieved: null, notes: [`${evType} not recorded after the phase stamp`], p };
    const achieved = Math.round(ev.now - arm.e.now);
    const delta = achieved - offset;
    leads[throttle] = Math.max(0, Math.min(80, lead + delta));
    if (ev.ph !== sc.pre) return { status: 'DEVIATED', achieved, notes: [`${evType} landed in phase ${ev.ph} (wanted ${sc.pre})`], p };
    const bad = await assertSwallowed(p, sc, ev.hash, achieved);
    const fu = await followUp(p, kind, input, key);
    if (fu) bad.push(fu);
    if (input === 'key') {
      notes.push(`focus=${focus} keydown-target=${ev.tg}`);
      if (/body/.test(String(focus)) && A['strict-focus']) bad.push('focus could not be placed on a real control (--strict-focus)');
    }
    if (bad.length) return { status: 'FAIL', achieved, notes: [...notes, ...bad], p };
    if (Math.abs(delta) > TOL) return { status: 'DEVIATED', achieved, notes: [...notes, `achieved offset deviates ${delta}ms > ${TOL}ms (behaviour was correct but the sample is not counted)`], p };
    return { status: 'PASS', achieved, notes, p };
  } catch (e) {
    return { status: 'ERROR', achieved: null, notes: ['error: ' + e.message.split('\n')[0]], p };
  }
}

/** Runs attempts until the planned offset is really hit (PASS/FAIL) or attempts are exhausted (DEVIATED). */
async function sample(spec) {
  let last;
  for (let i = 1; i <= ATTEMPTS; i++) {
    last = await preOnce(spec);
    await last.p?.close();
    last.attempts = i;
    if (last.status === 'PASS' || last.status === 'FAIL') break;
  }
  if (last.status === 'ERROR') last.status = 'FAIL';
  return last;
}
function record(id, test, spec, r) {
  const row = { id, test, kind: spec.kind, variant: spec.variant ?? spec.key ?? '-', trigger: spec.trigger ?? null, input: spec.input ?? null, throttle: spec.throttle, planned: spec.offset, achieved: r.achieved ?? null, status: r.status, attempts: r.attempts ?? 1, notes: r.notes ?? [] };
  results.push(row);
  console.log(`${r.status.padEnd(8)} ${id} ${spec.kind}/${row.variant}${spec.trigger ? '/' + spec.trigger : ''} x${spec.throttle} planned=${spec.offset} achieved=${row.achieved ?? '?'}ms try=${row.attempts}${row.notes.length ? '  ' + row.notes.join('; ') : ''}`);
}

// ---------------------------------------------------------------- I1 pointer
async function runI1(throttle, kinds) {
  for (const kind of kinds) {
    const sc = SC[kind];
    for (const trigger of sc.triggers ?? [null]) for (const variant of sc.variants) for (const offset of sc.offsets) {
      const spec = { kind, variant, trigger, input: 'pointer', offset, throttle };
      record('I1', 'pointer', spec, await sample(spec));
    }
  }
}
// ---------------------------------------------------------------- I1 keyboard (focus on a real control, not body)
async function runKey(throttle, kinds) {
  for (const kind of kinds) {
    const sc = SC[kind];
    for (const key of ['Enter', 'Space']) for (const offset of sc.keyOffsets) {
      const spec = { kind, key, variant: key, trigger: sc.triggers?.[0] ?? null, input: 'key', offset, throttle };
      record('I1', 'keyboard', spec, await sample(spec));
    }
  }
}

// ---------------------------------------------------------------- I2 first click after the handoff
const POST_TARGET = {
  enter: { label: (c) => /排序/.test(c ?? ''), effect: (p) => p.waitFor(`/sort=asc/.test(location.hash)`, 1500), what: 'sort=asc' },
  exit: { label: (c) => /\|hud-ch\|CH-02/.test(c ?? ''), effect: (p) => p.waitFor(`${PHASE_EXPR}==='entering-pre'`, 1500, 15), what: 'entering-pre' },
  switch: { label: (c) => /\|back\|/.test(c ?? ''), effect: (p) => p.waitFor(`${PHASE_EXPR}==='exiting-pre'`, 1500, 15), what: 'exiting-pre' },
};
async function postOnce({ kind, trigger, offset, throttle }) {
  const sc = SC[kind]; const lead = leads[throttle] ?? 4; const notes = [];
  const p = await openFor(kind, throttle);
  try {
    await prepare(p, kind, trigger);
    const since = await p.eval('__phases.length');
    const armed = p.eval(`__at(${JSON.stringify([sc.post])},${since},${offset},${lead},6000)`, true);
    armed.catch(() => {});
    await fire(p, kind, trigger);
    const arm = await armed;
    const live = kind === 'enter' ? await centerOf(p, SORT_EXPR) : kind === 'exit' ? await centerOf(p, q(SEL.hudCh02)) : await centerOf(p, q(SEL.back));
    const c = live ?? (kind === 'enter' ? pts.sort : kind === 'exit' ? pts.hud : pts.back);
    if (!live) notes.push('target rect unavailable at click time (calibrated point used)');
    await p.mouseDown(c.x, c.y); await p.mouseUp(c.x, c.y);
    const ev = (await p.eval(`__ev.filter(e=>e.t==='pointerdown'&&e.now>${arm.e.now})`))[0];
    if (!ev) return { status: 'FAIL', notes: ['pointerdown not recorded'], p };
    const achieved = Math.round(ev.now - arm.e.now); const delta = achieved - offset;
    leads[throttle] = Math.max(0, Math.min(80, lead + delta));
    // an offset that reaches the very end of the transition may legitimately land in the end phase (input must be live there as well)
    const tailOk = offset >= sc.total - sc.handoff - TOL && ev.ph === sc.end;
    if (ev.ph !== sc.post && !tailOk) return { status: 'DEVIATED', achieved, notes: [`pointerdown landed in phase ${ev.ph} (wanted ${sc.post})`], p };
    const bad = [];
    if (!POST_TARGET[kind].label(ev.ctl)) bad.push(`pointerdown hit "${ev.ctl}" instead of the destination target`);
    const hit = await POST_TARGET[kind].effect(p).then(() => true, () => false);
    if (!hit) bad.push(`first click after the handoff did not produce ${POST_TARGET[kind].what}`);
    if (bad.length) return { status: 'FAIL', achieved, notes: [...notes, ...bad], p };
    if (Math.abs(delta) > TOL) return { status: 'DEVIATED', achieved, notes: [...notes, `achieved offset deviates ${delta}ms > ${TOL}ms`], p };
    return { status: 'PASS', achieved, notes, p };
  } catch (e) { return { status: 'ERROR', notes: ['error: ' + e.message.split('\n')[0]], p }; }
}
async function runI2(throttle, kinds) {
  for (const kind of kinds) for (const offset of (SC[kind].postOffsets ?? POST_OFFSETS)) for (let rep = 0; rep < (offset === 0 ? +A.reps : 1); rep++) {
    const spec = { kind, variant: 'first-click', trigger: SC[kind].triggers?.[0] ?? null, offset, throttle };
    let last;
    for (let i = 1; i <= ATTEMPTS; i++) { last = await postOnce(spec); await last.p?.close(); last.attempts = i; if (last.status === 'PASS' || last.status === 'FAIL') break; }
    if (last.status === 'ERROR') last.status = 'FAIL';
    record('I2', 'post-handoff', spec, last);
  }
}

// ---------------------------------------------------------------- I3 sampler
const SAMPLER = `(()=>{ if(window.__samp) return; const S=window.__samp={n:0,viol:[],pe:{},phases:{},stop:false,overlaySeen:false,display:{}};
  const W=innerWidth,H=innerHeight; const pts=[]; for(let i=0;i<12;i++)for(let j=0;j<7;j++)pts.push([(i+0.5)*W/12,(j+0.5)*H/7]);
  pts.push([1,1],[W-2,1],[1,H-2],[W-2,H-2],[W/2,H/2]);
  const tick=()=>{ if(S.stop) return; const ph=document.documentElement.dataset.osPhase||'none'; const o=document.querySelector('canvas#os-overlay');
    const cs=o?getComputedStyle(o):null; const pe=cs?cs.pointerEvents:'(absent)'; if(o) S.overlaySeen=true;
    S.n++; S.phases[ph]=(S.phases[ph]||0)+1; const m=(S.pe[ph]=S.pe[ph]||{}); m[pe]=(m[pe]||0)+1;
    if(cs){ const dd=(S.display[ph]=S.display[ph]||{}); const k=cs.display+'/'+(o.dataset.active||'-'); dd[k]=(dd[k]||0)+1; }
    if(o&&pe!=='none'&&S.viol.length<30) S.viol.push({ph,pe,t:performance.now()});
    for(const [x,y] of pts){ const el=document.elementFromPoint(x,y); if(el&&(el===o||el.id==='os-overlay')){ if(S.viol.length<30) S.viol.push({ph,hit:[Math.round(x),Math.round(y)],t:performance.now()}); break; } } };
  S.iv=setInterval(tick,16); const raf=()=>{ tick(); if(!S.stop) requestAnimationFrame(raf); }; requestAnimationFrame(raf); })()`;
async function runI3(throttle) {
  const notes = []; let status = 'PASS'; let p;
  try {
    p = await openFor('enter', throttle);
    await p.eval(SAMPLER);
    // hub -> palette open/close -> enter -> short switch -> exit
    await p.key('k', { modifiers: 2 }); await p.waitFor(q(SEL.palette), 3000).catch(() => notes.push('palette did not open (informational)')); await sleep(250);
    await p.key('Escape'); await sleep(250);
    const c = (await centerOf(p, q(SEL.hudCh02))) ?? pts.hud; await p.click(c.x, c.y);
    await waitPhase(p, 'station', 8000); await sleep(400);
    await p.eval(`location.hash='#/dashboard'`);
    await p.waitFor(`__phases.some(x=>x.phase==='switching-pre')`, 4000).catch(() => notes.push('no switching-pre phase seen'));
    await waitPhase(p, 'station', 8000); await sleep(500);
    const bc = (await centerOf(p, q(SEL.back))) ?? pts.back; await p.click(bc.x, bc.y);
    await waitPhase(p, 'hub', 8000); await sleep(500);
    const S = await p.eval('(window.__samp.stop=true, JSON.parse(JSON.stringify(window.__samp)))');
    const need = ['hub', 'entering-pre', 'entering-post', 'station', 'exiting-pre', 'exiting-post', 'switching-pre', 'switching-post'];
    const missing = need.filter((ph) => !S.phases[ph]);
    if (S.viol.length) { status = 'FAIL'; notes.push(`${S.viol.length} violation(s): ${JSON.stringify(S.viol.slice(0, 3))}`); }
    if (!S.overlaySeen) { status = 'FAIL'; notes.push('canvas#os-overlay never present in DOM'); }
    for (const ph of Object.keys(S.pe)) for (const v of Object.keys(S.pe[ph])) if (v !== 'none') { status = 'FAIL'; notes.push(`pointer-events=${v} in ${ph}`); }
    if (missing.length) notes.push('phases not sampled (informational): ' + missing.join(','));
    notes.push(`samples=${S.n} perPhase=${JSON.stringify(S.phases)} overlay display/active=${JSON.stringify(S.display)}`);
  } catch (e) { status = 'FAIL'; notes.push('error: ' + e.message.split('\n')[0]); }
  await p?.close();
  record('I3', 'overlay', { kind: 'enter+switch+exit', variant: '12x7+corners@16ms', throttle, offset: 0 }, { status, notes });
}

// ---------------------------------------------------------------- I4 enter -> Esc -> enter x10 @100ms
const SETTLED = `(()=>{ const V=${VISIBLE_FN}; const root=document.documentElement; const ph=root.getAttribute('data-os-phase');
  const o=document.querySelector('canvas#os-overlay'); const cs=o?getComputedStyle(o):null; const a=document.activeElement;
  const st=document.querySelector('[data-os="station"]'), hud=document.querySelector('[data-os="hud"]');
  const main=document.getElementById('main'); const hudBtns=[...document.querySelectorAll('[data-os="hud-ch"]')];
  return { ph, phaseTokens: ph?ph.split(/\\s+/).length:0, hash:location.hash, mode:root.getAttribute('data-mode'),
    overlayActive: !!document.querySelector('#os-overlay[data-active="true"]'), overlayDisplay: cs?cs.display:'(absent)',
    stationVisible: V(st), hudBtnVisible: hudBtns.some(V),
    dialogs: document.querySelectorAll('[role=dialog],[role=alertdialog]').length, lives: document.querySelectorAll('[data-os="live"]').length,
    activeIsHudBtn: !!(a&&a.matches&&a.matches('[data-os="hud-ch"]')), activeInMain: !!(a&&main&&(a===main||main.contains(a))),
    active: a?a.tagName.toLowerCase()+(a.id?'#'+a.id:'')+(a.getAttribute('data-os')?'[data-os='+a.getAttribute('data-os')+']':''):null,
    stationInert: !!(st&&st.closest('[inert]')), hudInert: !!(hud&&hud.closest('[inert]')) }; })()`;
async function i4Cycle(throttle, mode) {
  const notes = []; let status = 'PASS'; let p;
  try {
    p = await openFor('enter', throttle);
    const enterAction = async () => {
      if (mode === 'key') {
        await p.eval(`(()=>{const b=document.querySelector(${JSON.stringify(SEL.hudCh02)}); if(b&&!b.closest('[inert]')) b.focus();})()`);
        await p.key('Enter');
      } else {
        const hit = await p.eval(`(()=>{const b=document.querySelector(${JSON.stringify(SEL.hudCh02)}); if(!b) return null; const r=b.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const e=document.elementFromPoint(x,y); return e&&b.contains(e)?{x,y}:null})()`);
        if (hit) await p.click(hit.x, hit.y);
      }
    };
    for (let i = 0; i < 10; i++) { await enterAction(); await sleep(100); await p.key('Escape'); await sleep(100); }
    await enterAction();
    await sleep(2200);
    const s = await p.eval(SETTLED);
    const bad = [];
    if (s.phaseTokens !== 1 || !['hub', 'station'].includes(s.ph)) bad.push(`not settled on exactly one stable phase: "${s.ph}"`);
    if (s.mode !== 'os') bad.push('data-mode is ' + s.mode);
    if (s.overlayActive) bad.push('#os-overlay[data-active=true] left over');
    if (s.overlayDisplay !== 'none' && s.overlayDisplay !== '(absent)') bad.push('overlay display=' + s.overlayDisplay + ' (want none when settled)');
    if (s.dialogs) bad.push(s.dialogs + ' dialog(s) open');
    if (s.lives !== 1) bad.push(`${s.lives} live regions (want 1)`);
    if (s.ph === 'hub') {
      if (s.hash !== '#/os') bad.push(`phase hub but hash ${s.hash}`);
      if (s.stationVisible) bad.push('phase hub but station visible');
      if (!s.hudBtnVisible || s.hudInert) bad.push('phase hub but HUD not visible/operable');
      if (!s.activeIsHudBtn) bad.push('phase hub but focus is not on a HUD channel button: ' + s.active);
    } else if (s.ph === 'station') {
      if (s.hash === '#/os' || !/^#\//.test(s.hash)) bad.push(`phase station but hash ${s.hash}`);
      if (!s.stationVisible || s.stationInert) bad.push('phase station but station not visible/operable');
      if (s.hudBtnVisible && !s.hudInert) notes.push('WARN: HUD still visible+operable at station');
      if (!s.activeInMain) bad.push('phase station but focus is not inside #main: ' + s.active);
    }
    await sleep(600); const s2 = await p.eval(SETTLED); // must stay put
    if (s2.ph !== s.ph || s2.hash !== s.hash) bad.push(`state changed after settling: ${s.ph} ${s.hash} -> ${s2.ph} ${s2.hash}`);
    notes.push(`final=${s.ph} ${s.hash} focus=${s.active}`);
    if (bad.length) { status = 'FAIL'; notes.push(...bad); }
  } catch (e) { status = 'FAIL'; notes.push('error: ' + e.message.split('\n')[0]); }
  await p?.close();
  record('I4', 'enter-esc-enter', { kind: 'enter-esc-x10', variant: mode, throttle, offset: 100 }, { status, notes });
}
async function runI4(throttle) { for (const mode of ['key', 'pointer']) await i4Cycle(throttle, mode); }

// ---------------------------------------------------------------- main
fs.mkdirSync(A.out, { recursive: true });
browser = await launchChrome({ port: +A['cdp-port'], headless: !A.headed });
try {
  pts = await calibrate(browser, A.url, { width: VW, height: VH, osdebug: A.osdebug });
  { // dashboard KPI card: a leaked click there would navigate to /records
    const p = await browser.newPage({ width: VW, height: VH });
    try {
      await p.goto(osUrl(A.url, { hash: '#/dashboard', osdebug: A.osdebug }), { settle: 300 });
      await waitPhase(p, 'station', 10000).catch(() => {}); await sleep(900);
      pts.kpi = await centerOf(p, `[...document.querySelectorAll('main button[aria-label$="查看紀錄"]')].find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0})`);
    } finally { await p.close(); }
  }
  console.log('click points', JSON.stringify(pts));
  const wanted = new Set(A.kinds.split(','));
  const kindsI1 = [...(only.has('i1') ? ['enter', 'exit'] : []), ...(only.has('i1') || only.has('switch') ? ['switch'] : [])].filter((k) => wanted.has(k));
  const all = ['enter', 'exit', 'switch'].filter((k) => wanted.has(k));
  for (const th of throttles) {
    console.log(`\n=== CPU throttle ${th}x ===`);
    if (kindsI1.length) await runI1(th, kindsI1);
    if (only.has('key')) await runKey(th, all);
    if (only.has('i2')) await runI2(th, all);
    if (only.has('i3')) await runI3(th);
    if (only.has('i4')) await runI4(th);
  }
} finally { await browser.close(); }

// ---------------------------------------------------------------- summary
console.log('\n=== Summary matrix: planned(achieved):P=pass F=FAIL D=deviated/inconclusive ===');
const groups = new Map();
for (const r of results) { const k = `${r.id} ${r.test} ${r.kind}/${r.variant}${r.trigger ? '/' + r.trigger : ''} x${r.throttle}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(r); }
for (const [k, rs] of groups) console.log(k.padEnd(52), rs.map((r) => `${r.planned}${r.achieved != null ? '(' + r.achieved + ')' : ''}:${r.status[0]}`).join(' '));
const fails = results.filter((r) => r.status === 'FAIL'), dev = results.filter((r) => r.status === 'DEVIATED');
console.log(`\n${results.length} samples: ${results.length - fails.length - dev.length} pass, ${fails.length} FAIL, ${dev.length} DEVIATED (planned offset not achieved within ${TOL}ms after ${ATTEMPTS} tries: inconclusive, NOT counted as pass)`);
fs.writeFileSync(path.join(A.out, 'result.json'), JSON.stringify({ url: A.url, args: A, points: pts, leads, summary: { total: results.length, fail: fails.length, deviated: dev.length }, results }, null, 2));
process.exit(fails.length ? 1 : dev.length && !A['allow-deviated'] ? 3 : 0);
