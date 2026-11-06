// OS-mode functional/E2E checks that can be automated (spec §9.3 E2 E3 E5 E6 E7, §7 device/fallback, §3.2 mode persistence, D1/D2/D5).
// Every check is a named function reporting PASS | FAIL | SKIP | MANUAL plus evidence; JSON + screenshots (on FAIL, or --shots) go to --out.
//
//   node scripts/verify/os-e2e.mjs --url http://localhost:3114/ [--only e2,e3,e5,e6,e7,gate,persist,exit,sidebar,webgl,e1] [--list]
//        [--out dir] [--scratch dir] [--headed] [--osdebug nobloom,nosway] [--cdp-port 9701] [--cdp-port-nowebgl 9702] [--shots]
//
// State-mutating checks (E5 form save creates one record; E6 lightbox seeds a photo; E1 export) only run against a server that
// serve.mjs started (marker in --scratch). Otherwise they are SKIPped with the reason. Exit code: 1 on any FAIL, else 0
// (SKIP / MANUAL are listed in the summary and never count as pass).
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { sleep } from './cdp.mjs';
import {
  SEL, PHASE_EXPR, VISIBLE_FN, WEBGL_FALLBACK_TEXT, q, hudCh, osUrl, launchChrome, openPage, waitPhase, passB1, centerOf, Reporter,
} from './os-common.mjs';
import { checkScratchServer, exportTargetInScratch, firstRecordId, seedPhoto, DEFAULT_SCRATCH } from './safety.mjs';

const { values: A } = parseArgs({
  options: {
    url: { type: 'string' }, only: { type: 'string' }, list: { type: 'boolean', default: false },
    out: { type: 'string', default: 'verify-out/os-e2e' }, scratch: { type: 'string', default: DEFAULT_SCRATCH },
    headed: { type: 'boolean', default: false }, osdebug: { type: 'string', default: '' }, shots: { type: 'boolean', default: false },
    'cdp-port': { type: 'string', default: '9701' }, 'cdp-port-nowebgl': { type: 'string', default: '9702' },
    viewport: { type: 'string', default: '1440x900' }, help: { type: 'boolean', default: false },
  },
});
if (A.help || (!A.url && !A.list)) {
  console.log(`node scripts/verify/os-e2e.mjs --url http://localhost:3114/ [--only e2,e3,e5,e6,e7,gate,persist,exit,sidebar,webgl,e1] [--list]
  [--out dir] [--scratch dir] [--headed] [--osdebug nobloom,nosway] [--shots] [--cdp-port 9701] [--cdp-port-nowebgl 9702] [--viewport 1440x900]
  --only matches check ids by prefix (case-insensitive), e.g. --only e2 or --only E6.popover`);
  process.exit(A.help ? 0 : 2);
}
const [VW, VH] = A.viewport.split('x').map(Number);

