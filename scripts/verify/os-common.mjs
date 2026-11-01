// Shared helpers for the OS-mode scripts (os-handoff / os-perf / os-e2e / os-shots): DOM contract of PLD/OS, event hook, timing.
import fs from 'node:fs';
import { Browser, sleep } from './cdp.mjs';

export const chId = (n) => `CH-0${n}`;
export const hudCh = (n) => `[data-os="hud-ch"][data-ch="${typeof n === 'number' ? chId(n) : n}"]`;

export const SEL = {
  overlay: 'canvas#os-overlay',
  hub: '[data-os="hub"]',
  hud: '[data-os="hud"]',
  hudAny: '[data-os="hud-ch"]',
  hudSelected: '[data-os="hud-ch"][aria-current="true"]',
  hudCh02: hudCh(2), // backward-compat key; X0 value was [data-os="hud-ch02"]
  statusbar: '[data-os="statusbar"]',
  clock: '[data-os="clock"]',
  exit: '[data-os="exit"]',
  palette: '[data-os="palette"]',
  paletteInput: '[data-os="palette-input"]',
  paletteList: '[data-os="palette-list"]',
  paletteError: '[data-os="palette-error"]',
  back: '[data-os="back"]',
  station: '[data-os="station"]',
  live: '[data-os="live"]',
  gate: '[data-os="device-gate"]',
  gateWeb: '[data-os="device-gate-web"]',
  enterOs: '[data-os="enter-os"]',
};
export const WEBGL_FALLBACK_TEXT = '顯示卡不支援，已改用網頁模式';
export const PHASES = ['hub', 'entering-pre', 'entering-post', 'station', 'exiting-pre', 'exiting-post', 'switching-pre', 'switching-post'];

// Sortable control on /records (RecordList table header button, or FilterBar sort button on narrow screens).
export const SORT_EXPR = `[...document.querySelectorAll('main th[aria-sort] button, main button[aria-label*="切換排序"], main button[aria-label*="排序"]')].find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0})`;
export const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
export const PHASE_EXPR = `(document.documentElement.dataset.osPhase||null)`;
/** in-page function source: visible = laid out, not display:none / visibility:hidden. */
export const VISIBLE_FN = `(e)=>{if(!e)return false;const r=e.getBoundingClientRect();if(!(r.width>0&&r.height>0))return false;const c=getComputedStyle(e);return c.visibility!=='hidden'&&c.display!=='none'}`;

/** base "http://localhost:3114/" -> "http://localhost:3114/?mode=os&osdebug=..#/records" (query BEFORE hash). mode:null omits ?mode. */
export function osUrl(base, { hash = '', osdebug = '', mode = 'os', extra = {} } = {}) {
  const u = new URL(base);
  const params = new URLSearchParams();
  if (mode) params.set('mode', mode);
  if (osdebug) params.set('osdebug', osdebug);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const qs = params.toString();
  return `${u.origin}${u.pathname}${qs ? '?' + qs : ''}${hash}`;
}

/**
 * Launch Chrome. headless uses software GL (SwiftShader) flags: correctness only, perf needs headless:false.
 * noWebgl:true launches a browser on which WebGL cannot be created (fallback tests).
 */
export async function launchChrome({ port, headless = true, userDataDir, noWebgl = false, args = [] } = {}) {
  let a = [];
  if (noWebgl) a = ['--disable-webgl', '--disable-3d-apis', '--disable-gpu', '--disable-software-rasterizer'];
  else if (headless) a = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
  return Browser.launch({ port, headless, userDataDir, args: [...a, ...args] });
}

/**
 * Injected before page scripts. Records, with performance.now() stamps, window-capture pointer/key events (with the OS phase and
 * a description of the event target at event time) and every phase change. Registered first on window (capture) so it sees events
 * even if a later capture gate swallows them.
 *
 *   __ev[]        {t, ph, now, hash, x, y, key, ctrl, tg, ctl}    ctl = label of the closest button/link/combobox (what was hit)
 *   __phases[]    {phase, now, hash}                              first entry = phase at install time
 *   __waitPhase(wantList, since, timeoutMs) -> Promise<{i, e}>    first phases[i>=since] whose phase is in wantList
 *   __sleepUntil(t)  -> Promise<now>                              resolves when performance.now() >= t (busy-waits the last 6ms)
 *   __at(wantList, since, offset, lead, timeoutMs) -> Promise<{i, e, target, now}>
 *        waits for the phase stamp, then until stamp.now + offset - lead. Node sends the NEXT CDP input command right after the
 *        promise resolves, so the input lands ~offset after the stamp; `lead` compensates the CDP round trip (adaptive in os-handoff).
 */
