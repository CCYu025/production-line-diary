// Shared helpers for os-handoff.mjs / os-perf.mjs (DOM contract of the OS mode).
import { Browser, sleep } from './cdp.mjs';

export const SEL = {
  overlay: 'canvas#os-overlay',
  hub: '[data-os="hub"]',
  hudCh02: '[data-os="hud-ch02"]',
  back: '[data-os="back"]',
  station: '[data-os="station"]',
  live: '[data-os="live"]',
};
// Sortable control on /records (RecordList table header button, or FilterBar sort button on narrow screens).
export const SORT_EXPR = `[...document.querySelectorAll('main th[aria-sort] button, main button[aria-label*="切換排序"], main button[aria-label*="排序"]')].find(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0})`;
export const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
export const PHASE_EXPR = `document.documentElement.dataset.osPhase||null`;

/** base "http://localhost:3114/" -> "http://localhost:3114/?mode=os&osdebug=..#/records" (query BEFORE hash). */
export function osUrl(base, { hash = '', osdebug = '' } = {}) {
  const u = new URL(base);
  const params = new URLSearchParams(); params.set('mode', 'os'); if (osdebug) params.set('osdebug', osdebug);
  return `${u.origin}${u.pathname}?${params.toString()}${hash}`;
}

/** Launch Chrome. headless uses software GL fallback flags (correctness only; perf needs headless:false). */
export async function launchChrome({ port, headless = true, userDataDir } = {}) {
  const args = headless ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] : [];
  return Browser.launch({ port, headless, userDataDir, args });
}

/**
 * Injected before page scripts. Records, with performance.now() stamps, every window-capture
 * pointerdown/pointerup/click/keydown/keyup (with the OS phase at event time) and every phase change.
 * Registered first on window (capture) so it sees events even if a later capture gate swallows them.
 */
export const HOOK_SRC = `(()=>{
  if(window.__osHook) return; window.__osHook=true;
  window.__ev=[]; window.__phases=[];
  const ph=()=>document.documentElement.dataset.osPhase||null;
  for(const t of ['pointerdown','pointerup','click','keydown','keyup']){
    window.addEventListener(t,(e)=>{ const tg=e.target; window.__ev.push({t,ph:ph(),now:performance.now(),hash:location.hash,x:e.clientX,y:e.clientY,key:e.key,
      tg:(tg&&tg.tagName?tg.tagName.toLowerCase()+(tg.id?'#'+tg.id:'')+(tg.getAttribute&&tg.getAttribute('data-os')?'[data-os='+tg.getAttribute('data-os')+']':''):String(tg))}); },true);
  }
  const start=()=>{ const el=document.documentElement; window.__phases.push({phase:ph(),now:performance.now(),hash:location.hash});
    new MutationObserver(()=>{ window.__phases.push({phase:ph(),now:performance.now(),hash:location.hash}); }).observe(el,{attributes:true,attributeFilter:['data-os-phase']}); };
  if(document.documentElement) start(); else document.addEventListener('DOMContentLoaded',start);
})();`;

export const phase = (p) => p.eval(PHASE_EXPR);
export const nowIn = (p) => p.eval('performance.now()');

export async function waitPhase(p, want, timeout = 6000) {
  const list = Array.isArray(want) ? want : [want];
  await p.waitFor(`${JSON.stringify(list)}.includes(${PHASE_EXPR})`, timeout, 20);
}

/** Resolve (in page-time) until performance.now() >= target; polls with small sleeps. */
export async function waitUntilPageTime(p, target, lead = 6) {
  for (;;) {
    const n = await nowIn(p);
    if (n >= target - lead) return n;
    await sleep(Math.max(0, Math.min(40, target - n - lead - 8)));
  }
}

/** Center point of the first element matched by a JS expression (or null). */
export async function centerOf(p, expr) {
  const r = await p.rectOf(expr);
  return r && r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
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