// ---------------------------------------------------------------- tiny assertion accumulator
class Acc {
  constructor() { this.ev = []; this.bad = []; this.skipReason = null; this.manualReason = null; }
  note(m) { this.ev.push(m); }
  ok(cond, msg, detail) { if (cond) this.ev.push('ok: ' + msg); else { this.bad.push(msg + (detail !== undefined ? ' -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); } return !!cond; }
  skip(reason) { this.skipReason = reason; }
  manual(reason) { this.manualReason = reason; }
  get status() { return this.bad.length ? 'FAIL' : this.skipReason ? 'SKIP' : this.manualReason ? 'MANUAL' : 'PASS'; }
  get evidence() { return [...this.bad.map((b) => 'FAILED: ' + b), ...(this.skipReason ? ['skipped: ' + this.skipReason] : []), ...(this.manualReason ? ['manual: ' + this.manualReason] : []), ...this.ev]; }
}

// ---------------------------------------------------------------- page helpers
const ctx = { url: A.url, osdebug: A.osdebug, last: null, browser: null, scratchOk: null, rep: null, recordId: null };

/** Opens a page. hash '' => hub, any other hash => station. opts.mode 'os'|'web'|null (no ?mode param). */
async function open(hash = '', o = {}) {
  const { mode = 'os', width = VW, height = VH, throttle = 1, settle = true, extra, contextOf, preScripts, browser = ctx.browser, scheme = 'light' } = o;
  const p = await openPage(browser, osUrl(ctx.url, { hash, mode, osdebug: ctx.osdebug, extra }), { width, height, throttle, contextOf, preScripts, scheme, settle: 300 });
  ctx.last = p;
  if (settle && mode === 'os') await waitPhase(p, hash && hash !== '#/os' ? 'station' : 'hub', 15000);
  await sleep(o.after ?? 600);
  return p;
}
const phasesNow = (p) => p.eval('__phases.length');
const phasesSince = (p, i) => p.eval(`__phases.slice(${i}).map(x=>x.phase).filter((v,k,a)=>k===0||a[k-1]!==v)`);
const hashOf = (p) => p.eval('location.hash');
const phaseOf = (p) => p.eval(PHASE_EXPR);
const modeOf = (p) => p.eval(`document.documentElement.getAttribute('data-mode')`);
const isTransPhase = (x) => /-(pre|post)$/.test(x);
async function settled(p, timeout = 4000) {
  await passB1(p); // X4: first control-room show of a fresh tab stops at B1 (PRESS ANY KEY)
  await p.waitFor(`['hub','station'].includes(${PHASE_EXPR})`, timeout, 30);
  await sleep(150);
}
const live = (p) => p.eval(`(()=>{const e=document.querySelector('[data-os="live"]');return e?e.textContent.trim():null})()`);
const lsGet = (p, k) => p.eval(`(()=>{try{return localStorage.getItem(${JSON.stringify(k)})}catch(e){return 'THROWS'}})()`);
async function openPalette(p) {
  await p.key('k', { modifiers: 2 });
  await p.waitFor(q(SEL.palette), 3000);
  await p.eval(`(${q(SEL.paletteInput)}).focus()`);
}
async function runCommand(p, text) { await openPalette(p); await p.insertText(text); await sleep(150); await p.key('Enter'); }
const alertDialog = (p) => p.eval(`(()=>{const d=document.querySelector('[role=alertdialog]');return d?{text:d.textContent.trim().slice(0,120),buttons:[...d.querySelectorAll('button')].map(b=>b.textContent.trim())}:null})()`);
const anyOverlay = (p) => p.eval(`document.querySelectorAll('[role=dialog],[role=alertdialog],[data-radix-popper-content-wrapper],[role=listbox]').length`);
async function clickByText(p, scope, text) {
  const expr = `[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>(e.getAttribute('aria-label')||e.textContent).trim().startsWith(${JSON.stringify(text)})&&e.getBoundingClientRect().width>0)`;
  await p.eval(`(()=>{const e=${expr}; if(e) e.scrollIntoView({block:'center'})})()`); await sleep(250);
  const c = await centerOf(p, expr); if (!c) throw new Error(`no visible "${text}" in ${scope}`);
  await p.click(c.x, c.y);
}
async function clickSel(p, sel) {
  await p.eval(`(()=>{const e=${q(sel)}; if(e) e.scrollIntoView({block:'center'})})()`); await sleep(250);
  const c = await centerOf(p, q(sel)); if (!c) throw new Error('no visible ' + sel);
  await p.click(c.x, c.y);
}
const DIRTY = `(()=>{const V=${VISIBLE_FN}; const c=[...document.querySelectorAll('main textarea, main input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([role=combobox])')].filter(V);
  const e=document.getElementById('rf-problem')||c[0]; if(!e) return null; e.focus(); return e.id||e.tagName; })()`;
async function makeDirty(p) { const id = await p.eval(DIRTY); if (!id) throw new Error('no text field to dirty'); await p.insertText('x'); await sleep(200); return id; }
/** run `action`, then expect the phase sequence to contain `pre` (or no transition when null) and to end settled. */
async function expectTransition(p, a, label, action, pre, endPhase) {
  const i = await phasesNow(p);
  await action();
  if (pre) {
    const okSeen = await p.waitFor(`__phases.slice(${i}).some(x=>x.phase===${JSON.stringify(pre)})`, 2500, 20).then(() => true, () => false);
    await settled(p, 4000).catch(() => {});
    a.ok(okSeen, `${label}: ${pre} played`, await phasesSince(p, i));
  } else {
    await sleep(900);
    const seq = await phasesSince(p, i);
    a.ok(!seq.some(isTransPhase), `${label}: no transition`, seq);
    await settled(p, 3000).catch(() => {});
  }
  if (endPhase) a.ok((await phaseOf(p)) === endPhase, `${label}: ends in ${endPhase}`, await phaseOf(p));
}

// ---------------------------------------------------------------- check registry
const CHECKS = [];
const check = (id, name, fn, opt = {}) => CHECKS.push({ id, name, fn, ...opt });

// ================================================================ E2 unsaved changes
/** via: esc | back | history | palette */
async function unsavedCase(a, route, via) {
  const prelude = route === '#/settings' ? '#/dashboard' : '#/records';
  const p = await open(prelude);
  if (via === 'history') {
    // browser Back is only blockable/restorable when the entries were created by the router (history.state.idx): a bare
    // `location.hash=` entry has no idx, so RR cannot restore the URL on a blocked POP. Navigate in-app instead.
    await sleep(500); await runCommand(p, route === '#/settings' ? 'set' : 'new');
  } else await p.eval(`location.hash=${JSON.stringify(route)}`);
  await p.waitFor(`location.hash.startsWith(${JSON.stringify(route)})`, 3000);
  await settled(p, 5000); await sleep(500);
  const field = await makeDirty(p);
  a.note(`dirty via ${field}`);
  const i = await phasesNow(p); const h0 = await hashOf(p);
  if (via === 'esc') { await p.eval(`document.activeElement.blur(); document.getElementById('main').focus()`); await p.key('Escape'); }
  else if (via === 'back') await clickSel(p, SEL.back);
  else if (via === 'history') {
    // Chrome fires the native beforeunload prompt first for a dirty form (RecordForm/SettingsPage register it; same on baseline web mode).
    // Unhandled, Runtime.evaluate hangs. Decline it (stay) and check the in-app confirm that follows.
    p.listeners.push((m) => { if (m.method === 'Page.javascriptDialogOpening') p.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {}); });
    await p.eval('setTimeout(()=>history.back(),30);1');
  }
  else if (via === 'palette') { await p.eval('document.activeElement.blur()'); await runCommand(p, 'dash'); }
  const shown = await p.waitFor(`document.querySelector('[role=alertdialog]')`, 3000).then(() => true, () => false);
  a.ok(shown, `${via}: confirm dialog (alertdialog) appears`);
  if (!shown) return;
  const dlg = await alertDialog(p); a.note(`dialog: ${dlg.text} | buttons ${dlg.buttons.join(' / ')}`);
  a.ok((await hashOf(p)) === h0, `${via}: route unchanged while asking`, await hashOf(p));
  a.ok((await phaseOf(p)) === 'station', `${via}: phase stays station while asking`, await phaseOf(p));
  if (via === 'palette') a.ok(!(await p.eval(`!!${q(SEL.palette)}`)), 'palette closed before the dialog');
  await clickByText(p, '[role=alertdialog] button', dlg.buttons.find((b) => /繼續|留在|取消/.test(b)));
  await p.waitFor(`!document.querySelector('[role=alertdialog]')`, 3000);
  await sleep(700);
  const seq = await phasesSince(p, i);
  a.ok((await hashOf(p)) === h0, `${via}: cancel leaves the route unchanged`, await hashOf(p));
  a.ok((await phaseOf(p)) === 'station', `${via}: phase still station after cancel`, await phaseOf(p));
  a.ok(!seq.some(isTransPhase), `${via}: no transition played`, seq);
  a.ok((await modeOf(p)) === 'os', `${via}: still data-mode=os`);
  if (via === 'back') { // positive control: confirming leaves with the normal EXIT
    await clickSel(p, SEL.back);
    await p.waitFor(`document.querySelector('[role=alertdialog]')`, 3000);
    const j = await phasesNow(p);
    await clickByText(p, '[role=alertdialog] button', dlg.buttons.find((b) => /^離開/.test(b)) ?? dlg.buttons[dlg.buttons.length - 1]);
    await p.waitFor(`__phases.slice(${j}).some(x=>x.phase==='exiting-pre')`, 3000).then(() => a.note('ok: confirming leave plays EXIT'), () => a.ok(false, 'confirming leave did not start EXIT'));
    await settled(p, 4000).catch(() => {});
    a.ok((await hashOf(p)) === '#/os', 'after confirmed leave hash is #/os', await hashOf(p));
  }
}
for (const [route, key, label] of [['#/records/new', 'new', 'new-record form'], ['#/settings', 'settings', 'settings page']]) {
  for (const via of ['esc', 'back', 'history', 'palette']) {
    check(`E2.${key}.${via}`, `unsaved ${label}: ${via} asks first, cancel keeps route/phase, no transition`, async (a) => {
      await unsavedCase(a, route, via);
    });
  }
}
check('E2.edit-form', 'unsaved edit form (direct #/records/<id>/edit): ◀ HUB asks, cancel stays', async (a) => {
  const id = ctx.recordId; if (!id) return a.skip('no record id');
  const p = await open(`#/records/${id}/edit`); await sleep(600);
  await makeDirty(p);
  const i = await phasesNow(p);
  await clickSel(p, SEL.back);
  a.ok(await p.waitFor(`document.querySelector('[role=alertdialog]')`, 3000).then(() => true, () => false), 'confirm dialog appears');
  const dlg = await alertDialog(p);
  await clickByText(p, '[role=alertdialog] button', dlg.buttons.find((b) => /繼續|留在|取消/.test(b)));
  await sleep(700);
  a.ok((await hashOf(p)) === `#/records/${id}/edit`, 'route unchanged');
  a.ok(!(await phasesSince(p, i)).some(isTransPhase), 'no transition played', await phasesSince(p, i));
});

// ---- E2 (designer ruling): every mode swap is first a router navigation that useBlocker can intercept
async function dirtyAt(route) {
  const prelude = route === '#/settings' ? '#/dashboard' : '#/records';
  const p = await open(prelude);
  await p.eval(`location.hash=${JSON.stringify(route)}`);
  await p.waitFor(`location.hash.startsWith(${JSON.stringify(route)})`, 3000);
  await settled(p, 5000); await sleep(500);
  const field = await makeDirty(p);
  return { p, field };
}
const cancelLabel = (d) => d.buttons.find((b) => /繼續|留在|取消/.test(b));
const leaveLabel = (d) => d.buttons.find((b) => /^離開/.test(b)) ?? d.buttons[d.buttons.length - 1];
const formMounted = (p) => p.eval(`!!document.getElementById('main') && !!document.querySelector('main input, main textarea')`);
for (const [route, key, label] of [['#/records/new', 'new', 'new-record form'], ['#/settings', 'settings', 'settings page']]) {
  check(`E2.exit-cmd.${key}`, `dirty ${label}: palette exit asks first; cancel keeps form+mode; leave switches to web on the same path`, async (a) => {
    const { p } = await dirtyAt(route);
    const i = await phasesNow(p); const h0 = await hashOf(p);
    await p.eval('document.activeElement.blur()'); await runCommand(p, 'exit');
    const shown = await p.waitFor(`document.querySelector('[role=alertdialog]')`, 3000).then(() => true, () => false);
    a.ok(shown, 'confirm dialog appears');
    if (!shown) return;
    a.ok((await modeOf(p)) === 'os' && (await hashOf(p)) === h0 && (await phaseOf(p)) === 'station', 'still OS mode, same route, station while asking', [await modeOf(p), await hashOf(p), await phaseOf(p)]);
    a.ok(!(await p.eval(`!!${q(SEL.palette)}`)), 'palette closed before the dialog');
    const dlg = await alertDialog(p);
    await clickByText(p, '[role=alertdialog] button', cancelLabel(dlg));
    await p.waitFor(`!document.querySelector('[role=alertdialog]')`, 3000); await sleep(900);
    a.ok((await modeOf(p)) === 'os' && (await hashOf(p)) === h0 && (await phaseOf(p)) === 'station', 'cancel: OS mode, route and station unchanged', [await modeOf(p), await hashOf(p), await phaseOf(p)]);
    a.ok(!(await phasesSince(p, i)).some(isTransPhase), 'cancel: no transition played', await phasesSince(p, i));
    a.ok((await lsGet(p, 'pld.mode')) === 'os', 'cancel: pld.mode still os', await lsGet(p, 'pld.mode'));
    a.ok(await formMounted(p), 'cancel: the form is still mounted');
    await p.eval('document.activeElement.blur()'); await runCommand(p, 'exit');
    await p.waitFor(`document.querySelector('[role=alertdialog]')`, 3000);
    const dlg2 = await alertDialog(p);
    await clickByText(p, '[role=alertdialog] button', leaveLabel(dlg2));
    await p.waitFor(`document.documentElement.getAttribute('data-mode')===null`, 5000).catch(() => {});
    await sleep(700);
    a.ok((await modeOf(p)) === null, 'leave: web mode');
    a.ok((await hashOf(p)) === h0, 'leave: ends on the same path', await hashOf(p));
    a.ok((await lsGet(p, 'pld.mode')) === 'web', 'leave: pld.mode=web', await lsGet(p, 'pld.mode'));
    a.ok(!(await phasesSince(p, i)).some((x) => x === 'hub' || x === 'exiting-pre'), 'leave: no hub flash / exit animation', await phasesSince(p, i));
    a.ok(await p.eval(`document.activeElement===document.getElementById('main')`), 'leave: focus on #main');
    await p.close();
  });
  check(`E2.sidebar.${key}`, `dirty ${label} in web mode: sidebar OS button asks first; cancel keeps form+mode; leave enters OS mode`, async (a) => {
    const prelude = route === '#/settings' ? '#/dashboard' : '#/records';
    const p = await open(prelude, { mode: 'web', width: 1280, height: 800 });
    await p.eval(`location.hash=${JSON.stringify(route)}`);
    await p.waitFor(`location.hash.startsWith(${JSON.stringify(route)})`, 3000); await sleep(900);
    await makeDirty(p);
    const h0 = await hashOf(p);
    await clickSel(p, SEL.enterOs);
    const shown = await p.waitFor(`document.querySelector('[role=alertdialog]')`, 3000).then(() => true, () => false);
    a.ok(shown, 'confirm dialog appears');
    if (!shown) return;
    a.ok((await modeOf(p)) === null && (await hashOf(p)) === h0, 'still web mode on the same route while asking', [await modeOf(p), await hashOf(p)]);
    const dlg = await alertDialog(p);
    await clickByText(p, '[role=alertdialog] button', cancelLabel(dlg));
    await p.waitFor(`!document.querySelector('[role=alertdialog]')`, 3000); await sleep(700);
    a.ok((await modeOf(p)) === null && (await hashOf(p)) === h0, 'cancel: web mode, route unchanged', [await modeOf(p), await hashOf(p)]);
    a.ok((await lsGet(p, 'pld.mode')) !== 'os', 'cancel: pld.mode not os', await lsGet(p, 'pld.mode'));
    a.ok(await formMounted(p), 'cancel: the form is still mounted');
    await clickSel(p, SEL.enterOs);
    await p.waitFor(`document.querySelector('[role=alertdialog]')`, 3000);
    const dlg2 = await alertDialog(p);
    await clickByText(p, '[role=alertdialog] button', leaveLabel(dlg2));
    await waitPhase(p, 'hub', 15000); await sleep(500);
    a.ok((await modeOf(p)) === 'os' && (await hashOf(p)) === '#/os', 'leave: OS mode, hub', [await modeOf(p), await hashOf(p)]);
    a.ok((await lsGet(p, 'pld.mode')) === 'os', 'leave: pld.mode=os');
    await p.close();
  });
}
check('E2.exit-button', 'EXIT TO WEB (hub only): a dirty form is confirmed on the way to the hub; EXIT then leaves without further prompts', async (a) => {
  const { p } = await dirtyAt('#/records/new');
  await clickSel(p, SEL.back);
  await p.waitFor(`document.querySelector('[role=alertdialog]')`, 3000);
  const dlg = await alertDialog(p);
  await clickByText(p, '[role=alertdialog] button', leaveLabel(dlg));
  await waitPhase(p, 'hub', 8000); await sleep(500);
  await clickSel(p, SEL.exit); await sleep(1200);
  a.ok((await modeOf(p)) === null && (await hashOf(p)) === '#/dashboard', 'EXIT from the hub: web mode on #/dashboard', [await modeOf(p), await hashOf(p)]);
  a.ok(!(await p.eval(`!!document.querySelector('[role=alertdialog]')`)), 'no further prompt');
  await p.close();
});

// ---- device gate must not lose a dirty form; its web button is route-first (blocker-checked)
check('E2.gate-dirty', 'dirty form + window shrinks below 1024x600: form survives shrink/grow; gate 「改用網頁模式」 asks first (cancel keeps gate+form, leave -> web on the same path)', async (a) => {
  const { p } = await dirtyAt('#/records/new');
  const val = () => p.eval(`(document.getElementById('rf-problem')||{}).value`);
  const v0 = await val();
  a.ok(v0 === 'x' || (v0 ?? '').length > 0, 'form has the dirty value', v0);
  await p.setViewport(900, 700); await sleep(700);
  a.ok(await p.eval(`!!document.querySelector('[data-os="device-gate"]')`), 'gate shown');
  await p.setViewport(1440, 900); await sleep(700);
  a.ok((await val()) === v0, 'shrink then grow: the form value is still there', await val());
  a.ok((await phaseOf(p)) === 'station', 'phase station after growing', await phaseOf(p));
  await p.setViewport(900, 700); await sleep(600);
  await clickSel(p, SEL.gateWeb);
  const shown = await p.waitFor(`document.querySelector('[role=alertdialog]')`, 3000).then(() => true, () => false);
  a.ok(shown, 'gate web button: confirm dialog appears for a dirty form');
  if (!shown) return;
  const dlg = await alertDialog(p);
  await clickByText(p, '[role=alertdialog] button', cancelLabel(dlg));
  await p.waitFor(`!document.querySelector('[role=alertdialog]')`, 3000); await sleep(700);
  a.ok(await p.eval(`!!document.querySelector('[data-os="device-gate"]')`), 'cancel: gate still shown');
  a.ok((await modeOf(p)) === 'os' && (await lsGet(p, 'pld.mode')) === 'os', 'cancel: still OS mode');
  await p.setViewport(1440, 900); await sleep(700);
  a.ok((await val()) === v0, 'cancel then grow: the form value is still there');
  await p.setViewport(900, 700); await sleep(600);
  await clickSel(p, SEL.gateWeb);
  await p.waitFor(`document.querySelector('[role=alertdialog]')`, 3000);
  const dlg2 = await alertDialog(p);
  await clickByText(p, '[role=alertdialog] button', leaveLabel(dlg2));
  await p.waitFor(`document.documentElement.getAttribute('data-mode')===null`, 5000).catch(() => {});
  await sleep(500);
  a.ok((await modeOf(p)) === null && (await hashOf(p)) === '#/records/new', 'leave: web mode on the same path', [await modeOf(p), await hashOf(p)]);
  await p.close();
});

// ---- history: no duplicate entries from the intermediate hop; Back must not flip the mode
check('E2.history-enter', 'web #/dashboard -> sidebar OS button -> hub: ONE real Back (Alt+Left via CDP) returns to #/dashboard and does not leave OS mode', async (a) => {
  const p = await open('#/dashboard', { mode: 'web', width: 1280, height: 800 }); await sleep(900);
  await clickSel(p, SEL.enterOs);
  await waitPhase(p, 'hub', 15000); await sleep(500);
  a.ok((await hashOf(p)) === '#/os', 'at #/os', await hashOf(p));
  await p.key('ArrowLeft', { modifiers: 1 }); await sleep(1500);
  a.ok((await hashOf(p)) === '#/dashboard', 'Back once -> #/dashboard', await hashOf(p));
  a.ok((await modeOf(p)) === 'os', 'mode is still os (Back did not switch mode)', await modeOf(p));
  await p.close();
});
check('E2.history-exit', 'OS station #/records (reached in-app from #/dashboard) -> palette exit -> web: ONE real Back (Alt+Left) goes to #/dashboard, not #/records again', async (a) => {
  const p = await open('#/dashboard', { mode: 'os' }); await settled(p, 5000); await sleep(400);
  await runCommand(p, 'rec'); await settled(p, 5000); await sleep(500);
  a.ok((await hashOf(p)) === '#/records', 'at #/records', await hashOf(p));
  await p.eval('document.activeElement.blur()'); await runCommand(p, 'exit'); await sleep(1200);
  a.ok((await modeOf(p)) === null && (await hashOf(p)) === '#/records', 'web mode on #/records', [await modeOf(p), await hashOf(p)]);
  await p.key('ArrowLeft', { modifiers: 1 }); await sleep(1500);
  a.ok((await hashOf(p)) === '#/dashboard', 'Back once -> #/dashboard (no duplicate #/records)', await hashOf(p));
  await p.close();
});

// ================================================================ E3 history / direct URL
check('E3.history', 'Back/Forward play the §3.3 transitions (hub->ch enter, ch->hub exit, ch->ch switch, same channel none)', async (a) => {
  const p = await open('');
  await expectTransition(p, a, 'click CH-02', async () => { const c = await centerOf(p, q(SEL.hudCh02)); await p.click(c.x, c.y); }, 'entering-pre', 'station');
  a.ok((await hashOf(p)) === '#/records', 'hash #/records', await hashOf(p));
  await expectTransition(p, a, 'history.back() ch->hub', () => p.eval('history.back()'), 'exiting-pre', 'hub');
  a.ok((await hashOf(p)) === '#/os', 'hash #/os after back', await hashOf(p));
  await expectTransition(p, a, 'history.forward() hub->ch', () => p.eval('history.forward()'), 'entering-pre', 'station');
  await expectTransition(p, a, 'hash -> #/dashboard (ch->ch)', () => p.eval(`location.hash='#/dashboard'`), 'switching-pre', 'station');
  await expectTransition(p, a, 'history.back() ch->ch', () => p.eval('history.back()'), 'switching-pre', 'station');
  a.ok((await hashOf(p)) === '#/records', 'hash back at #/records', await hashOf(p));
  await expectTransition(p, a, 'history.forward() ch->ch', () => p.eval('history.forward()'), 'switching-pre', 'station');
  await expectTransition(p, a, 'hash -> #/records (back to CH-02)', () => p.eval(`location.hash='#/records'`), 'switching-pre', 'station');
  const id = ctx.recordId ?? 3;
  await expectTransition(p, a, `same channel #/records -> #/records/${id}/edit`, () => p.eval(`location.hash='#/records/${id}/edit'`), null, 'station');
  await expectTransition(p, a, `same channel -> #/records?open=${id}`, () => p.eval(`location.hash='#/records?open=${id}'`), null, 'station');
  await expectTransition(p, a, 'same channel query change', () => p.eval(`location.hash='#/records?sort=asc'`), null, 'station');
  a.ok((await modeOf(p)) === 'os', 'data-mode=os throughout');
});
check('E3.direct', 'direct #/records/<id>/edit in OS mode lands in the CH-02 station with the edit form, no transition', async (a) => {
  const id = ctx.recordId; if (!id) return a.skip('no record id from /api/records');
  const p = await open(`#/records/${id}/edit`);
  await p.waitFor(`${PHASE_EXPR}!==null`, 8000, 30); await sleep(600); // OsShell is lazy: the hook records an initial null before it mounts
  const seq = (await phasesSince(p, 0)).filter((x) => x !== null);
  a.ok(seq.length === 1 && seq[0] === 'station', 'phases since load are just [station] (no entry transition)', seq);
  a.ok((await hashOf(p)) === `#/records/${id}/edit`, 'route kept', await hashOf(p));
  a.ok(await p.eval(`!!document.getElementById('rf-problem')`), 'edit form present (#rf-problem)');
  a.ok(/編輯/.test(await p.eval(`document.title`)), 'document.title is the edit page title', await p.eval('document.title'));
  const tag = await p.eval(`(()=>{const e=document.querySelector('.os-tag,[data-os="tag"],[data-os="frame"] [data-ch]');return e?(e.textContent||e.getAttribute('data-ch')):null})()`);
  a.note(`channel tag text: ${tag ?? '(no .os-tag found; not part of the DOM contract)'}${tag && !/CH-02/.test(tag) ? '  <-- expected CH-02' : ''}`);
  if (tag) a.ok(/CH-02/.test(tag), 'station tag shows CH-02', tag);
});

// ================================================================ E5 page-initiated navigations stay in OS mode
check('E5.drill', 'dashboard chart drill-down (CH-01 -> CH-02) plays a short transition and stays in OS mode', async (a) => {
  const p = await open('#/dashboard'); await sleep(1200);
  await expectTransition(p, a, 'click 查看設備 bar', () => clickByText(p, 'main button', '查看設備'), 'switching-pre', 'station');
  a.ok(/^#\/records\?/.test(await hashOf(p)), 'landed on filtered records', await hashOf(p));
  a.ok((await modeOf(p)) === 'os', 'data-mode=os');
});
check('E5.detail', 'record detail sheet: 編輯 (same channel, no transition) and 複製為新紀錄 (switching), still OS mode', async (a) => {
  const id = ctx.recordId; if (!id) return a.skip('no record id');
  const p = await open(`#/records?open=${id}`); await sleep(900);
  await p.waitFor(`document.querySelector('[role=dialog]')`, 4000);
  await expectTransition(p, a, '編輯', () => clickByText(p, '[role=dialog] button', '編輯'), null, 'station');
  a.ok((await hashOf(p)) === `#/records/${id}/edit`, 'edit route', await hashOf(p));
  await p.eval(`location.hash='#/records?open=${id}'`); await sleep(900);
  await p.waitFor(`document.querySelector('[role=dialog]')`, 4000);
  await expectTransition(p, a, '複製為新紀錄', () => clickByText(p, '[role=dialog] button', '複製為新紀錄'), 'switching-pre', 'station');
  a.ok(/^#\/records\/new\?copy=/.test(await hashOf(p)), 'copy route', await hashOf(p));
  a.ok((await modeOf(p)) === 'os', 'data-mode=os');
  a.note('NOTE: spec §3.3 says same-channel navigation (edit) plays no transition; E5 text says "all play a short transition" - this check follows §3.3.');
});
check('E5.save-toast', 'form save redirect (CH-03 -> CH-01) and toast 「查看」 (CH-01 -> CH-02) play short transitions, stay in OS mode', async (a) => {
  if (!ctx.scratchOk) return a.skip('server is not a proven scratch server (creates one record): ' + ctx.scratchWhy);
  const id = ctx.recordId; if (!id) return a.skip('no record id');
  const p = await open(`#/records/new?copy=${id}`); await sleep(900);
  await p.waitFor(`document.querySelector('[data-testid="copy-banner"]')`, 4000).catch(() => a.note('copy banner not found (continuing)'));
  // copying clears the equipment on purpose (required): type a valid one, otherwise the form never submits
  await p.eval(`document.getElementById('rf-equipment').focus()`); await p.insertText('示範機台A'); await sleep(300);
  await expectTransition(p, a, 'submit (save redirect)', async () => { await clickSel(p, 'main button[type=submit]'); }, 'switching-pre', 'station');
  const h = await hashOf(p);
  a.ok(h === '#/dashboard', 'save redirected to #/dashboard', h);
  a.ok((await modeOf(p)) === 'os', 'data-mode=os after redirect');
  if (h !== '#/dashboard') return;
  const hasToast = await p.waitFor(`[...document.querySelectorAll('[data-sonner-toast] button')].some(b=>b.textContent.trim()==='查看')`, 4000).then(() => true, () => false);
  a.ok(hasToast, 'toast with 「查看」 appears');
  if (!hasToast) return;
  await expectTransition(p, a, 'toast 查看', () => clickByText(p, '[data-sonner-toast] button', '查看'), 'switching-pre', 'station');
  a.ok(/^#\/records\?open=\d+/.test(await hashOf(p)), 'toast navigated to #/records?open=<id>', await hashOf(p));
  a.ok((await modeOf(p)) === 'os', 'data-mode=os after toast navigation');
  a.note('a record was created in the scratch data');
});

// ================================================================ E6 one Esc closes one overlay
async function escCase(a, label, route, openFn, closedFn) {
  const p = await open(route); await sleep(900);
  await openFn(p);
  const i = await phasesNow(p); const h0 = await hashOf(p);
  await p.key('Escape'); await sleep(900);
  a.ok(await closedFn(p), `${label}: the overlay closed`);
  const seq = await phasesSince(p, i);
  a.ok((await phaseOf(p)) === 'station' && !seq.some((x) => x !== 'station'), `${label}: station kept, no exit transition after ONE Esc`, seq);
  a.ok((await modeOf(p)) === 'os', 'data-mode=os');
  return p;
}
check('E6.detail-sheet', 'Esc closes only the record detail sheet', async (a) => {
  const id = ctx.recordId; if (!id) return a.skip('no record id');
  const p = await escCase(a, 'detail sheet', `#/records?open=${id}`, (p) => p.waitFor(`document.querySelector('[role=dialog]')`, 4000), (p) => p.eval(`!document.querySelector('[role=dialog]')&&!/open=/.test(location.hash)`));
  await p.eval(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
  const j = await phasesNow(p); await p.key('Escape');
  const left = await p.waitFor(`__phases.slice(${j}).some(x=>x.phase==='exiting-pre')`, 2500).then(() => true, () => false);
  a.ok(left, 'positive control: a SECOND Esc (nothing open) leaves the station');
});
check('E6.confirm-dialog', 'Esc closes only the confirm dialog (unsaved form)', async (a) => {
  await escCase(a, 'confirm dialog', '#/records/new', async (p) => {
    await makeDirty(p); await clickSel(p, SEL.back);
    await p.waitFor(`document.querySelector('[role=alertdialog]')`, 3000);
  }, (p) => p.eval(`!document.querySelector('[role=alertdialog]')`));
});
check('E6.popover', 'Esc closes only the filter popover', async (a) => {
  await escCase(a, 'popover', '#/records', async (p) => {
    await clickByText(p, 'main button', '設備'); await p.waitFor(`document.querySelector('[data-radix-popper-content-wrapper],[role=dialog]')`, 3000);
  }, (p) => p.eval(`!document.querySelector('[data-radix-popper-content-wrapper]')&&!document.querySelector('[role=dialog]')`));
});
check('E6.combobox', 'Esc closes only the combobox list', async (a) => {
  await escCase(a, 'combobox', '#/records/new', async (p) => {
    const c = await centerOf(p, `[...document.querySelectorAll('main [role=combobox]')].find(e=>e.getBoundingClientRect().width>0)`); if (!c) throw new Error('no combobox');
    await p.click(c.x, c.y); await sleep(250);
    const expanded = () => p.eval(`!!document.querySelector('main [role=combobox][aria-expanded="true"]')`);
    if (!(await expanded())) { await p.eval(`(document.querySelector('main [role=combobox]')).focus()`); await p.key('ArrowDown'); await sleep(250); }
    if (!(await expanded())) { await p.insertText('示'); await sleep(250); }
    await p.waitFor(`document.querySelector('main [role=combobox][aria-expanded="true"]')`, 3000);
  }, (p) => p.eval(`!document.querySelector('[role=combobox][aria-expanded="true"]')`));
});
check('E6.lightbox', 'Esc closes only the lightbox (photo seeded into the scratch record)', async (a) => {
  if (!ctx.scratchOk) return a.skip('server is not a proven scratch server (needs a photo seeded): ' + ctx.scratchWhy);
  await seedPhoto(ctx.url, A.scratch, 3);
  await escCase(a, 'lightbox', '#/records?open=3', async (p) => {
    await p.waitFor(`document.querySelector('[data-photo-index="0"]')`, 5000);
    await clickSel(p, '[data-photo-index="0"]');
    await p.waitFor(`document.querySelector('[aria-label="關閉照片"]')`, 3000);
  }, (p) => p.eval(`!document.querySelector('[aria-label="關閉照片"]')`));
});
check('E6.palette', 'Esc closes only the command palette (hub and station)', async (a) => {
  for (const [route, label] of [['', 'hub'], ['#/records', 'station']]) {
    const p = await open(route); await sleep(500);
    await openPalette(p);
    const i = await phasesNow(p);
    await p.key('Escape'); await sleep(900);
    a.ok(await p.eval(`!${q(SEL.palette)}`), `${label}: palette closed`);
    const seq = await phasesSince(p, i);
    a.ok(!seq.some((x) => x !== (route ? 'station' : 'hub')), `${label}: phase unchanged after the one Esc`, seq);
    await p.close();
  }
});

// ================================================================ E7 AppShell parity
const TITLES = { '#/dashboard': '儀表板', '#/records': '紀錄列表', '#/records/new': '新增紀錄', '#/calendar': '日曆', '#/report': '列印報表', '#/trash': '回收桶', '#/settings': '設備對照設定' };
check('E7.focus', 'focus: first load does not steal focus; every page change (transition or not) moves focus to #main', async (a) => {
  const p = await open('#/records'); await sleep(700);
  a.ok(await p.eval(`document.activeElement!==document.getElementById('main')`), 'first load: focus not forced onto #main', await p.eval(`document.activeElement.tagName`));
  await runCommand(p, 'cal');
  await settled(p, 4000); await sleep(400);
  a.ok(await p.eval(`document.activeElement===document.getElementById('main')`), 'palette `cal` (switching): focus on #main after the handoff', await p.eval(`document.activeElement.tagName+'#'+document.activeElement.id`));
  await p.eval(`document.activeElement.blur()`);
  await p.eval(`location.hash='#/calendar?month=2026-01'`); await sleep(500);
  const id = ctx.recordId ?? 3;
  await p.eval(`location.hash='#/records'`); await settled(p, 4000); await sleep(300);
  await p.eval(`document.activeElement.blur()`);
  await p.eval(`location.hash='#/records/${id}/edit'`); await sleep(1000);
  a.ok(await p.eval(`document.activeElement===document.getElementById('main')`), 'same-channel navigation (no transition): focus on #main', await p.eval(`document.activeElement.tagName+'#'+document.activeElement.id`));
});
check('E7.title', 'document.title follows the route (all 7 channels + hub + edit)', async (a) => {
  const p = await open('#/dashboard'); await sleep(600);
  for (const [h, t] of Object.entries(TITLES)) {
    await p.eval(`location.hash=${JSON.stringify(h)}`); await sleep(500); await settled(p, 4000).catch(() => {});
    const got = await p.eval('document.title');
    a.ok(got === `${t}｜產線日誌`, `${h} -> "${t}｜產線日誌"`, got);
  }
  const id = ctx.recordId ?? 3;
  await p.eval(`location.hash='#/records/${id}/edit'`); await sleep(700); await settled(p, 4000).catch(() => {});
  a.ok((await p.eval('document.title')) === '編輯紀錄｜產線日誌', 'edit title', await p.eval('document.title'));
  await p.eval(`location.hash='#/os'`); await sleep(500); await settled(p, 5000);
  a.note('hub title: ' + (await p.eval('document.title')));
});
check('E7.skip-link', 'skip link 「跳到主要內容」 is reachable by Tab and moves focus to #main', async (a) => {
  const p = await open('#/records'); await sleep(800);
  await p.eval('document.activeElement&&document.activeElement.blur&&document.activeElement.blur()');
  let found = false, n = 0;
  for (; n < 10 && !found; n++) { await p.key('Tab'); found = await p.eval(`/跳到主要內容/.test(document.activeElement.textContent||'')`); }
  a.ok(found, `skip link focused after ${n} Tab(s)`);
  if (found) { await p.key('Enter'); await sleep(300); a.ok(await p.eval(`document.activeElement===document.getElementById('main')`), 'Enter on the skip link focuses #main'); }
});
check('E7.print', 'print layout: OS chrome hidden, <main> layout and PDF page count equal to standard-light web mode', async (a) => {
  const probe = async (mode, hash) => {
    const p = await open(hash, { mode: mode === 'web' ? 'web' : 'os', settle: mode !== 'web', width: 1280, height: 900 });
    if (mode === 'web') await p.eval(`try{localStorage.setItem('pld.theme','standard')}catch(e){}`);
    await sleep(900);
    await p.setMedia('light', 'print'); await sleep(400);
    const m = await p.eval(`(()=>{const V=${VISIBLE_FN}; const mn=document.getElementById('main'); const r=mn?mn.getBoundingClientRect():null;
      return { main: r?[r.x,r.y,r.width,r.height].map(Math.round):null, bg:getComputedStyle(document.body).backgroundColor, color: mn?getComputedStyle(mn).color:null,
      chrome:[...document.querySelectorAll('[data-os="frame"] [data-os-chrome],.os-frame-bar,[data-os="hud"],[data-os="statusbar"],[data-os="overlay"],canvas')].filter(V).map(e=>e.tagName+(e.getAttribute('data-os')?'['+e.getAttribute('data-os')+']':'')),
      theme: document.documentElement.getAttribute('data-theme') }})()`);
    let pages = null;
    try { const pdf = await p.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true }); pages = (Buffer.from(pdf.data, 'base64').toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length; } catch (e) { pages = 'n/a (' + e.message.slice(0, 40) + ')'; }
    const shot = crypto.createHash('sha256').update(Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')).digest('hex').slice(0, 12);
    await p.close();
    return { ...m, pages, shot };
  };
  for (const hash of ['#/records', '#/report?from=2026-01-01&to=2026-01-12']) {
    const w = await probe('web', hash), o = await probe('os', hash);
    a.note(`${hash}: web ${JSON.stringify(w)}`); a.note(`${hash}: os  ${JSON.stringify(o)}`);
    a.ok(o.chrome.length === 0, `${hash}: no visible OS chrome in print`, o.chrome);
    a.ok(JSON.stringify(w.main) === JSON.stringify(o.main) || Math.abs(w.main?.[2] - o.main?.[2]) <= 1, `${hash}: <main> print rect equals web mode`, [w.main, o.main]);
    if (typeof w.pages === 'number' && typeof o.pages === 'number') a.ok(w.pages === o.pages, `${hash}: PDF page count equal (web ${w.pages} / os ${o.pages})`);
    else a.note(`PDF page count not available: web ${w.pages} / os ${o.pages} (printToPDF needs headless)`);
    a.note(`screenshot hash web ${w.shot} / os ${o.shot} ${w.shot === o.shot ? '(identical)' : '(informational: differs)'}`);
  }
  a.manual('Final E4 judgement (screenshot hash / physical print preview) is the verifier\'s manual step; PDF page counts above are the automated proxy.');
});

// ================================================================ device gate
check('GATE', 'device gate: <1024 wide or <600 high shows the terminal message; enlarging enters; 「改用網頁模式」 persists web', async (a) => {
  const p = await open('', { width: 1280, height: 800 });
  const gate = () => p.eval(`(()=>{const V=${VISIBLE_FN}; const g=document.querySelector('[data-os="device-gate"]'); return {gate:V(g), text:g?g.textContent.trim().slice(0,80):null, hub:V(document.querySelector('[data-os="hub"]')), hudBtn:[...document.querySelectorAll('[data-os="hud-ch"]')].filter(V).length, main:V(document.getElementById('main')), canvas:[...document.querySelectorAll('canvas')].filter(V).length}})()`);
  for (const [w, h, expectGate] of [[1000, 700, true], [1280, 500, true], [1023, 768, true], [1024, 600, false], [1280, 720, false]]) {
    await p.setViewport(w, h); await sleep(900);
    const g = await gate();
    a.ok(g.gate === expectGate, `${w}x${h}: gate ${expectGate ? 'shown' : 'hidden'}`, g);
    if (expectGate) {
      a.ok(/PLD\/OS 需要桌面終端機/.test(g.text ?? ''), `${w}x${h}: message text`, g.text);
      a.ok(!g.hub && g.hudBtn === 0 && !g.main && g.canvas === 0, `${w}x${h}: no VISIBLE hub/HUD/outlet/canvas while gated (the mounted stage is hidden+inert, not unmounted)`, g);
    }
  }
  a.ok((await phaseOf(p)) === 'hub', 'after enlarging the hub is back (phase hub)', await phaseOf(p));
  await p.setViewport(900, 700); await sleep(700);
  await clickSel(p, SEL.gateWeb); await sleep(900);
  a.ok((await modeOf(p)) === null, '改用網頁模式: data-mode removed');
  a.ok((await lsGet(p, 'pld.mode')) === 'web', 'pld.mode=web persisted', await lsGet(p, 'pld.mode'));
  await p.setViewport(1440, 900); await sleep(700);
  a.ok((await modeOf(p)) === null, 'enlarging afterwards stays in web mode');
  await p.close();
  // starting gated on a station route: enlarging enters the station straight away, no transition
  const p2 = await open('#/records', { width: 900, height: 700, settle: false }); await sleep(900);
  a.ok(await p2.eval(`!!document.querySelector('[data-os="device-gate"]')`), 'cold load at 900x700 with #/records: gate shown');
  const i = await phasesNow(p2);
  await p2.setViewport(1440, 900); await waitPhase(p2, 'station', 8000); await sleep(800);
  a.ok((await hashOf(p2)) === '#/records', 'route kept', await hashOf(p2));
  a.ok(!(await phasesSince(p2, i)).some(isTransPhase), 'enlarging mounts the station directly (no transition)', await phasesSince(p2, i));
});

// ================================================================ mode persistence
check('PERSIST', 'pld.mode persistence: localStorage, reload, new tab, ?mode override + URL cleanup, X0 session key, no cross-tab sync, broken storage', async (a) => {
  const p = await open('#/records', { mode: 'os' }); await sleep(500);
  a.ok((await lsGet(p, 'pld.mode')) === 'os', '?mode=os written to localStorage pld.mode', await lsGet(p, 'pld.mode'));
  a.ok((await p.eval('location.search')) === '', '?mode removed from the URL', await p.eval('location.href'));
  a.ok((await hashOf(p)) === '#/records', 'hash kept', await hashOf(p));
  const bare = osUrl(ctx.url, { mode: null, hash: '#/records' });
  await p.send('Page.reload'); await p.waitLoad(); await sleep(1200);
  a.ok((await p.eval('location.search')) === '' && (await modeOf(p)) === 'os', 'plain reload (no query) keeps OS mode');
  const t2 = await ctx.browser.newPage({ width: VW, height: VH, contextOf: p, preScripts: [] });
  await t2.goto(bare, { settle: 800 }); await sleep(600);
  a.ok((await modeOf(t2)) === 'os', 'a new tab in the same profile opens in OS mode');
  // no cross-tab sync: switching tab 2 to web must not flip tab 1
  await t2.goto(osUrl(ctx.url, { mode: 'web', hash: '#/records' }), { settle: 800 }); await sleep(800);
  a.ok((await modeOf(t2)) === null && (await lsGet(t2, 'pld.mode')) === 'web', '?mode=web in tab 2: web shell + pld.mode=web');
  a.ok((await p.eval('location.search')) === '' && (await t2.eval('location.search')) === '', '?mode removed in tab 2');
  await sleep(600);
  a.ok((await modeOf(p)) === 'os', 'tab 1 is still in OS mode (no storage-event sync)');
  await t2.close();
  // other query parameters survive
  const p3 = await open('#/records', { mode: 'os', extra: { foo: '1' } }); await sleep(500);
  a.ok((await p3.eval('location.search')) === '?foo=1', 'other query params kept when ?mode is removed', await p3.eval('location.search'));
  // ?mode=web wins over a stored os
  await p3.goto(osUrl(ctx.url, { mode: 'web', hash: '#/records' }), { settle: 700 }); await sleep(500);
  a.ok((await modeOf(p3)) === null && (await lsGet(p3, 'pld.mode')) === 'web', '?mode=web overrides stored os and is written back');
  // X0 leftover session key is removed
  await p3.eval(`sessionStorage.setItem('pld.mode.session','os')`);
  await p3.send('Page.reload'); await p3.waitLoad(); await sleep(900);
  a.ok(await p3.eval(`sessionStorage.getItem('pld.mode.session')===null`), 'X0 sessionStorage key pld.mode.session removed on init');
  // storage that throws -> web, no crash
  const p4 = await ctx.browser.newPage({ width: VW, height: VH, preScripts: [`Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}})`] });
  await p4.goto(osUrl(ctx.url, { mode: null, hash: '#/dashboard' }), { settle: 800 }); await sleep(500);
  a.ok((await modeOf(p4)) === null && (await p4.eval(`document.querySelector('#root').children.length>0`)), 'localStorage throwing: app loads in web mode');
  await p4.close(); await p3.close(); await p.close();
});

// ================================================================ EXIT TO WEB (D5)
check('EXIT', 'EXIT TO WEB: keeps the path (hub -> /dashboard), restores theme per pld.theme, focus #main, persists web', async (a) => {
  for (const theme of ['standard', 'cyber']) {
    // from the hub, button
    let p = await open('', { mode: 'os' });
    await p.eval(`try{localStorage.setItem('pld.theme',${JSON.stringify(theme)})}catch(e){}`);
    a.ok(await p.eval(`document.documentElement.dataset.theme==='cyber'`), `[${theme}] OS mode applies cyber while active`);
    await clickSel(p, SEL.exit); await sleep(1200);
    a.ok((await modeOf(p)) === null, `[${theme}] hub EXIT TO WEB: data-mode removed`);
    a.ok((await hashOf(p)) === '#/dashboard', `[${theme}] hub EXIT goes to #/dashboard`, await hashOf(p));
    a.ok((await p.eval(`document.documentElement.dataset.theme==='cyber'`)) === (theme === 'cyber'), `[${theme}] theme restored per pld.theme`, await p.eval('document.documentElement.dataset.theme'));
    a.ok(await p.eval(`document.activeElement===document.getElementById('main')`), `[${theme}] focus on #main`, await p.eval(`document.activeElement.tagName+'#'+document.activeElement.id`));
    a.ok((await lsGet(p, 'pld.mode')) === 'web', `[${theme}] pld.mode=web persisted`);
    a.ok((await lsGet(p, 'pld.theme')) === theme, `[${theme}] pld.theme untouched`, await lsGet(p, 'pld.theme'));
    await p.close();
    // from a station, palette `exit`
    p = await open('#/records', { mode: 'os' });
    await p.eval(`try{localStorage.setItem('pld.theme',${JSON.stringify(theme)})}catch(e){}`);
    await runCommand(p, 'exit'); await sleep(1200);
    a.ok((await modeOf(p)) === null && (await hashOf(p)) === '#/records', `[${theme}] palette exit at station keeps the path`, [await modeOf(p), await hashOf(p)]);
    a.ok((await p.eval(`document.documentElement.dataset.theme==='cyber'`)) === (theme === 'cyber'), `[${theme}] theme restored after palette exit`);
    a.ok(await p.eval(`document.activeElement===document.getElementById('main')`), `[${theme}] focus on #main after palette exit`);
    await p.close();
  }
});

// ================================================================ sidebar entry button
check('SIDEBAR', 'sidebar 「OS 模式」 button only at >=1024; click enters the hub without reload, focus on the selected HUD button', async (a) => {
  const p = await open('#/dashboard', { mode: 'web', width: 1280, height: 800, settle: false }); await sleep(900);
  const info = () => p.eval(`(()=>{const V=${VISIBLE_FN}; const els=[...document.querySelectorAll('[data-os="enter-os"]')]; return {n:els.length, vis:els.some(V), text:els[0]?els[0].textContent.trim():null}})()`);
  for (const [w, h, want] of [[1280, 800, true], [1024, 700, true], [1023, 700, false], [900, 700, false], [375, 812, false]]) {
    await p.setViewport(w, h); await sleep(500);
    const i = await info();
    a.ok(want ? i.n === 1 && i.vis : i.n === 0, `${w}px: button ${want ? 'rendered+visible' : 'NOT rendered (0 elements)'}`, i);
    if (want) a.ok(/OS 模式/.test(i.text ?? ''), `${w}px: text 「OS 模式」`, i.text);
  }
  await p.setViewport(1280, 800); await sleep(500);
  await p.eval(`window.__noReload=1`);
  await clickSel(p, SEL.enterOs); await sleep(500);
  await waitPhase(p, 'hub', 15000); await sleep(600);
  a.ok(await p.eval(`window.__noReload===1`), 'no page reload');
  a.ok((await modeOf(p)) === 'os' && (await hashOf(p)) === '#/os', 'data-mode=os, hash #/os', [await modeOf(p), await hashOf(p)]);
  a.ok((await lsGet(p, 'pld.mode')) === 'os', 'pld.mode=os persisted');
  a.ok(await p.eval(`document.activeElement&&document.activeElement.matches('[data-os="hud-ch"][aria-current="true"]')`), 'focus on the selected HUD channel button', await p.eval(`document.activeElement.tagName+'['+(document.activeElement.getAttribute('data-ch')||'')+']'`));
});

// ================================================================ WebGL unsupported fallback (separate browser without WebGL)
check('WEBGL', 'WebGL unavailable: toast 「顯示卡不支援，已改用網頁模式」, pld.mode=web, cyber for this load only', async (a) => {
  const nb = await launchChrome({ port: +A['cdp-port-nowebgl'], headless: !A.headed, noWebgl: true });
  try {
    for (const [hash, label, wantHash] of [['', 'hub start', '#/dashboard'], ['#/records', 'station start', '#/records']]) {
      const p = await openPage(nb, osUrl(ctx.url, { hash, osdebug: ctx.osdebug }), { width: VW, height: VH });
      ctx.last = p;
      const r = await p.webglRenderer();
      if (r !== 'no-webgl') { a.skip(`WebGL still available in the no-WebGL browser (${r}); flags not honoured on this Chrome`); await p.close(); return; }
      const toast = await p.waitFor(`document.body.innerText.includes(${JSON.stringify(WEBGL_FALLBACK_TEXT)})`, 12000).then(() => true, () => false);
      a.ok(toast, `[${label}] fallback toast text shown`);
      await sleep(800);
      a.ok((await modeOf(p)) === null, `[${label}] web shell`);
      a.ok((await lsGet(p, 'pld.mode')) === 'web', `[${label}] pld.mode=web persisted`, await lsGet(p, 'pld.mode'));
      a.ok(await p.eval(`document.documentElement.dataset.theme==='cyber'`), `[${label}] cyber applied for this load`);
      a.ok((await lsGet(p, 'pld.theme')) !== 'cyber', `[${label}] pld.theme NOT written`, await lsGet(p, 'pld.theme'));
      a.ok((await hashOf(p)) === wantHash, `[${label}] route ${wantHash}`, await hashOf(p));
      a.ok(await p.eval(`!!document.querySelector('[data-sonner-toast],[role=status],[aria-live]')`), `[${label}] toast is in a live region / toaster`);
      await p.send('Page.reload'); await p.waitLoad(); await sleep(1200);
      a.ok((await modeOf(p)) === null && (await p.eval(`document.documentElement.dataset.theme!=='cyber'`)), `[${label}] next load: web + standard theme`);
      await p.close();
    }
  } finally { await nb.close(); }
});

// ================================================================ E1 (mostly manual) incl. the export guard
check('E1', 'E1 functional parity (record with photo, edit, delete/restore/purge, export Excel, report print, settings save)', async (a) => {
  a.manual('Create-with-photo, edit, soft delete/restore/purge, report print and settings save are driven by the verifier by hand: outcomes must equal web mode. Not automated here: photo capture/upload and print dialogs are not reliable over CDP.');
  const g = exportTargetInScratch(ctx.url, A.scratch);
  a.note(`export guard (exportTargetInScratch): ${g.ok ? 'OK' : 'NOT OK - ' + g.reason}`);
  for (const e of g.evidence ?? []) a.note('  ' + e);
  if (!g.ok) { a.note('=> do NOT click 匯出 Excel against this server; export click skipped.'); return; }
  const p = await open('#/dashboard', { mode: 'os' }); await sleep(800);
  const btn = await p.eval(`!![...document.querySelectorAll('button,a')].find(b=>/匯出 Excel/.test(b.textContent||''))`);
  if (!btn) { a.note('no 匯出 Excel control exists in the OS shell (the web sidebar is not part of the station frame): nothing to click. Verify manually via EXIT TO WEB if needed.'); return; }
  fs.rmSync(g.outPath, { force: true });
  await clickByText(p, 'button,a', '匯出 Excel'); await sleep(2500);
  a.ok(fs.existsSync(g.outPath), 'export file written inside the scratch data copy', g.outPath);
});

// ================================================================ runner
if (A.list) { for (const c of CHECKS) console.log(c.id.padEnd(24), c.name); process.exit(0); }
const sel = A.only ? A.only.toLowerCase().split(',') : null;
const chosen = CHECKS.filter((c) => !sel || sel.some((s) => c.id.toLowerCase().startsWith(s)));
if (!chosen.length) { console.error('no check matches --only', A.only); process.exit(2); }
const rep = new Reporter(A.out); ctx.rep = rep;
fs.mkdirSync(path.join(A.out, 'shots'), { recursive: true });
const sc = checkScratchServer(A.url, A.scratch);
ctx.scratchOk = sc.ok; ctx.scratchWhy = sc.reason;
ctx.recordId = await firstRecordId(A.url).catch(() => null);
console.log(`os-e2e: ${chosen.length} checks, server ${A.url}, scratch proof: ${sc.ok ? 'yes (' + sc.info.dataDir + ')' : 'NO (' + sc.reason + ')'}, record id ${ctx.recordId}`);
ctx.browser = await launchChrome({ port: +A['cdp-port'], headless: !A.headed });
try {
  for (const c of chosen) {
    const a = new Acc(); ctx.last = null;
    try { await c.fn(a); } catch (e) { a.bad.push('error: ' + e.message.split('\n')[0]); }
    const st = a.status;
    if ((st === 'FAIL' || A.shots) && ctx.last) { try { await ctx.last.screenshot(path.join(A.out, 'shots', `${c.id.replace(/[^\w.-]/g, '_')}.png`)); } catch {} }
    try { await ctx.last?.close(); } catch {}
    rep.add(c.id, c.name, st, a.evidence);
  }
} finally { await ctx.browser.close(); }
rep.write('result.json', { url: A.url, args: A, scratch: sc.ok });
console.log(`\nSUMMARY: ${rep.count('PASS')} pass, ${rep.count('FAIL')} FAIL, ${rep.count('SKIP')} skip, ${rep.count('MANUAL')} manual (manual/skip are NOT passes)`);
process.exit(rep.count('FAIL') ? 1 : 0);
