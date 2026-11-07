// P6 (spec §9.4, X5 §5.4): after N (default 20) enter/exit cycles the JS heap grows <= 10% and WebGL resources are released.
//
// Method (fixed in X5, "same script, side by side"):
//   * the branch (--url) and main/baseline (--base) are measured by THIS script, in the same Chrome launch, one fresh browser context each,
//     sides interleaved (--rounds R; the order alternates every round so drift does not favour one side);
//   * EVERY heap read is preceded by a forced GC through CDP `HeapProfiler.collectGarbage` (three passes with short pauses), then
//     `Runtime.getHeapUsage().usedSize` - never a raw performance.memory number;
//   * baseline of a side = post-GC heap at the hub after --warmup (default 1) enter/exit cycles (lazy OS chunks and first-use caches are
//     loaded once and are not "growth"); `growthCold` (vs. the very first hub, no warm-up) is reported as information;
//   * WebGL resources are read from `window.__osGl()` (page loaded with `?osdebug=gldebug`): geometries, textures, renderTargets at the
//     hub before and after the cycles must return to the baseline (end <= baseline for each, i.e. no leak);
//   * PASS (branch) = post-GC growth <= --max-growth (10) percent  OR  growth <= growth(main) + --max-over-main (1) percentage point
//     (median over rounds), AND the WebGL counts returned to baseline. Without --base only the absolute rule applies (stated in the output).
//   * every run records the WebGL renderer name; a software renderer (SwiftShader/llvmpipe/software) or headless makes the result INVALID
//     (exit 2) unless --allow-software is given (then it is informational only).
//
// node scripts/verify/os-p6.mjs --url http://localhost:3114/ [--base http://localhost:3115/] [--cycles 20] [--warmup 1] [--rounds 1]
//        [--max-growth 10] [--max-over-main 1] [--settle 400] [--headless] [--allow-software] [--out verify-out/os-p6] [--cdp-port 9631]
// exit: 0 pass, 1 fail, 2 invalid environment / measurement impossible.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { sleep } from './cdp.mjs';
import { SEL, q, osUrl, launchChrome, waitPhase, centerOf, median } from './os-common.mjs';

const { values: A } = parseArgs({
  options: {
    url: { type: 'string' }, base: { type: 'string' }, cycles: { type: 'string', default: '20' }, warmup: { type: 'string', default: '1' },
    rounds: { type: 'string', default: '1' }, 'max-growth': { type: 'string', default: '10' }, 'max-over-main': { type: 'string', default: '1' },
    settle: { type: 'string', default: '400' }, headless: { type: 'boolean', default: false }, 'allow-software': { type: 'boolean', default: false },
    out: { type: 'string', default: 'verify-out/os-p6' }, 'cdp-port': { type: 'string', default: '9631' }, help: { type: 'boolean', default: false },
  },
});
if (A.help || !A.url) {
  console.log('node scripts/verify/os-p6.mjs --url http://localhost:3114/ [--base http://localhost:3115/] [--cycles 20] [--warmup 1] [--rounds 1] [--max-growth 10] [--max-over-main 1] [--settle 400] [--headless] [--allow-software] [--out dir] [--cdp-port 9631]');
  process.exit(A.help ? 0 : 2);
}
const CYCLES = +A.cycles, WARMUP = +A.warmup, ROUNDS = +A.rounds, SETTLE = +A.settle;
const MAX_GROWTH = +A['max-growth'], MAX_OVER_MAIN = +A['max-over-main'];
const GL_KEYS = ['geometries', 'textures', 'renderTargets'];
fs.mkdirSync(A.out, { recursive: true });

/** Forced GC through CDP, then the used JS heap in bytes. */
async function heapAfterGc(p) {
  await p.send('HeapProfiler.enable').catch(() => {});
  for (let i = 0; i < 3; i++) { await p.send('HeapProfiler.collectGarbage'); await sleep(150); }
  const h = await p.send('Runtime.getHeapUsage');
  return h.usedSize;
}
const glCounts = (p) => p.eval(`(()=>{ const f=window.__osGl; if(typeof f!=='function') return null; const s=f(); return {geometries:s.geometries,textures:s.textures,renderTargets:s.renderTargets,programs:s.programs}; })()`);

async function cycle(p) {
  const c = (await centerOf(p, q(SEL.hudSelected))) ?? (await centerOf(p, q(SEL.hudAny)));
  if (!c) throw new Error('no HUD channel button at the hub');
  await p.click(c.x, c.y);
  await waitPhase(p, 'station', 15000);
  await sleep(SETTLE);
  const b = await centerOf(p, q(SEL.back));
  if (!b) throw new Error('no back button at the station');
  await p.click(b.x, b.y);
  await waitPhase(p, 'hub', 15000);
  await sleep(SETTLE);
}

