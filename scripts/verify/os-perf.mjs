// P1 + P2 performance checks for the OS mode.
//   P1: HEADED Chrome (real GPU), 1920x1080, hub idle 10s: median fps >= 55 (1x CPU), >= 30 (4x CPU throttle).
//       Exit 2 + "INVALID" if the WebGL renderer is software (SwiftShader / llvmpipe / software).
//   (the click uses the selected HUD channel button: [data-os="hud-ch"][aria-current="true"])
//   P2: at station (phase 'station'), requestAnimationFrame calls attributable to OS lazy chunks over 3s must be 0.
//       (rAF is wrapped via Page.addScriptToEvaluateOnNewDocument; stacks are matched against OS chunk file names from web/dist)
// node scripts/verify/os-perf.mjs --url http://localhost:3114/ [--only p1,p2] [--dist web/dist] [--osdebug nobloom,nosway,nophosphor]
//   shortcuts: --no-bloom --no-sway --no-phosphor (append to osdebug)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { sleep } from './cdp.mjs';
import { SEL, PHASE_EXPR, q, osUrl, launchChrome, waitPhase, centerOf, median, percentile } from './os-common.mjs';
import { analyze } from './bundle-graph.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { values: A } = parseArgs({
  options: {
    url: { type: 'string' }, only: { type: 'string', default: 'p1,p2' }, out: { type: 'string', default: 'verify-out/os-perf' },
    dist: { type: 'string', default: path.join(HERE, '..', '..', 'web', 'dist') },
    'os-chunks': { type: 'string' }, osdebug: { type: 'string', default: '' },
    'no-bloom': { type: 'boolean', default: false }, 'no-sway': { type: 'boolean', default: false }, 'no-phosphor': { type: 'boolean', default: false },
    duration: { type: 'string', default: '10' }, 'p2-seconds': { type: 'string', default: '3' },
    'min-fps': { type: 'string', default: '55' }, 'min-fps-throttled': { type: 'string', default: '30' },
    'cdp-port': { type: 'string', default: '9611' }, headless: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (A.help || !A.url) { console.log('node scripts/verify/os-perf.mjs --url http://localhost:3114/ [--only p1,p2] [--dist web/dist] [--osdebug list] [--no-bloom --no-sway --no-phosphor] [--duration 10] [--p2-seconds 3]'); process.exit(A.help ? 0 : 2); }
const only = new Set(A.only.split(','));
const dbg = [A.osdebug, A['no-bloom'] && 'nobloom', A['no-sway'] && 'nosway', A['no-phosphor'] && 'nophosphor'].filter(Boolean).join(',');
const out = { url: A.url, osdebug: dbg };
fs.mkdirSync(A.out, { recursive: true });

// P1 headed (real GPU) unless --headless (then results are informational only).
const browser = await launchChrome({ port: +A['cdp-port'], headless: A.headless });
let exitCode = 0;
try {
  // ------------------------------------------------------------------ P1
  if (only.has('p1')) {
    const p = await browser.newPage({ width: 1920, height: 1080 });
    await p.goto(osUrl(A.url, { osdebug: dbg }), { settle: 500 });
    const renderer = await p.webglRenderer();
    out.renderer = renderer;
    console.log('WebGL renderer:', renderer);
    if (/swiftshader|llvmpipe|software|no-webgl/i.test(String(renderer)) || A.headless) {
      console.log(`P1 INVALID: renderer is software / headless (${renderer}); fps numbers would not be meaningful. Run headed on a machine with a GPU.`);
      out.p1 = { invalid: true };
      await p.close(); fs.writeFileSync(path.join(A.out, 'result.json'), JSON.stringify(out, null, 2));
      await browser.close(); process.exit(2);
    }
    await waitPhase(p, 'hub', 15000);
    await sleep(1500);
    const MEASURE = (secs) => `new Promise(res=>{const d=[];let last=performance.now();const end=last+${secs}*1000;
      const f=(t)=>{d.push(t-last);last=t;if(t<end)requestAnimationFrame(f);else res(d)};requestAnimationFrame(f)})`;
    out.p1 = {};
    for (const [label, rate, min] of [['1x', 1, +A['min-fps']], ['4x', 4, +A['min-fps-throttled']]]) {
      await p.throttleCPU(rate); await sleep(1200);
      const d = (await p.eval(MEASURE(+A.duration), true)).slice(5); // drop warm-up frames
      const medFps = 1000 / median(d), p5Fps = 1000 / percentile(d, 95), avg = 1000 / (d.reduce((a, b) => a + b, 0) / d.length);
      const pass = medFps >= min;
      if (!pass) exitCode = 1;
      out.p1[label] = { frames: d.length, medianFps: +medFps.toFixed(1), p5Fps: +p5Fps.toFixed(1), avgFps: +avg.toFixed(1), min, pass };
      console.log(`${pass ? 'PASS' : 'FAIL'} P1 hub idle ${A.duration}s CPU ${label}: median ${medFps.toFixed(1)} fps (need >= ${min}), p5 ${p5Fps.toFixed(1)} fps, avg ${avg.toFixed(1)}, frames ${d.length}`);
    }
    await p.throttleCPU(1);
    await p.close();
  }

  // ------------------------------------------------------------------ P2
  if (only.has('p2')) {
    let osNames;
    if (A['os-chunks']) osNames = new Set(A['os-chunks'].split(','));
    else {
      const G = analyze(A.dist);
      osNames = new Set([...G.osLazy].map((f) => path.basename(f)));
      out.osChunks = [...osNames];
    }
    console.log('P2 OS chunk files:', osNames.size ? [...osNames].join(', ') : '(none found in dist - nothing to attribute; check --dist / --os-chunks)');
    const RAF_HOOK = `(()=>{ try{Error.stackTraceLimit=40}catch(e){}
      const orig=window.requestAnimationFrame.bind(window); const R=window.__raf={on:false,total:0,stacks:new Map()};
      window.requestAnimationFrame=function(cb){ if(R.on){ R.total++; const s=new Error().stack||''; R.stacks.set(s,(R.stacks.get(s)||0)+1); } return orig(cb); }; })()`;
    out.p2 = {};
    for (const mode of ['direct', 'via-click']) {
      const p = await browser.newPage({ width: 1440, height: 900, preScripts: [RAF_HOOK] });
      try {
        if (mode === 'direct') { await p.goto(osUrl(A.url, { hash: '#/records', osdebug: dbg }), { settle: 300 }); }
        else {
          await p.goto(osUrl(A.url, { osdebug: dbg }), { settle: 300 });
          await waitPhase(p, 'hub', 15000); await sleep(500);
          const c = (await centerOf(p, q(SEL.hudSelected))) ?? (await centerOf(p, q(SEL.hudAny))); if (!c) throw new Error('no HUD channel button ([data-os="hud-ch"][aria-current="true"])');
          await p.click(c.x, c.y);
        }
        await waitPhase(p, 'station', 15000);
        await sleep(1000);
        await p.eval('(window.__raf.on=true, window.__raf.total=0, window.__raf.stacks.clear(), 1)');
        await sleep(+A['p2-seconds'] * 1000);
        const R = await p.eval('(window.__raf.on=false, ({total:window.__raf.total, stacks:[...window.__raf.stacks.entries()]}))');
        const urlRe = /https?:\/\/[^\s)]+?\.m?js/g;
        let osCalls = 0; const others = new Map();
        for (const [stack, n] of R.stacks) {
          const files = [...stack.matchAll(urlRe)].map((m) => path.basename(new URL(m[0]).pathname));
          if (files.some((f) => osNames.has(f))) osCalls += n;
          else { const key = files.slice(0, 3).join(' < ') || '(no script frames)'; others.set(key, (others.get(key) ?? 0) + n); }
        }
        const pass = osCalls === 0;
        if (!pass) exitCode = 1;
        out.p2[mode] = { seconds: +A['p2-seconds'], totalRaf: R.total, osCalls, others: Object.fromEntries(others), pass };
        console.log(`${pass ? 'PASS' : 'FAIL'} P2 station (${mode}) ${A['p2-seconds']}s: rAF total ${R.total}, OS-chunk-attributed ${osCalls} (expect 0)`);
        for (const [k, n] of [...others].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`      other caller x${n}: ${k}`);
        if (!pass) {
          const worst = [...R.stacks].filter(([s]) => [...s.matchAll(urlRe)].some((m) => osNames.has(path.basename(new URL(m[0]).pathname)))).sort((a, b) => b[1] - a[1])[0];
          if (worst) console.log('      top OS stack:\n        ' + worst[0].split('\n').slice(0, 8).join('\n        '));
        }
      } catch (e) { exitCode = 1; console.log('FAIL P2', mode, e.message.split('\n')[0]); }
      await p.close();
    }
  }
} finally { await browser.close(); }
fs.writeFileSync(path.join(A.out, 'result.json'), JSON.stringify(out, null, 2));
process.exit(exitCode);
