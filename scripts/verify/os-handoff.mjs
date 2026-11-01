// I1-I3: OS-mode ENTER/EXIT handoff behaviour (click gate, direct-hit after handoff, overlay never intercepts).
//   I1: first click inside a *-pre phase is swallowed -> phase jumps to station/hub, no navigation/sort/dialog; 2nd click works.
//       (pointer: enter offsets 0..850 step 50, exit 0..250 step 50, x {sort, hud} click points; keyboard Enter/Space variants)
//   I2: first click right after the handoff (entering-post / exiting-post) hits the destination target directly.
//   I3: canvas#os-overlay keeps pointer-events:none in every phase and is never returned by elementFromPoint (8x5 grid / ~16ms).
// node scripts/verify/os-handoff.mjs --url http://localhost:3114/ [--throttles 1,4] [--only i1,i2,i3,key] [--out dir]
// Must run against a server started with a FRESH COPY of the example data (see README.md / serve.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { sleep } from './cdp.mjs';
import { SEL, SORT_EXPR, PHASE_EXPR, q, HOOK_SRC, osUrl, launchChrome, waitPhase, waitUntilPageTime, centerOf, calibrate } from './os-common.mjs';

const { values: A } = parseArgs({
  options: {
    url: { type: 'string' }, out: { type: 'string', default: 'verify-out/os-handoff' },
    throttles: { type: 'string', default: '1,4' }, only: { type: 'string', default: 'i1,key,i2,i3' },
    viewport: { type: 'string', default: '1440x900' }, 'cdp-port': { type: 'string', default: '9601' },
    reps: { type: 'string', default: '3' }, osdebug: { type: 'string', default: '' },
    'enter-step': { type: 'string', default: '50' }, 'exit-step': { type: 'string', default: '50' },
    headed: { type: 'boolean', default: false }, verbose: { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
  },
});
if (A.help || !A.url) { console.log('node scripts/verify/os-handoff.mjs --url http://localhost:3114/ [--throttles 1,4] [--only i1,i2,i3,key] [--reps 3] [--viewport 1440x900] [--out dir] [--osdebug a,b] [--headed]'); process.exit(A.help ? 0 : 2); }
const [VW, VH] = A.viewport.split('x').map(Number);
const throttles = A.throttles.split(',').map(Number);
const only = new Set(A.only.split(','));
const ENTER_OFFSETS = []; for (let o = 0; o <= 850; o += +A['enter-step']) ENTER_OFFSETS.push(o);
const EXIT_OFFSETS = []; for (let o = 0; o <= 250; o += +A['exit-step']) EXIT_OFFSETS.push(o);
const KEY_ENTER_OFFSETS = [0, 400, 850], KEY_EXIT_OFFSETS = [0, 150, 250];
let MAX_ATTEMPTS = 3;

const END = { enter: 'station', exit: 'hub' };
const PRE = { enter: 'entering-pre', exit: 'exiting-pre' };
const POST = { enter: 'entering-post', exit: 'exiting-post' };

const results = []; // { id, test, kind, variant, throttle, offset, actual, status: PASS|FAIL|LATE, notes[] }
let browser, pts;

async function freshPage(kind, throttle) {
  const p = await browser.newPage({ width: VW, height: VH, preScripts: [HOOK_SRC] });
  if (throttle > 1) await p.throttleCPU(throttle);
  if (kind === 'enter') { await p.goto(osUrl(A.url, { osdebug: A.osdebug }), { settle: 300 }); await waitPhase(p, 'hub', 15000); await p.waitFor(q(SEL.hudCh02), 10000); }
  else { await p.goto(osUrl(A.url, { hash: '#/records', osdebug: A.osdebug }), { settle: 300 }); await waitPhase(p, 'station', 15000); await p.waitFor(q(SEL.back), 10000); }
  await sleep(700);
  return p;
}
const triggerSel = (kind) => (kind === 'enter' ? q(SEL.hudCh02) : q(SEL.back));
const targetPoint = async (p, kind, variant) => {
  // click point for the 2nd ("real") target and for the swallowed click
  if (variant === 'sort') return (await centerOf(p, SORT_EXPR)) ?? pts.sort;
  return (await centerOf(p, q(SEL.hudCh02))) ?? pts.hud;
};
async function trigger(p, kind) {
  const c = (await centerOf(p, triggerSel(kind))) ?? (kind === 'enter' ? pts.hud : pts.back);
  await p.mouseMove(c.x, c.y); await p.mouseDown(c.x, c.y); await p.mouseUp(c.x, c.y);
  const evs = await p.eval(`__ev.filter(e=>e.t==='pointerdown')`);
  return evs[0].now;
}
const lastDowns = (p) => p.eval(`__ev.filter(e=>e.t==='pointerdown')`);
const afterState = (p) => p.eval(`(()=>({phase:${PHASE_EXPR},hash:location.hash,dialogs:document.querySelectorAll('[role=dialog],[role=alertdialog]').length,
  activeIsSort:(()=>{const s=${SORT_EXPR};return !!s&&document.activeElement===s})(),active:(document.activeElement&&document.activeElement.tagName)||null}))()`);

/** Common assertion block after the swallowed gesture. */
async function assertSwallowed(p, kind, hashBefore, notes) {
  let st;
  const t0 = Date.now();
  do { st = await afterState(p); if (st.phase === END[kind]) break; await sleep(15); } while (Date.now() - t0 < 400);
  let ok = true;
  const bad = (m) => { ok = false; notes.push(m); };
  if (st.phase !== END[kind]) bad(`phase=${st.phase} (want ${END[kind]})`);
  if (st.hash !== hashBefore) bad(`hash changed ${hashBefore} -> ${st.hash}`);
  if (/sort=asc/.test(st.hash)) bad('sort=asc in hash');
  if (st.dialogs) bad(`${st.dialogs} dialog(s) opened`);
  if (st.activeIsSort) bad('underlying sort control got focus');
  // stale-timer check: after the jump to ${END} the phase must stay there (old timers must not push it back)
  await sleep(1350);
  const tl = await p.eval('__phases.map(x=>x.phase+"@"+Math.round(x.now))');
  const endIdx = tl.map((x) => x.split('@')[0]).lastIndexOf(END[kind]);
  const firstEnd = tl.map((x) => x.split('@')[0]).indexOf(END[kind], tl.map((x) => x.split('@')[0]).lastIndexOf(PRE[kind]));
  const after = tl.slice(firstEnd + 1);
  if (firstEnd >= 0 && after.length) bad('phase regressed after jump: ' + tl.slice(-5).join(' > '));
  else if (endIdx < 0 && st.phase === END[kind]) bad('no END phase in timeline');
  if (!ok) notes.push('timeline: ' + tl.slice(-6).join(' > '));
  return ok;
}

/** One pointer iteration; returns {status, actual, notes}. */
async function pointerOnce(kind, variant, offset, throttle) {
  const notes = []; let status = 'PASS', actual = null;
  const p = await freshPage(kind, throttle);
  try {
    const t0 = await trigger(p, kind);
    const tp = await targetPoint(p, kind, variant);
    await p.mouseMove(tp.x, tp.y);
    await waitUntilPageTime(p, t0 + offset);
    await p.mouseDown(tp.x, tp.y); await p.mouseUp(tp.x, tp.y);
    const downs = await lastDowns(p);
    const d2 = downs[1];
    if (!d2) return { status: 'FAIL', actual, notes: ['second pointerdown not recorded'], p };
    actual = Math.round(d2.now - t0);
    if (d2.ph !== PRE[kind]) return { status: 'LATE', actual, notes: [`pointerdown phase=${d2.ph} (wanted ${PRE[kind]})`], p };
    const ok1 = await assertSwallowed(p, kind, d2.hash, notes);
    // second click on the real target
    await sleep(150);
    if (kind === 'enter') {
      const sp = (await centerOf(p, SORT_EXPR)) ?? pts.sort;
      await p.click(sp.x, sp.y);
      const hit = await p.waitFor(`/sort=asc/.test(location.hash)`, 1500).then(() => true, () => false);
      if (!hit) notes.push('2nd click on sort control did not produce sort=asc');
      if (!ok1 || !hit) status = 'FAIL';
    } else {
      const hp = (await centerOf(p, q(SEL.hudCh02))) ?? pts.hud;
      await p.click(hp.x, hp.y);
      const hit = await p.waitFor(`${PHASE_EXPR}==='entering-pre'`, 1500, 15).then(() => true, () => false);
      if (!hit) notes.push('2nd click on HUD CH-02 did not start ENTERING');
      if (!ok1 || !hit) status = 'FAIL';
    }
  } catch (e) { status = 'FAIL'; notes.push('error: ' + e.message.split('\n')[0]); }
  return { status, actual, notes, p };
}

async function withRetry(fn, planned, attempts = MAX_ATTEMPTS) {
  let offset = planned, last;
  for (let i = 0; i < attempts; i++) {
    try { last = await fn(offset); } catch (e) { last = { status: i < 1 ? 'LATE' : 'FAIL', actual: null, notes: ['setup error: ' + String(e.message).slice(0, 120)] }; }
    await last.p?.close();
    if (last.status !== 'LATE') break;
    offset = Math.max(0, offset - Math.max(5, (last.actual ?? planned) - planned + 10));
  }
  return last;
}

function record(r) {
  results.push(r);
  const tag = r.status === 'PASS' ? 'PASS' : r.status === 'FAIL' ? 'FAIL' : 'LATE';
  console.log(`${tag} ${r.id} ${r.kind}/${r.variant} x${r.throttle} planned=${r.offset}ms actual=${r.actual ?? '?'}ms${r.notes.length ? '  ' + r.notes.join('; ') : ''}`);
}

// ------------------------------------------------------------------ I1 pointer
async function runI1(throttle) {
  for (const kind of ['enter', 'exit']) {
    const variants = kind === 'enter' ? ['sort', 'hud'] : ['hud'];
    for (const variant of variants) for (const offset of kind === 'enter' ? ENTER_OFFSETS : EXIT_OFFSETS) {
      const r = await withRetry((o) => pointerOnce(kind, variant, o, throttle), offset);
      record({ id: 'I1', test: 'pointer', kind, variant, throttle, offset, actual: r.actual, status: r.status, notes: r.notes });
    }
  }
}

// ------------------------------------------------------------------ I1 keyboard
async function keyOnce(kind, key, offset, throttle) {
  const notes = []; let status = 'PASS', actual = null;
  const p = await freshPage(kind, throttle);
  try {
    const t0 = await trigger(p, kind);
    await p.eval('document.activeElement&&document.activeElement.blur&&document.activeElement.blur()');
    await waitUntilPageTime(p, t0 + offset);
    await p.key(key);
    const kd = (await p.eval(`__ev.filter(e=>e.t==='keydown')`))[0];
    if (!kd) return { status: 'FAIL', actual, notes: ['keydown not recorded'], p };
    actual = Math.round(kd.now - t0);
    if (kd.ph !== PRE[kind]) return { status: 'LATE', actual, notes: [`keydown phase=${kd.ph}`], p };
    const ok1 = await assertSwallowed(p, kind, kd.hash, notes);
    await sleep(150);
    let hit;
    if (kind === 'enter') {
      await p.eval(`(${SORT_EXPR}).focus()`);
      await p.key(key);
      hit = await p.waitFor(`/sort=asc/.test(location.hash)`, 1500).then(() => true, () => false);
      if (!hit) notes.push(`2nd ${key} on focused sort control did not produce sort=asc`);
    } else {
      await p.eval(`(${q(SEL.hudCh02)}).focus()`);
      await p.key(key);
      hit = await p.waitFor(`${PHASE_EXPR}==='entering-pre'`, 1500, 15).then(() => true, () => false);
      if (!hit) notes.push(`2nd ${key} on focused HUD CH-02 did not start ENTERING`);
    }
    if (!ok1 || !hit) status = 'FAIL';
  } catch (e) { status = 'FAIL'; notes.push('error: ' + e.message.split('\n')[0]); }
  return { status, actual, notes, p };
}
async function runKey(throttle) {
  for (const kind of ['enter', 'exit']) for (const key of ['Enter', 'Space']) for (const offset of kind === 'enter' ? KEY_ENTER_OFFSETS : KEY_EXIT_OFFSETS) {
    const r = await withRetry((o) => keyOnce(kind, key, o, throttle), offset);
    record({ id: 'I1', test: 'keyboard', kind, variant: key, throttle, offset, actual: r.actual, status: r.status, notes: r.notes });
  }
}

// ------------------------------------------------------------------ I2
async function handoffOnce(kind, throttle) {
  const notes = []; let status = 'PASS', actual = null;
  const p = await freshPage(kind, throttle);
  try {
    await trigger(p, kind);
    let click = null, usedFallback = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 4000) {
      const r = await p.eval(`(()=>{const ph=${PHASE_EXPR}; if(ph!==${JSON.stringify(POST[kind])}) return {ph};
        const e=${kind === 'enter' ? SORT_EXPR : q(SEL.hudCh02)}; if(!e) return {ph,x:null};
        const r=e.getBoundingClientRect(); return r.width>0?{ph,x:r.x+r.width/2,y:r.y+r.height/2}:{ph,x:null}})()`);
      if (r.ph === END[kind]) return { status: 'LATE', actual, notes: ['missed the post window'], p };
      if (r.ph === POST[kind]) {
        const pt = r.x != null ? r : (usedFallback = true, kind === 'enter' ? pts.sort : pts.hud);
        await p.mouseDown(pt.x, pt.y); await p.mouseUp(pt.x, pt.y); click = pt; break;
      }
      await sleep(3);
    }
    if (!click) return { status: 'FAIL', actual, notes: ['never reached ' + POST[kind]], p };
    if (usedFallback) notes.push('target rect unavailable at click time (used calibrated point)');
    const d = (await lastDowns(p)).slice(-1)[0];
    const phases = await p.eval('__phases');
    const start = [...phases].reverse().find((x) => x.phase === POST[kind]);
    actual = start ? Math.round(d.now - start.now) : null;
    if (d.ph !== POST[kind]) return { status: 'LATE', actual, notes: [`pointerdown phase=${d.ph}`], p };
    if (kind === 'enter') {
      const hit = await p.waitFor(`/sort=asc/.test(location.hash)`, 1500).then(() => true, () => false);
      if (!hit) { status = 'FAIL'; notes.push('first click after handoff did not hit sort control (no sort=asc)'); }
    } else {
      const hit = await p.waitFor(`${PHASE_EXPR}==='entering-pre'`, 1500, 15).then(() => true, () => false);
      if (!hit) { status = 'FAIL'; notes.push('first click after handoff did not hit HUD CH-02 (ENTERING not started)'); }
    }
    if (actual != null && actual > 100) notes.push(`click came ${actual}ms after phase start (>100ms)`);
  } catch (e) { status = 'FAIL'; notes.push('error: ' + e.message.split('\n')[0]); }
  return { status, actual, notes, p };
}
async function runI2(throttle) {
  for (const kind of ['enter', 'exit']) for (let i = 0; i < +A.reps; i++) {
    const r = await withRetry(() => handoffOnce(kind, throttle), 0, 6);
    record({ id: 'I2', test: 'handoff', kind, variant: '#' + (i + 1), throttle, offset: 0, actual: r.actual, status: r.status, notes: r.notes });
  }
}