export const HOOK_SRC = `(()=>{
  if(window.__osHook) return; window.__osHook=true;
  window.__ev=[]; window.__phases=[]; const W=[];
  const ph=()=>document.documentElement.dataset.osPhase||null;
  const desc=(tg)=>tg&&tg.tagName?tg.tagName.toLowerCase()+(tg.id?'#'+tg.id:'')+(tg.getAttribute&&tg.getAttribute('data-os')?'[data-os='+tg.getAttribute('data-os')+']':''):String(tg);
  const ctlOf=(tg)=>{ try{ const c=tg&&tg.closest&&tg.closest('button,a,[role=button],[role=combobox],input,textarea,select'); if(!c) return null; return (c.getAttribute('aria-label')||c.textContent||'').trim().slice(0,40)+'|'+(c.getAttribute('data-os')||'')+'|'+(c.getAttribute('data-ch')||''); }catch(e){ return null; } };
  for(const t of ['pointerdown','pointerup','click','keydown','keyup']){
    window.addEventListener(t,(e)=>{ const tg=e.target; window.__ev.push({t,ph:ph(),now:performance.now(),hash:location.hash,x:e.clientX,y:e.clientY,key:e.key,ctrl:!!e.ctrlKey,tg:desc(tg),ctl:ctlOf(tg),trusted:e.isTrusted}); },true);
  }
  const push=()=>{ const e={phase:ph(),now:performance.now(),hash:location.hash}; window.__phases.push(e); for(const w of W.slice()) w(); };
  const start=()=>{ push(); new MutationObserver(push).observe(document.documentElement,{attributes:true,attributeFilter:['data-os-phase']}); };
  if(document.documentElement) start(); else document.addEventListener('DOMContentLoaded',start);
  const find=(want,since)=>{ for(let i=since;i<window.__phases.length;i++) if(want.includes(window.__phases[i].phase)) return {i,e:window.__phases[i]}; return null; };
  window.__waitPhase=(want,since=0,timeout=6000)=>new Promise((res,rej)=>{
    const hit=find(want,since); if(hit) return res(hit);
    let tm; const w=()=>{ const h=find(want,since); if(h){ clear(); res(h); } };
    const clear=()=>{ clearTimeout(tm); const k=W.indexOf(w); if(k>=0) W.splice(k,1); };
    tm=setTimeout(()=>{ clear(); rej(new Error('timeout waiting for phase '+want.join('|')+' (have '+window.__phases.slice(since).map(x=>x.phase).join('>')+')')); },timeout); W.push(w); });
  window.__sleepUntil=(t)=>new Promise(res=>{ const f=()=>{ const r=t-performance.now(); if(r<=6){ while(performance.now()<t){} res(performance.now()); } else setTimeout(f,Math.max(0,r-8)); }; f(); });
  window.__at=async(want,since,offset,lead,timeout)=>{ const h=await window.__waitPhase(want,since,timeout); const target=h.e.now+offset-lead; const now=await window.__sleepUntil(target); return {i:h.i,e:h.e,target,now}; };
})();`;

export const phase = (p) => p.eval(PHASE_EXPR);
export const nowIn = (p) => p.eval('performance.now()');

export async function waitPhase(p, want, timeout = 6000) {
  const list = Array.isArray(want) ? want : [want];
  await p.waitFor(`${JSON.stringify(list)}.includes(${PHASE_EXPR})`, timeout, 20);
}

/** Center point of the first element matched by a JS expression (or null). */
export async function centerOf(p, expr) {
  const r = await p.rectOf(expr);
  return r && r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
}

/** New page with the event hook, optional CPU throttle, loaded at `url`. */
export async function openPage(browser, url, { width = 1440, height = 900, throttle = 1, hook = true, settle = 300, scheme = 'light', contextOf = null, preScripts = [] } = {}) {
  const p = await browser.newPage({ width, height, scheme, contextOf, preScripts: [...(hook ? [HOOK_SRC] : []), ...preScripts] });
  if (throttle > 1) await p.throttleCPU(throttle);
  await p.goto(url, { settle });
  return p;
}

/**
 * Calibrate click points at a fixed viewport: sort control (station), HUD CH-02 button (hub), back button (station).
 * Falls back to plausible defaults when an element cannot be measured.
 */
export async function calibrate(browser, base, { width, height, osdebug = '' }) {
  const pts = {};
  let p = await browser.newPage({ width, height });
  try {
    await p.goto(osUrl(base, { hash: '#/records', osdebug }), { settle: 300 });
    await waitPhase(p, 'station', 10000).catch(() => {});
    await sleep(500);
    pts.sort = await centerOf(p, SORT_EXPR);
    pts.back = await centerOf(p, q(SEL.back));
  } finally { await p.close(); }
  p = await browser.newPage({ width, height });
  try {
    await p.goto(osUrl(base, { osdebug }), { settle: 300 });
    await waitPhase(p, 'hub', 10000).catch(() => {});
    await sleep(500);
    pts.hud = await centerOf(p, q(SEL.hudCh02));
  } finally { await p.close(); }
  pts.sort ??= { x: width * 0.5, y: height * 0.35 };
  pts.hud ??= { x: width * 0.5, y: height * 0.5 };
  pts.back ??= { x: 80, y: 40 };
  return pts;
}

export const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
export const percentile = (a, pc) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round((pc / 100) * (s.length - 1))))] : NaN; };

/** Tiny reporter used by os-e2e / os-shots: named checks with PASS | FAIL | SKIP | MANUAL and evidence. */
export class Reporter {
  constructor(out) { this.out = out; this.rows = []; fs.mkdirSync(out, { recursive: true }); }
  add(id, name, status, evidence = [], extra = {}) {
    const ev = (Array.isArray(evidence) ? evidence : [evidence]).filter((x) => x !== undefined && x !== null && x !== '');
    this.rows.push({ id, name, status, evidence: ev, ...extra });
    console.log(`${status.padEnd(6)} ${id} ${name}${ev.length ? '\n         ' + ev.join('\n         ') : ''}`);
  }
  count(s) { return this.rows.filter((r) => r.status === s).length; }
  write(file, extra = {}) { fs.writeFileSync(`${this.out}/${file}`, JSON.stringify({ ...extra, summary: { pass: this.count('PASS'), fail: this.count('FAIL'), skip: this.count('SKIP'), manual: this.count('MANUAL') }, rows: this.rows }, null, 2)); }
}
