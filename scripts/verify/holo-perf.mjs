// HOLO performance probe for the H1 lab (docs/holo-mode-spec.md section 10.1: HP1, HP2, HP5, HP7 + slate input latency).
//   node scripts/verify/holo-perf.mjs --url http://localhost:3114/ [--scene machine|spiral] [--n 5000] [--throttle 1|4]
//        [--modes fps,hp2,hp5,input,hp7] [--duration 10] [--soak 300] [--crt std] [--out dir] [--allow-software]
// Needs the LAB build (VITE_HOLO_LAB=1 npm run build) served by serve.mjs and, for the spiral, holo-seed data of the size you pass as --n
// (--n is only a label + a sanity check against the number of records the page actually loaded).
// HEADED Chrome with real GPU: a renderer name containing SwiftShader / llvmpipe / software makes every number INVALID (exit 2) unless --allow-software.
//   fps   HP1: median fps of rAF over --duration seconds, idle (nothing touched; the machine's auto rotate stays on) and operating (rotate drag, wheel, cursor moves).
//         Gate: spiral n<=5000 >= 55 fps (CPU 1x); n=20000 >= 30; CPU 4x with n<=5000 >= 30. The machine scene is measured for the record (gate 55 at 1x).
//   hp2   HP2 (measure only): machine, slate open, world still (rot=0) 2 s after settling: fps of rAF and the number of world frames.
//   hp5   HP5 (measure only): navigation start -> first world frame, and lab mount -> first frame, in ms.
//   input slate typing latency: keydown -> next animation frame while the world turns (ms, p50 / p95 / max).
//   hp7   HP7: thumbnails. samples decoding / resident / renderer textures every 250 ms while the cursor sweeps back and forth for --soak seconds
//         (default 300 = 5 min), heap after forced GC every 15 s (slope), then parks the cursor and checks that 30+ s later nothing stale is still resident.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Browser, sleep } from './cdp.mjs';

const { values: A } = parseArgs({
  options: {
    url: { type: 'string' }, scene: { type: 'string', default: 'spiral' }, n: { type: 'string' }, throttle: { type: 'string', default: '1' },
    modes: { type: 'string', default: 'fps' }, duration: { type: 'string', default: '10' }, soak: { type: 'string', default: '300' }, crt: { type: 'string', default: 'std' },
    out: { type: 'string', default: 'verify-out/holo-perf' }, 'allow-software': { type: 'boolean', default: false }, 'cdp-port': { type: 'string', default: '9641' },
    width: { type: 'string', default: '1920' }, height: { type: 'string', default: '1080' }, help: { type: 'boolean', default: false },
  },
});
if (A.help || !A.url) { console.log('node scripts/verify/holo-perf.mjs --url http://localhost:3114/ [--scene machine|spiral] [--n 5000] [--throttle 1|4] [--modes fps,hp2,hp5,input,hp7] [--duration 10] [--soak 300] [--crt std] [--out dir] [--allow-software]'); process.exit(A.help ? 0 : 2); }
fs.mkdirSync(A.out, { recursive: true });
const base = A.url.replace(/\/?$/, '/');
const modes = new Set(A.modes.split(','));
const W = +A.width, H = +A.height;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
const url = (extra = '') => `${base}#/_holo?scene=${A.scene}${A.n ? `&n=${A.n}` : ''}&crt=${A.crt}&holodebug=1${extra}`;

const out = { url: A.url, scene: A.scene, n: A.n ?? null, cpuThrottle: +A.throttle, crt: A.crt, viewport: `${W}x${H}`, startedAt: new Date().toISOString() };
// Note: a blank headed page already runs at the monitor refresh rate (about 56-60 fps here), so fps is capped by vsync; the gates are judged against that cap.
const browser = await Browser.launch({ port: +A['cdp-port'], headless: false, });
let exitCode = 0;
const log = (...a) => console.log(...a);