async function measureSide(browser, label, url) {
  const p = await browser.newPage({ width: 1920, height: 1080 });
  const out = { label, url };
  try {
    await p.goto(osUrl(url, { osdebug: 'gldebug' }), { settle: 500 });
    out.renderer = await p.webglRenderer();
    await waitPhase(p, 'hub', 20000);
    await sleep(1500);
    out.heapCold = await heapAfterGc(p);
    for (let i = 0; i < WARMUP; i++) await cycle(p);
    out.heapBase = await heapAfterGc(p);
    out.glBase = await glCounts(p);
    for (let i = 0; i < CYCLES; i++) await cycle(p);
    await sleep(800);
    out.heapEnd = await heapAfterGc(p);
    out.glEnd = await glCounts(p);
    out.growth = ((out.heapEnd - out.heapBase) / out.heapBase) * 100;
    out.growthCold = ((out.heapEnd - out.heapCold) / out.heapCold) * 100;
    out.consoleErrors = p.console.filter((c) => c.type === 'error' || c.type === 'exception').map((c) => c.text.slice(0, 120));
  } catch (e) { out.error = e.message.split('\n')[0]; }
  await p.close();
  return out;
}

const browser = await launchChrome({ port: +A['cdp-port'], headless: A.headless });
const sides = [['branch', A.url], ...(A.base ? [['main', A.base]] : [])];
const runs = { branch: [], main: [] };
let invalid = null;
try {
  for (let r = 0; r < ROUNDS; r++) {
    const order = r % 2 === 0 ? sides : [...sides].reverse();
    for (const [label, url] of order) {
      console.log(`round ${r + 1}/${ROUNDS}: ${label} ${url} (${WARMUP} warm-up + ${CYCLES} cycles) ...`);
      const res = await measureSide(browser, label, url);
      runs[label].push(res);
      if (res.error) console.log(`  ERROR ${res.error}`);
      else console.log(`  renderer=${res.renderer}  heap cold ${(res.heapCold / 1048576).toFixed(2)} MB, base ${(res.heapBase / 1048576).toFixed(2)} MB, end ${(res.heapEnd / 1048576).toFixed(2)} MB  growth ${res.growth.toFixed(2)}% (vs cold ${res.growthCold.toFixed(2)}%)  gl ${JSON.stringify(res.glBase)} -> ${JSON.stringify(res.glEnd)}`);
    }
  }
} finally { await browser.close(); }

const all = [...runs.branch, ...runs.main];
const renderers = [...new Set(all.map((r) => r.renderer).filter(Boolean))];
if (A.headless || renderers.some((r) => /swiftshader|llvmpipe|software|no-webgl/i.test(String(r)))) {
  invalid = `renderer is software / headless (${renderers.join(', ')}); spec 9.4 voids P6 results measured this way`;
  console.log(`P6 ${A['allow-software'] ? 'INFORMATIONAL (--allow-software)' : 'INVALID'}: ${invalid}`);
}

const med = (label) => { const ok = runs[label].filter((r) => !r.error); return ok.length ? median(ok.map((r) => r.growth)) : null; };
const gB = med('branch'), gM = A.base ? med('main') : null;
const verdict = { branchGrowthPct: gB, mainGrowthPct: gM, rule: `growth <= ${MAX_GROWTH}% OR growth <= main + ${MAX_OVER_MAIN} pp` };
const reasons = [];
if (gB === null) reasons.push('branch could not be measured');
else {
  const absOk = gB <= MAX_GROWTH, relOk = gM !== null && gB - gM <= MAX_OVER_MAIN;
  verdict.absOk = absOk; verdict.relOk = gM === null ? null : relOk;
  if (!absOk && !relOk) reasons.push(`heap growth ${gB.toFixed(2)}% > ${MAX_GROWTH}%${gM === null ? ' (no --base to compare against)' : ` and ${(gB - gM).toFixed(2)} pp over main (> ${MAX_OVER_MAIN} pp)`}`);
}
verdict.gl = [];
for (const r of runs.branch) {
  if (r.error) { reasons.push('branch round error: ' + r.error); continue; }
  if (!r.glBase || !r.glEnd) { reasons.push('window.__osGl unavailable (page not loaded with osdebug=gldebug / OS chunk missing): WebGL release cannot be verified'); continue; }
  for (const k of GL_KEYS) {
    if (typeof r.glBase[k] !== 'number' || typeof r.glEnd[k] !== 'number') { reasons.push(`WebGL counter ${k} missing`); continue; }
    verdict.gl.push({ key: k, base: r.glBase[k], end: r.glEnd[k] });
    if (r.glEnd[k] > r.glBase[k]) reasons.push(`WebGL ${k} did not return to baseline: ${r.glBase[k]} -> ${r.glEnd[k]}`);
  }
}
const pass = reasons.length === 0;
console.log(`\n${pass ? 'PASS' : 'FAIL'} P6 branch: median heap growth ${gB === null ? 'n/a' : gB.toFixed(2) + '%'}${gM !== null ? `, main ${gM.toFixed(2)}% (diff ${(gB - gM).toFixed(2)} pp)` : ', no baseline given'}; WebGL ${verdict.gl.length ? verdict.gl.map((x) => `${x.key} ${x.base}->${x.end}`).join(', ') : 'n/a'}`);
for (const r of reasons) console.log('  - ' + r);
fs.writeFileSync(path.join(A.out, 'result.json'), JSON.stringify({ args: A, invalid, verdict, pass, reasons, runs }, null, 2));
process.exit(invalid && !A['allow-software'] ? 2 : pass ? 0 : 1);