// ------------------------------------------------------------------ I3
const SAMPLER = `(()=>{ if(window.__samp) return; const S=window.__samp={n:0,viol:[],pe:{},phases:{},stop:false,overlaySeen:false};
  const W=innerWidth,H=innerHeight; const pts=[]; for(let i=0;i<8;i++)for(let j=0;j<5;j++)pts.push([(i+0.5)*W/8,(j+0.5)*H/5]);
  const tick=()=>{ if(S.stop) return; const ph=document.documentElement.dataset.osPhase||'none'; const o=document.querySelector('canvas#os-overlay');
    const pe=o?getComputedStyle(o).pointerEvents:'(absent)'; if(o) S.overlaySeen=true;
    S.n++; S.phases[ph]=(S.phases[ph]||0)+1; const m=(S.pe[ph]=S.pe[ph]||{}); m[pe]=(m[pe]||0)+1;
    if(o&&pe!=='none'&&S.viol.length<30) S.viol.push({ph,pe,t:performance.now()});
    for(const [x,y] of pts){ const el=document.elementFromPoint(x,y); if(el&&(el===o||el.id==='os-overlay')){ if(S.viol.length<30) S.viol.push({ph,hit:[Math.round(x),Math.round(y)],t:performance.now()}); break; } } };
  S.iv=setInterval(tick,16); const raf=()=>{ tick(); if(!S.stop) requestAnimationFrame(raf); }; requestAnimationFrame(raf); })()`;
