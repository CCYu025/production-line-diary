// C1 comparator: compare computed styles / rects / pseudo / text / AX tree of two running servers (S1, S4(b)).
// Usage: node scripts/verify/c1.mjs --base http://localhost:3115/ --new http://localhost:3114/ [flags]   (see README.md)
//
// Hardening vs X0:
//  * animations are frozen before every snapshot (--freeze all|css|js|none; default all = css zeroing + JS finish/hold) and Date is pinned (--no-freeze-time to disable);
//  * a scenario whose act/wait step fails is a FAILURE (marked ACTFAIL, exit 1), never silently compared un-acted;
//  * `dialog` / `lightbox` use real data: the scratch copy of the example data is seeded identically on BOTH servers right before them
//    (record 4 -> trash; a 1x1 photo on record 3). Seeding only happens on servers proven to be serve.mjs scratch servers (safety.mjs);
//  * S4(b) with the OS frame: --scope main --ignore-offset-y compares each element's y relative to <main>'s own y.
import { Browser, sleep } from './cdp.mjs';
import { takeSnap, diffSnaps } from './snap.mjs';
import { checkScratchServer, seedPhoto, seedTrash, DEFAULT_SCRATCH } from './safety.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: A } = parseArgs({
  options: {
    base: { type: 'string' }, new: { type: 'string' },
    theme: { type: 'string', default: 'all' },
    widths: { type: 'string', default: '375,900,1280' },
    scenarios: { type: 'string' },
    out: { type: 'string', default: 'verify-out/c1' },
    shots: { type: 'boolean', default: false },
    scope: { type: 'string' },
    'ignore-width-related': { type: 'boolean', default: false },
    'ignore-offset-y': { type: 'boolean', default: false },
    'base-query': { type: 'string', default: '' },
    'new-query': { type: 'string', default: '' },
    settle: { type: 'string', default: '800' },
    'settle-after': { type: 'string', default: '1200' },
    freeze: { type: 'string', default: 'all' },
    'no-freeze-time': { type: 'boolean', default: false },
    scratch: { type: 'string', default: DEFAULT_SCRATCH },
    'no-seed': { type: 'boolean', default: false },
    ax: { type: 'boolean' }, 'no-ax': { type: 'boolean' },
    'cdp-port': { type: 'string', default: '9501' },
    headed: { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (A.help || !A.base || !A.new) {
  console.log(`node scripts/verify/c1.mjs --base <url> --new <url> [--theme standard-light|standard-dark|cyber|cyber-light|all]
  [--widths 375,900,1280] [--scenarios a,b,...] [--out dir] [--shots] [--scope main] [--ignore-width-related] [--ignore-offset-y]
  [--base-query "?theme=cyber"] [--new-query "?mode=os"] [--settle ms] [--settle-after ms] [--ax|--no-ax]
  [--freeze all|css|js|none] [--no-freeze-time] [--scratch dir] [--no-seed] [--headed] [--cdp-port 9501] [--verbose]`);
  process.exit(A.help ? 0 : 2);
}
if (A['ignore-offset-y'] && !A.scope) { console.error('--ignore-offset-y needs --scope'); process.exit(2); }
if (!['all', 'js', 'css', 'none'].includes(A.freeze)) { console.error('--freeze must be all|css|js|none'); process.exit(2); }

const byText = (sel, t) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>(e.getAttribute('aria-label')||e.textContent).trim().startsWith(${JSON.stringify(t)}))`;
/** scroll the element into view (center), then click it with a real mouse event. X0 clicked without scrolling and silently missed off-screen buttons. */
const clickIn = async (p, expr) => { await p.eval(`(${expr}).scrollIntoView({block:'center'})`); await sleep(300); await p.clickEl(expr); };
const SEED_PHOTO_ID = 3, SEED_TRASH_ID = 4;
/**
 * seed: runs once per server (identically on both) right before the scenarios that need it. act must succeed, else ACTFAIL.
 * data-dependent scenarios (README): dialog (needs a trashed record), lightbox (needs a record with a photo).
 */
const ST = {
  dashboard: { route: '#/dashboard' }, records: { route: '#/records' }, new: { route: '#/records/new' },
  calendar: { route: '#/calendar?month=2026-01' }, trash: { route: '#/trash' }, settings: { route: '#/settings' },
  report: { route: '#/report?from=2026-01-01&to=2026-01-12', wait: `document.querySelector('#report-output')` },
  detail: { route: '#/records?open=3', wait: `document.querySelector('[role=dialog]')`, opened: `document.querySelector('[role=dialog]')` },
  'more-panel': { route: '#/dashboard', ws: [375], act: async (p) => { await clickIn(p, byText('nav[aria-label="底部導覽"] button', '更多')); await p.waitFor(`document.querySelector('[role=dialog]')`); }, opened: `document.querySelector('[role=dialog]')` },
  'form-validation': { route: '#/records/new', act: async (p) => { await clickIn(p, `document.querySelector('main button[type=submit]')`); await p.waitFor(`document.querySelector('[aria-invalid="true"],[role=alert],[data-testid="form-errors"]')`, 4000); } },
  // data-dependent -------------------------------------------------------------
  lightbox: {
    seed: (url) => seedPhoto(url, A.scratch, SEED_PHOTO_ID), route: '#/records?open=3', wait: `document.querySelector('[data-photo-index="0"]')`, opened: `document.querySelector('[aria-label="關閉照片"]')`,
    act: async (p) => { await p.eval(`document.querySelector('[data-photo-index="0"]').scrollIntoView({block:'center'})`); await sleep(400); await p.clickEl(`document.querySelector('[data-photo-index="0"]')`); await p.waitFor(`document.querySelector('[aria-label="關閉照片"]')`); },
  },
  dialog: {
    seed: (url) => seedTrash(url, A.scratch, SEED_TRASH_ID), route: '#/trash', wait: `${byText('main button', '永久刪除')}`, opened: `document.querySelector('[role=alertdialog]')`,
    act: async (p) => { await clickIn(p, byText('main button', '永久刪除')); await p.waitFor(`document.querySelector('[role=alertdialog]')`); },
  },
};

const THEMES = {
  'standard-light': { scheme: 'light', cyber: false },
  'standard-dark': { scheme: 'dark', cyber: false },
  cyber: { scheme: 'dark', cyber: true },
  'cyber-light': { scheme: 'light', cyber: true },
};
const themeNames = A.theme === 'all' ? ['standard-light', 'standard-dark', 'cyber'] : A.theme.split(',');
for (const t of themeNames) if (!THEMES[t]) { console.error('unknown theme', t); process.exit(2); }
const widths = A.widths.split(',').map(Number);
const only = (A.scenarios ? A.scenarios.split(',') : Object.keys(ST));
for (const n of only) if (!ST[n]) { console.error('unknown scenario', n, '; known:', Object.keys(ST).join(',')); process.exit(2); }
const useAx = A.ax ? true : A['no-ax'] ? false : !A.scope;
const settleMs = +A.settle, settleAfter = +A['settle-after'];

/** base URL + query (merged with theme=cyber) + route (hash). Query goes BEFORE the hash. */
function buildUrl(root, extraQuery, cyber, route) {
  const u = new URL(root);
  const q = new URLSearchParams((extraQuery || '').replace(/^\?/, ''));
  if (cyber && !q.has('theme')) q.set('theme', 'cyber');
  const qs = q.toString();
  return u.origin + u.pathname + (qs ? '?' + qs : '') + route;
}

// ---------------------------------------------------------------- determinism
const FIXED_NOW = Date.parse('2026-01-12T09:00:00+08:00');
const FREEZE_TIME_SRC = `(()=>{ const R=Date, base=${FIXED_NOW};
  function D(...a){ if(!new.target) return new R(base).toString(); return a.length? new R(...a) : new R(base); }
  D.prototype=R.prototype; D.now=()=>base; D.parse=R.parse; D.UTC=R.UTC; Object.setPrototypeOf(D,R); window.Date=D; })()`;
/** X5 §5.2: animation/transition durations and delays forced to 0 on every element (+ pseudo-elements) before comparing; infinite loops are held by FREEZE_ANIM. */
const FREEZE_CSS = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important;caret-color:transparent!important}';
/** Finish finite animations/transitions, hold infinite ones (cyber cursor blink, scanlines, ...) at t=0. */
const FREEZE_ANIM = `(()=>{ const o={finished:0,held:0,cancelled:0}; for(const a of document.getAnimations()){ try{ const t=a.effect&&a.effect.getComputedTiming(); if(t&&Number.isFinite(t.endTime)){ a.finish(); o.finished++; } else { a.pause(); a.currentTime=0; o.held++; } }catch(e){ try{a.cancel(); o.cancelled++}catch(_){} } } return o; })()`;
async function freeze(p) {
  if (A.freeze === 'none') return null;
  if (A.freeze === 'css' || A.freeze === 'all') await p.eval(`(()=>{ if(!document.getElementById('__c1freeze')){ const s=document.createElement('style'); s.id='__c1freeze'; s.textContent=${JSON.stringify(FREEZE_CSS)}; document.head.appendChild(s); } })()`);
  const r = A.freeze === 'css' ? null : await p.eval(FREEZE_ANIM);
  await p.eval('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))', true);
  return r;
}

async function ax(p) {
  const { nodes } = await p.send('Accessibility.getFullAXTree');
  const m = new Map(nodes.map((n) => [n.nodeId, n])); const lines = [];
  const walk = (id, d) => {
    const n = m.get(id); if (!n) return;
    const props = (n.properties || []).map((x) => x.name + '=' + JSON.stringify(x.value?.value)).sort().join(',');
    lines.push((`${'  '.repeat(d)}${n.ignored ? '(ign)' : ''}${n.role?.value}|${n.name?.value ?? ''}|${n.value?.value ?? ''}|${n.description?.value ?? ''}|${props}`).replace(/localhost:\d+/g, 'localhost:PORT'));
    for (const c of n.childIds || []) walk(c, d + 1);
  };
  const root = nodes.find((n) => !n.parentId); walk(root.nodeId, 0); return lines;
}

async function capture(b, side, themeName, w, name) {
  const sc = ST[name]; const th = THEMES[themeName];
  const root = side === 'base' ? A.base : A.new;
  const url = buildUrl(root, side === 'base' ? A['base-query'] : A['new-query'], th.cyber, sc.route);
  const p = await b.newPage({ width: w, height: w === 375 ? 812 : 900, scheme: th.scheme, mobile: w === 375, preScripts: A['no-freeze-time'] ? [] : [FREEZE_TIME_SRC] });
  if (!A['no-freeze-time']) await p.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Taipei' });
  await p.send('Accessibility.enable');
  await p.goto(url, { settle: 200 });
  await p.waitFor(`!document.querySelector('[aria-busy="true"],[aria-label="載入中"]') && document.querySelector('#root').children.length`, 10000).catch(() => {});
  // OS mode: let the station settle (direct load plays no transition, but the shell is lazy)
  await p.waitFor(`document.documentElement.dataset.mode!=='os'||document.documentElement.dataset.osPhase==='station'`, 12000).catch(() => {});
  let err = null;
  if (sc.wait) { try { await p.waitFor(sc.wait, 8000); } catch (e) { err = ('wait: ' + e.message).slice(0, 160); } }
  await sleep(settleMs);
  if (!err && sc.act) { try { await sc.act(p); } catch (e) { err = ('act: ' + e.message).slice(0, 160); } }
  await sleep(settleAfter);
  // X5 §5.3: the overlay must STILL be present after settling (a dialog that flashed open and closed, or never opened, is a FAILURE, never a silent pass)
  if (!err && sc.opened) { const ok = await p.eval(`!!(${sc.opened})`).catch(() => false); if (!ok) err = 'opened: overlay not present after settle (' + sc.opened.slice(0, 60) + ')'; }
  await p.eval('document.fonts.ready.then(()=>true)', true);
  const anim = await p.eval(`({n:document.getAnimations().length,names:document.getAnimations().map(a=>a.animationName||a.transitionProperty||a.constructor.name).sort()})`);
  const froze = await freeze(p);
  const snap = await takeSnap(p, { scope: A.scope });
  const axl = useAx ? await ax(p) : [];
  const errs = p.console.filter((c) => c.type === 'error' || c.type === 'exception').map((c) => c.text.slice(0, 100));
  if (A.shots) await p.screenshot(path.join(A.out, 'shots', `${side}_${themeName}_${w}_${name}.png`));
  await p.close();
  return { snap, axl, anim, froze, err, errs, url };
}

// ---------------------------------------------------------------- seeding (scratch servers only, identical on both sides)
async function seedFor(name) {
  const sc = ST[name]; if (!sc.seed || A['no-seed']) return {};
  const res = {};
  for (const side of ['base', 'new']) {
    const url = side === 'base' ? A.base : A.new;
    try { await sc.seed(url); res[side] = 'seeded'; }
    catch (e) { res[side] = 'SEED FAILED: ' + e.message; }
  }
  return res;
}

fs.mkdirSync(A.out, { recursive: true });
const b = await Browser.launch({ port: +A['cdp-port'], headless: !A.headed, userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pld-c1-')) });
const res = {}; const t0 = Date.now(); let total = 0, actFails = 0;
const plain = only.filter((n) => !ST[n].seed), seeded = only.filter((n) => ST[n].seed);
if (seeded.length && !A['no-seed']) for (const side of ['base', 'new']) {
  const chk = checkScratchServer(side === 'base' ? A.base : A.new, A.scratch);
  if (!chk.ok) console.log(`NOTE: ${side} server is not a proven scratch server (${chk.reason}); data-dependent scenarios (${seeded.join(',')}) cannot be seeded and will ACTFAIL unless the data already exists.`);
}
try {
  for (const group of [plain, seeded]) {
    if (!group.length) continue;
    const seedState = {};
    if (group === seeded) for (const n of group) seedState[n] = await seedFor(n);
    for (const themeName of themeNames) for (const w of widths) for (const name of group) {
      const sc = ST[name]; if (sc.ws && !sc.ws.includes(w)) continue;
      const key = `${themeName}_${w}_${name}`;
      const SA = await capture(b, 'base', themeName, w, name), SB = await capture(b, 'new', themeName, w, name);
      const actErr = SA.err || SB.err;
      const d = diffSnaps(SA.snap, SB.snap, { ignoreWidthRelated: A['ignore-width-related'], ignoreCustoms: !!A.scope, ignoreOffsetY: A['ignore-offset-y'] });
      const styleDiffs = d.filter((x) => x.kind !== 'custom-extra');
      const axd = [];
      if (useAx) { const n = Math.max(SA.axl.length, SB.axl.length); for (let i = 0; i < n; i++) if (SA.axl[i] !== SB.axl[i]) axd.push([i, SA.axl[i], SB.axl[i]]); }
      const animd = JSON.stringify(SA.anim) !== JSON.stringify(SB.anim) ? [SA.anim, SB.anim] : null; // informational only
      const count = styleDiffs.length + axd.length;
      total += count;
      if (actErr) actFails++;
      res[key] = { urls: [SA.url, SB.url], els: [SA.snap.els.length, SB.snap.els.length], axLines: [SA.axl.length, SB.axl.length], anim: [SA.anim.n, SB.anim.n], froze: [SA.froze, SB.froze], actErr: [SA.err, SB.err], seed: seedState[name] ?? null, consoleErrs: [SA.errs, SB.errs], styleDiffs, customExtra: d.filter((x) => x.kind === 'custom-extra'), axDiffs: axd, animDiff: animd, fxB: SB.snap.fx, themeB: SB.snap.theme, count, actFail: !!actErr };
      const byKind = {}; for (const x of styleDiffs) byKind[x.kind] = (byKind[x.kind] || 0) + 1;
      const tag = actErr ? 'ACTFAIL' : count === 0 ? 'OK     ' : 'DIFF   ';
      console.log(`${tag} ${key} els ${res[key].els.join('/')} ax ${useAx ? res[key].axLines.join('/') : '-'} anim ${res[key].anim.join('/')} diffs ${count} ${JSON.stringify(byKind)} axDiff ${axd.length}${actErr ? `  [${SA.err ? 'base: ' + SA.err : ''}${SA.err && SB.err ? ' | ' : ''}${SB.err ? 'new: ' + SB.err : ''}]` : ''} ${((Date.now() - t0) / 1000) | 0}s`);
      if (actErr && seedState[name]) console.log('        seed:', JSON.stringify(seedState[name]));
      if (A.verbose && count) for (const x of styleDiffs.slice(0, 5)) console.log('   ', JSON.stringify(x).slice(0, 300));
      fs.writeFileSync(path.join(A.out, 'c1-result.json'), JSON.stringify({ args: A, total, actFails, res }, null, 1));
    }
  }
} finally { await b.close(); }
console.log(`TOTAL diffs: ${total}${actFails ? `   ACTFAIL scenarios: ${actFails} (scenario could not be driven: counted as failure)` : ''}`);
process.exit(total > 0 || actFails > 0 ? 1 : 0);