async function open(extra = '') {
  const p = await browser.newPage({ width: W, height: H });
  await p.goto(url(extra), { settle: 300 });
  const renderer = await p.webglRenderer();
  out.renderer = renderer;
  if (/swiftshader|llvmpipe|software|no-webgl/i.test(String(renderer)) && !A['allow-software']) {
    log(`INVALID: WebGL renderer is software (${renderer}). Numbers would be meaningless. Run headed on a machine with a GPU (or --allow-software for a smoke run).`);
    out.invalid = true;
    fs.writeFileSync(path.join(A.out, 'result.json'), JSON.stringify(out, null, 2));
    await browser.close();
    process.exit(2);
  }
  await p.waitFor('window.__holoLab && window.__holoLab().frames > 10', 30000);
  if (A.scene === 'spiral') await p.waitFor('window.__holoLab().spiral && window.__holoLab().spiral.total > 0', 60000);
  await p.throttleCPU(+A.throttle);
  await sleep(1200);
  return p;
}
const lab = async (p) => JSON.parse(await p.eval('JSON.stringify(window.__holoLab())'));

const FRAMES_START = `(()=>{const pf=window.__pf={d:[],last:performance.now(),run:true};const f=(t)=>{if(!pf.run)return;pf.d.push(t-pf.last);pf.last=t;requestAnimationFrame(f)};requestAnimationFrame(f);return true})()`;
const FRAMES_STOP = `(()=>{window.__pf.run=false;return window.__pf.d})()`;
const fpsStats = (d) => { const x = d.slice(5); return { frames: x.length, medianFps: +(1000 / median(x)).toFixed(1), p5Fps: +(1000 / pctl(x, 95)).toFixed(1), avgFps: +(1000 / (x.reduce((a, b) => a + b, 0) / x.length)).toFixed(1), maxFrameMs: +Math.max(...x).toFixed(1) }; };

async function operate(p, seconds) {
  const cx = W / 2, cy = H / 2;
  const t0 = Date.now();
  let k = 0;
  while (Date.now() - t0 < seconds * 1000) {
    k++;
    if (A.scene === 'spiral') {
      await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: k % 6 < 3 ? 120 : -120 });
      if (k % 5 === 0) { await p.keyDown('PageUp'); await p.keyUp('PageUp'); }
      if (k % 7 === 0) await p.eval('window.__holoLab.moveCursor(7)'); // Shift+wheel equivalent (a week)
    } else {
      await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: k % 8 < 4 ? 100 : -100 });
    }
    if (k % 4 === 0) { // rotate drag
      await p.mouseMove(cx, cy); await p.mouseDown(cx, cy);
      for (let i = 1; i <= 12; i++) { await p.mouseMove(cx + i * 14, cy + Math.sin(i / 2) * 20); await sleep(8); }
      await p.mouseUp(cx + 168, cy);
    }
    await sleep(30);
  }
}