async function runI3(throttle) {
  const notes = []; let status = 'PASS';
  let p;
  try {
    p = await freshPage('enter', throttle);
    await p.eval(SAMPLER);
    await trigger(p, 'enter');
    await waitPhase(p, 'station', 8000); await sleep(400);
    const bc = (await centerOf(p, q(SEL.back))) ?? pts.back;
    await p.click(bc.x, bc.y);
    await waitPhase(p, 'hub', 8000); await sleep(400);
    const S = await p.eval('(window.__samp.stop=true, JSON.parse(JSON.stringify(window.__samp)))');
    const need = ['hub', 'entering-pre', 'entering-post', 'station', 'exiting-pre', 'exiting-post'];
    const missing = need.filter((ph) => !S.phases[ph]);
    if (S.viol.length) { status = 'FAIL'; notes.push(`${S.viol.length} violation(s): ${JSON.stringify(S.viol.slice(0, 3))}`); }
    if (!S.overlaySeen) { status = 'FAIL'; notes.push('canvas#os-overlay never present in DOM'); }
    for (const ph of Object.keys(S.pe)) for (const v of Object.keys(S.pe[ph])) if (v !== 'none') { status = 'FAIL'; notes.push(`pointer-events=${v} in ${ph}`); }
    if (missing.length) notes.push('phases not sampled (informational): ' + missing.join(','));
    notes.push(`samples=${S.n} perPhase=${JSON.stringify(S.phases)}`);
  } catch (e) { status = 'FAIL'; notes.push('error: ' + e.message.split('\n')[0]); }
  await p?.close();
  record({ id: 'I3', test: 'overlay', kind: 'enter+exit', variant: '8x5@16ms', throttle, offset: 0, actual: null, status, notes });
}

