// C1 comparator: compare computed styles / rects / pseudo / text / AX tree of two running servers.
// Usage: node scripts/verify/c1.mjs --base http://localhost:3115/ --new http://localhost:3114/ [flags]
// See README.md for flags.
import { Browser, sleep } from './cdp.mjs';
import { takeSnap, diffSnaps } from './snap.mjs';
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
    'base-query': { type: 'string', default: '' },
    'new-query': { type: 'string', default: '' },
    settle: { type: 'string', default: '800' },
    'settle-after': { type: 'string', default: '1200' },
    ax: { type: 'boolean' }, 'no-ax': { type: 'boolean' },
    'cdp-port': { type: 'string', default: '9501' },
    headed: { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (A.help || !A.base || !A.new) {
  console.log(`node scripts/verify/c1.mjs --base <url> --new <url> [--theme standard-light|standard-dark|cyber|cyber-light|all]
  [--widths 375,900,1280] [--scenarios a,b,...] [--out dir] [--shots] [--scope main] [--ignore-width-related]
  [--base-query "?theme=cyber"] [--new-query "?mode=os"] [--settle ms] [--settle-after ms] [--ax|--no-ax] [--cdp-port 9501]`);
  process.exit(A.help ? 0 : 2);
}

const byText = (sel, t) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>(e.getAttribute('aria-label')||e.textContent).trim().startsWith(${JSON.stringify(t)}))`;
const ST = {
  dashboard: { route: '#/dashboard' }, records: { route: '#/records' }, new: { route: '#/records/new' },
  calendar: { route: '#/calendar?month=2026-01' }, trash: { route: '#/trash' }, settings: { route: '#/settings' },
  report: { route: '#/report?from=2026-01-01&to=2026-01-12', wait: `document.querySelector('#report-output')` },
  detail: { route: '#/records?open=3' },
  lightbox: { route: '#/records?open=3', act: async (p) => { await p.eval(`document.querySelector('[data-photo-index="0"]').scrollIntoView({block:'center'})`); await sleep(400); await p.clickEl(`document.querySelector('[data-photo-index="0"]')`); await p.waitFor(`document.querySelector('[aria-label="關閉照片"]')`); } },
  dialog: { route: '#/trash', act: async (p) => { await p.clickEl(byText('main button', '永久刪除')); await p.waitFor(`document.querySelector('[role=alertdialog]')`); } },
  'more-panel': { route: '#/dashboard', ws: [375], act: async (p) => { await p.clickEl(byText('nav[aria-label="底部導覽"] button', '更多')); await p.waitFor(`document.querySelector('[role=dialog]')`); } },
  'form-validation': { route: '#/records/new', act: async (p) => { await p.clickEl(`document.querySelector('main button[type=submit]')`); } },
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
const only = A.scenarios ? A.scenarios.split(',') : Object.keys(ST);
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
  const p = await b.newPage({ width: w, height: w === 375 ? 812 : 900, scheme: th.scheme, mobile: w === 375 });
  await p.send('Accessibility.enable');
  await p.goto(url, { settle: 200 });
  await p.waitFor(`!document.querySelector('[aria-busy="true"],[aria-label="載入中"]') && document.querySelector('#root').children.length`, 10000).catch(() => {});
  if (sc.wait) await p.waitFor(sc.wait, 8000).catch(() => {});
  await sleep(settleMs);
  let err; try { if (sc.act) await sc.act(p); } catch (e) { err = e.message.slice(0, 120); }
  await sleep(settleAfter);
  await p.eval('document.fonts.ready.then(()=>true)', true);
  const snap = await takeSnap(p, { scope: A.scope });
  const axl = useAx ? await ax(p) : [];
  const anim = await p.eval(`({n:document.getAnimations().length,names:document.getAnimations().map(a=>a.animationName||a.transitionProperty||a.constructor.name).sort()})`);
  const errs = p.console.filter((c) => c.type === 'error' || c.type === 'exception').map((c) => c.text.slice(0, 100));
  if (A.shots) await p.screenshot(path.join(A.out, 'shots', `${side}_${themeName}_${w}_${name}.png`));
  await p.close();
  return { snap, axl, anim, err, errs, url };
}

fs.mkdirSync(A.out, { recursive: true });
const b = await Browser.launch({ port: +A['cdp-port'], headless: !A.headed, userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pld-c1-')) });
const res = {}; const t0 = Date.now(); let total = 0;
try {
  for (const themeName of themeNames) for (const w of widths) for (const name of only) {
    const sc = ST[name]; if (sc.ws && !sc.ws.includes(w)) continue;
    const key = `${themeName}_${w}_${name}`;
    const SA = await capture(b, 'base', themeName, w, name), SB = await capture(b, 'new', themeName, w, name);
    const d = diffSnaps(SA.snap, SB.snap, { ignoreWidthRelated: A['ignore-width-related'], ignoreCustoms: !!A.scope });
    const styleDiffs = d.filter((x) => x.kind !== 'custom-extra');
    const axd = [];
    if (useAx) { const n = Math.max(SA.axl.length, SB.axl.length); for (let i = 0; i < n; i++) if (SA.axl[i] !== SB.axl[i]) axd.push([i, SA.axl[i], SB.axl[i]]); }
    const animd = JSON.stringify(SA.anim) !== JSON.stringify(SB.anim) ? [SA.anim, SB.anim] : null; // informational only
    const count = styleDiffs.length + axd.length;
    total += count;
    res[key] = { urls: [SA.url, SB.url], els: [SA.snap.els.length, SB.snap.els.length], axLines: [SA.axl.length, SB.axl.length], anim: [SA.anim.n, SB.anim.n], actErr: [SA.err, SB.err], consoleErrs: [SA.errs, SB.errs], styleDiffs, customExtra: d.filter((x) => x.kind === 'custom-extra'), axDiffs: axd, animDiff: animd, fxB: SB.snap.fx, themeB: SB.snap.theme, count };
    const byKind = {}; for (const x of styleDiffs) byKind[x.kind] = (byKind[x.kind] || 0) + 1;
    console.log(`${count === 0 ? 'OK  ' : 'DIFF'} ${key} els ${res[key].els.join('/')} ax ${useAx ? res[key].axLines.join('/') : '-'} anim ${res[key].anim.join('/')} diffs ${count} ${JSON.stringify(byKind)} axDiff ${axd.length}${SA.err || SB.err ? ' actErr:' + (SA.err || SB.err) : ''} ${((Date.now() - t0) / 1000) | 0}s`);
    if (A.verbose && count) for (const x of styleDiffs.slice(0, 5)) console.log('   ', JSON.stringify(x).slice(0, 300));
    fs.writeFileSync(path.join(A.out, 'c1-result.json'), JSON.stringify({ args: A, total, res }, null, 1));
  }
} finally { await b.close(); }
console.log(`TOTAL diffs: ${total}`);
process.exit(total > 0 ? 1 : 0);