try {
  // ------------------------------------------------------------------ HP1
  if (modes.has('fps')) {
    const p = await open(A.scene === 'machine' ? '' : '');
    const info = await lab(p);
    out.records = info.records;
    if (A.scene === 'spiral' && A.n && Math.abs(info.records - +A.n) > Math.max(5, +A.n * 0.02)) log(`WARN: page loaded ${info.records} records but --n ${A.n}`);
    const min = A.scene === 'spiral' ? (+A.throttle > 1 ? 30 : (A.n && +A.n > 5000 ? 30 : 55)) : (+A.throttle > 1 ? 30 : 55);
    out.hp1 = { gateMinFps: min };
    for (const [label, fn] of [['idle', async () => sleep(+A.duration * 1000)], ['operate', async () => operate(p, +A.duration)]]) {
      await p.eval(FRAMES_START);
      await fn();
      const d = await p.eval(FRAMES_STOP);
      const st = fpsStats(d);
      const pass = st.medianFps >= min;
      if (!pass) exitCode = 1;
      out.hp1[label] = { ...st, pass };
      log(`${pass ? 'PASS' : 'FAIL'} HP1 ${A.scene}${A.n ? ' n=' + A.n : ''} CPU ${A.throttle}x ${label} ${A.duration}s: median ${st.medianFps} fps (need >= ${min}), p5 ${st.p5Fps}, avg ${st.avgFps}, worst frame ${st.maxFrameMs} ms`);
    }
    const end = await lab(p);
    out.hp1.rendererInfo = end.renderer;
    out.hp1.spiral = end.spiral;
    log('  renderer.info per frame:', JSON.stringify(end.renderer.render), 'memory:', JSON.stringify(end.renderer.memory), end.spiral ? 'counts: ' + JSON.stringify({ fullCards: end.spiral.fullCards, dots: end.spiral.dots, tickLines: end.spiral.tickLines }) : '');
    await p.screenshot(path.join(A.out, `fps-${A.scene}${A.n ?? ''}-cpu${A.throttle}.png`));
    await p.throttleCPU(1);
    await p.close();
  }

  // ------------------------------------------------------------------ HP2 (machine, slate open, world still)
  if (modes.has('hp2')) {
    const sc = A.scene;
    A.scene = 'machine';
    const p = await open('&rot=0&slate=proj');
    await sleep(2000); // world still for 2 s
    const f0 = (await lab(p)).frames;
    await p.eval(FRAMES_START);
    await sleep(3000);
    const d = await p.eval(FRAMES_STOP);
    const f1 = (await lab(p)).frames;
    const st = fpsStats(d);
    out.hp2 = { ...st, worldFramesIn3s: f1 - f0, worldFps: +((f1 - f0) / 3).toFixed(1), note: 'measured only (HP2 target <= 10 fps is implemented in H3: the H1 loop is always on)' };
    log(`INFO HP2 slate open, world still, CPU ${A.throttle}x: rAF median ${st.medianFps} fps; world frames ${f1 - f0} in 3 s (${out.hp2.worldFps} fps)`);
    await p.throttleCPU(1);
    await p.close();
    A.scene = sc;
  }

  // ------------------------------------------------------------------ HP5
  if (modes.has('hp5')) {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const p = await open();
      const info = await lab(p);
      runs.push({ navigationToFirstFrameMs: +info.firstFrameAt.toFixed(0), labMountToFirstFrameMs: info.readyMs === null ? null : +info.readyMs.toFixed(0) });
      await p.close();
    }
    out.hp5 = { scene: A.scene, runs, medianNavigationToFirstFrameMs: median(runs.map((r) => r.navigationToFirstFrameMs)), note: 'measured only; includes app boot, lazy lab chunk, (spiral: records fetch) on localhost' };
    log('INFO HP5', JSON.stringify(out.hp5));
  }

  // ------------------------------------------------------------------ input latency inside the slate
  if (modes.has('input')) {
    const sc = A.scene;
    A.scene = 'machine';
    for (const method of ['proj', 'css3d']) {
      const p = await open(`&slate=${method}`);
      await p.eval(`(()=>{window.__lat=[];const el=document.getElementById('holo-problem');el.focus();
        el.addEventListener('keydown',(e)=>{const t=e.timeStamp;requestAnimationFrame(()=>{window.__lat.push(performance.now()-t)})},true)})()`);
      const text = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';
      for (const ch of text) { await p.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch }); await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }); await sleep(35); }
      await sleep(200);
      const lat = await p.eval('window.__lat');
      const val = await p.eval("document.getElementById('holo-problem').value");
      out[`input_${method}`] = { chars: lat.length, typedOk: val === text, p50Ms: +median(lat).toFixed(1), p95Ms: +pctl(lat, 95).toFixed(1), maxMs: +Math.max(...lat).toFixed(1) };
      log(`INFO slate typing (${method}, world turning, CPU ${A.throttle}x): keydown -> next frame p50 ${out[`input_${method}`].p50Ms} ms, p95 ${out[`input_${method}`].p95Ms} ms, max ${out[`input_${method}`].maxMs} ms; text intact: ${val === text}`);
      await p.throttleCPU(1);
      await p.close();
    }
    A.scene = sc;
  }

  // ------------------------------------------------------------------ HP7
  if (modes.has('hp7')) {
    if (A.scene !== 'spiral') A.scene = 'spiral';
    const p = await open();
    await p.send('HeapProfiler.enable');
    const info0 = await lab(p);
    // textures that are not thumbnails (post-processing target etc.): total minus the resident thumbnails
    const baseTextures = info0.renderer.memory.textures - info0.spiral.thumbs.resident;
    const soak = +A.soak;
    const samples = [];
    const heap = [];
    const heapNow = async () => { await p.send('HeapProfiler.collectGarbage'); return (await p.send('Runtime.getHeapUsage')).usedSize; };
    heap.push({ t: 0, bytes: await heapNow() });
    const t0 = Date.now();
    let nextHeapAt = 15;
    let dir = -1;
    let maxDec = 0, maxRes = 0, maxTex = 0, maxQueued = 0, maxSlots = 0;
    while ((Date.now() - t0) / 1000 < soak) {
      // sweep the cursor back and forth over about 60 days, one day every 250 ms
      await p.eval(`window.__holoLab.moveCursor(${dir})`);
      const i = await lab(p);
      const th = i.spiral.thumbs;
      maxDec = Math.max(maxDec, th.decoding); maxRes = Math.max(maxRes, th.resident); maxQueued = Math.max(maxQueued, th.queued); maxSlots = Math.max(maxSlots, th.slots);
      maxTex = Math.max(maxTex, i.renderer.memory.textures - baseTextures);
      samples.push({ t: +((Date.now() - t0) / 1000).toFixed(1), decoding: th.decoding, resident: th.resident, textures: i.renderer.memory.textures });
      const sec = (Date.now() - t0) / 1000;
      if (sec >= nextHeapAt) { heap.push({ t: +sec.toFixed(0), bytes: await heapNow() }); nextHeapAt += 15; }
      if (samples.length % 240 === 0) dir = -dir;
      await sleep(250);
    }
    heap.push({ t: soak, bytes: await heapNow() });
    // linear regression of heap (bytes) over time (s), ignoring the first minute of warm-up
    const warm = heap.filter((h) => h.t >= Math.min(60, soak / 4));
    let slope = 0;
    if (warm.length >= 3) { const mx = warm.reduce((a, h) => a + h.t, 0) / warm.length, my = warm.reduce((a, h) => a + h.bytes, 0) / warm.length; slope = warm.reduce((a, h) => a + (h.t - mx) * (h.bytes - my), 0) / warm.reduce((a, h) => a + (h.t - mx) ** 2, 0); }
    // park the cursor far away and wait for the 30 s release
    const parkAt = await p.eval('window.__holoLab.maxDay - 40');
    await p.eval(`window.__holoLab.setCursor(${parkAt})`);
    const afterPark = await lab(p);
    await sleep(36000);
    const later = await lab(p);
    const lt = later.spiral.thumbs;
    out.hp7 = {
      soakSeconds: soak, maxDecoding: maxDec, maxResident: maxRes, maxDecodingPlusResidentObserved: Math.max(...samples.map((s) => s.decoding + s.resident)), maxQueued, maxSlots, maxThumbTextures: maxTex,
      heapMiB: heap.map((h) => ({ t: h.t, MiB: +(h.bytes / 1048576).toFixed(1) })), heapSlopeKiBPerMin: +((slope * 60) / 1024).toFixed(1),
      afterParking: { residentRightAfter: afterPark.spiral.thumbs.resident, residentAfter36s: lt.resident, slotsAfter36s: lt.slots, texturesRightAfter: afterPark.renderer.memory.textures - baseTextures, texturesAfter36s: later.renderer.memory.textures - baseTextures, released: lt.released, started: lt.started },
    };
    const o = out.hp7;
    const pass1 = o.maxDecoding <= 24 && o.maxResident <= 24 && o.maxDecodingPlusResidentObserved <= 24;
    // nothing stale: every resident thumbnail belongs to a card that is in view now, and the GPU texture count follows the resident count
    const pass2 = o.afterParking.residentAfter36s <= o.afterParking.slotsAfter36s && o.afterParking.texturesAfter36s <= o.afterParking.residentAfter36s + 1;
    log(`${pass1 ? 'PASS' : 'FAIL'} HP7 decoding <= 24 and resident <= 24 (also their sum): max decoding ${maxDec}, max resident ${maxRes}, max sum ${o.maxDecodingPlusResidentObserved}, queued peak ${maxQueued}`);
    log(`${pass2 ? 'PASS' : 'FAIL'} HP7 30 s after leaving the view nothing stale stays: resident ${o.afterParking.residentRightAfter} -> ${lt.resident} (visible slots ${lt.slots}), thumb textures ${o.afterParking.texturesRightAfter} -> ${o.afterParking.texturesAfter36s}`);
    log(`INFO HP7 heap after GC: ${o.heapMiB.map((h) => `${h.t}s ${h.MiB}MiB`).join('  ')}  -> slope ${o.heapSlopeKiBPerMin} KiB/min (judge "not growing" from the series)`);
    if (!(pass1 && pass2)) exitCode = 1;
    await p.close();
  }
} finally {
  fs.writeFileSync(path.join(A.out, `result-${A.scene}${A.n ?? ''}-cpu${A.throttle}-${[...modes].join('_')}.json`), JSON.stringify(out, null, 2));
  await browser.close();
}
console.log(exitCode ? '\nRESULT: FAIL' : '\nRESULT: PASS (see INFO lines for measure-only items)');
process.exit(exitCode);