// ------------------------------------------------------------------ main
fs.mkdirSync(A.out, { recursive: true });
browser = await launchChrome({ port: +A['cdp-port'], headless: !A.headed });
try {
  pts = await calibrate(browser, A.url, { width: VW, height: VH, osdebug: A.osdebug });
  console.log('click points', JSON.stringify(pts));
  for (const th of throttles) {
    console.log(`\n=== CPU throttle ${th}x ===`);
    if (only.has('i1')) await runI1(th);
    if (only.has('key')) await runKey(th);
    if (only.has('i2')) await runI2(th);
    if (only.has('i3')) await runI3(th);
  }
} finally { await browser.close(); }

// summary matrix
console.log('\n=== Summary matrix (P=pass F=fail L=late/inconclusive) ===');
const groups = new Map();
for (const r of results) { const k = `${r.id} ${r.test} ${r.kind}/${r.variant.startsWith('#') ? 'rep' : r.variant} x${r.throttle}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(r); }
for (const [k, rs] of groups) console.log(k.padEnd(44), rs.map((r) => `${r.offset}:${r.status[0]}`).join(' '));
const fails = results.filter((r) => r.status === 'FAIL'), late = results.filter((r) => r.status === 'LATE');
console.log(`\n${results.length} iterations: ${results.length - fails.length - late.length} pass, ${fails.length} fail, ${late.length} inconclusive(late)`);
fs.writeFileSync(path.join(A.out, 'result.json'), JSON.stringify({ url: A.url, args: A, points: pts, results }, null, 2));
process.exit(fails.length ? 1 : 0);
