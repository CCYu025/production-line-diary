// Design-review material (spec §9.6): hub with channel list 1920x1080, frame strips of the enter / exit / short transitions,
// station at 1280 and 1920, palette open, device-gate message. Everything lands in --out (PNG/JPEG + strips/*.png + index.html).
//
//   node scripts/verify/os-shots.mjs --url http://localhost:3114/ --out verify-out/os-shots [--only hub,station,palette,gate,strips]
//        [--headed] [--osdebug nobloom] [--cdp-port 9801] [--strip-width 1600]
//
// Strips: CDP screencast frames (fallback: back-to-back screenshots) are matched to planned offsets measured from the in-page
// phase-change stamp (epoch = performance.timeOrigin + stamp); the label under each frame shows the REAL frame offset and the phase.
// Software GL (headless default) renders few frames, so frames may repeat: use --headed on a GPU machine for smooth strips.
// Not pixel-exact by design. Read-only: nothing is saved to the server.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { sleep } from './cdp.mjs';
import { SEL, q, hudCh, osUrl, launchChrome, openPage, waitPhase, centerOf } from './os-common.mjs';

const { values: A } = parseArgs({
  options: {
    url: { type: 'string' }, out: { type: 'string', default: 'verify-out/os-shots' }, only: { type: 'string', default: 'hub,station,palette,gate,strips' },
    headed: { type: 'boolean', default: false }, osdebug: { type: 'string', default: '' }, 'cdp-port': { type: 'string', default: '9801' },
    'strip-width': { type: 'string', default: '1600' }, help: { type: 'boolean', default: false },
  },
});
if (A.help || !A.url) { console.log('node scripts/verify/os-shots.mjs --url http://localhost:3114/ [--out dir] [--only hub,station,palette,gate,strips] [--headed] [--osdebug a,b] [--strip-width 1600]'); process.exit(A.help ? 0 : 2); }
const only = new Set(A.only.split(','));
const OUT = path.resolve(A.out);
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'strips'), { recursive: true });
const made = [];
const note = (f, what) => { made.push({ file: path.relative(OUT, f), what }); console.log('saved', path.relative(OUT, f), '-', what); };
const shot = async (p, name, what) => { const f = path.join(OUT, name); await p.screenshot(f); note(f, what); };
const browser = await launchChrome({ port: +A['cdp-port'], headless: !A.headed });
const open = async (hash, w, h, o = {}) => {
  const p = await openPage(browser, osUrl(A.url, { hash, osdebug: A.osdebug }), { width: w, height: h, settle: 400, ...o });
  if (hash) await waitPhase(p, 'station', 15000); else await waitPhase(p, 'hub', 15000);
  await sleep(1400);
  return p;
};

try {
  if (only.has('hub')) {
    const p = await open('', 1920, 1080);
    await shot(p, 'hub-1920x1080.png', 'hub with the channel list (default selection)');
    for (let i = 0; i < 4; i++) { await p.eval(`(document.querySelector(${JSON.stringify(SEL.hudSelected)})||document.querySelector(${JSON.stringify(SEL.hudAny)})).focus()`); await p.key('ArrowRight'); await sleep(150); }
    await sleep(900);
    await shot(p, 'hub-1920x1080-selected-5.png', 'hub after ArrowRight x4 (selection + 3D monitor texture follow the HUD)');
    await p.close();
  }
  if (only.has('station')) {
    for (const [w, h] of [[1280, 800], [1920, 1080]]) for (const [hash, nm] of [['#/records', 'records'], ['#/dashboard', 'dashboard']]) {
      const p = await open(hash, w, h);
      await shot(p, `station-${nm}-${w}.png`, `station ${hash} at ${w}x${h}`);
      await p.close();
    }
  }
  if (only.has('palette')) {
    const p = await open('', 1920, 1080);
    await p.key('/'); await p.waitFor(q(SEL.palette), 3000).catch(async () => { await p.key('k', { modifiers: 2 }); await p.waitFor(q(SEL.palette), 3000); });
    await sleep(300); await p.insertText('re'); await sleep(400);
    await shot(p, 'palette-open-hub.png', 'command palette in the hub, typing "re" (autocomplete list)');
    await p.key('Escape'); await sleep(300);
    await p.close();
    const s = await open('#/records', 1280, 800);
    await s.key('k', { modifiers: 2 }); await s.waitFor(q(SEL.palette), 3000); await sleep(300);
    await s.insertText('xyz'); await s.key('Enter'); await sleep(400);
    await shot(s, 'palette-error-station.png', 'palette at a station with an unknown command (inline error)');
    await s.close();
  }
  if (only.has('gate')) {
    const p = await open('', 1440, 900);
    await p.setViewport(1000, 700); await sleep(1000);
    await shot(p, 'device-gate-1000x700.png', 'device gate message (<1024 wide)');
    await p.setViewport(1280, 500); await sleep(800);
    await shot(p, 'device-gate-1280x500.png', 'device gate message (<600 high)');
    await p.close();
  }

  // ------------------------------------------------------------ frame strips
  const strips = [];
  async function capture(kind, hash, trigger, total, step, w = 1280, h = 800) {
    try { await captureOne(kind, hash, trigger, total, step, w, h); } catch (e) { console.log(`WARN ${kind}: ${String(e.message).split(String.fromCharCode(10))[0]} (strip skipped)`); }
  }
  async function captureOne(kind, hash, trigger, total, step, w, h) {
    const p = await open(hash, w, h);
    let stop = null, fbRun = false, fbLoop = null; const fallback = [];
    try {
      const since = await p.eval('__phases.length');
      stop = await p.startScreencast({ format: 'jpeg', quality: 72, maxWidth: 640 }).catch(() => null);
      if (!stop) {
        fbRun = true;
        fbLoop = (async () => { while (fbRun) { try { const r = await p.send('Page.captureScreenshot', { format: 'jpeg', quality: 60 }); fallback.push({ t: Date.now(), data: r.data }); } catch { break; } } })();
      }
      await trigger(p);
      await sleep(total + 600);
      const frames = stop ? await stop() : (fbRun = false, await fbLoop, fallback);
      stop = null;
      const origin = await p.eval('performance.timeOrigin');
      const phases = await p.eval(`__phases.slice(${since}).map(x=>({phase:x.phase,t:x.now}))`);
      const start = phases.find((x) => /-pre$/.test(x.phase));
      if (!start) { console.log(`WARN ${kind}: no *-pre phase observed; strip skipped`); return; }
      const t0 = origin + start.t;
      const phaseAt = (tAbs) => { let ph = phases[0]?.phase ?? '?'; for (const x of phases) if (origin + x.t <= tAbs) ph = x.phase; return ph; };
      const picks = [];
      for (let off = 0; off <= total; off += step) {
        let best = null;
        for (const f of frames) { const d = Math.abs(f.t - (t0 + off)); if (!best || d < best.d) best = { d, f }; }
        if (best) {
          const real = Math.round(best.f.t - t0); const file = path.join(OUT, 'frames', `${kind}-${String(off).padStart(4, '0')}.jpg`);
          fs.writeFileSync(file, Buffer.from(best.f.data, 'base64'));
          picks.push({ off, real, phase: phaseAt(best.f.t), file: path.relative(OUT, file) });
        }
      }
      strips.push({ kind, picks, frames: frames.length, source: frames === fallback ? 'screenshots' : 'screencast', phases: phases.map((x) => `${x.phase}@${Math.round(x.t - start.t)}ms`).join(' > ') });
      console.log(`${kind}: ${frames.length} frames captured, ${picks.length} picked; phases ${strips.at(-1).phases}`);
    } finally { fbRun = false; try { await stop?.(); } catch {} await p.close(); }
  }
  if (only.has('strips')) {
    const hudClick = async (p) => { const c = await centerOf(p, q(hudCh(2))); if (!c) throw new Error('no HUD CH-02 button'); await p.click(c.x, c.y); };
    await capture('enter', '', hudClick, 1200, 100);
    await capture('exit', '#/records', async (p) => { const c = await centerOf(p, q(SEL.back)); await p.click(c.x, c.y); }, 900, 75);
    await capture('short-hash', '#/records', (p) => p.eval(`location.hash='#/dashboard'`), 300, 25);
    await capture('short-palette', '#/records', async (p) => { await p.key('k', { modifiers: 2 }); await p.waitFor(q(SEL.palette), 3000); await p.insertText('cal'); await sleep(200); await p.key('Enter'); }, 300, 25);
    // montage: render a contact sheet in Chrome itself (no image libraries)
    const W = +A['strip-width'];
    const mk = await browser.newPage({ width: W, height: 800, context: true });
    for (const s of strips) {
      const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#111;color:#ddd;font:13px/1.3 monospace}h1{font-size:15px;margin:10px}
        .g{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:8px}figure{margin:0}img{width:100%;display:block;border:1px solid #444}figcaption{padding:3px 0}</style>
        <h1>${s.kind} - ${s.source}, ${s.frames} frames (label: planned offset / real frame offset / phase)</h1><p style="margin:0 10px">phase stamps: ${s.phases}</p><div class="g">
        ${s.picks.map((x) => `<figure><img src="../${x.file.replace(/\\/g, '/')}"><figcaption>+${x.off}ms (real ${x.real}ms) ${x.phase}</figcaption></figure>`).join('')}</div>`;
      const hf = path.join(OUT, 'strips', `${s.kind}.html`);
      fs.writeFileSync(hf, html);
      await mk.goto('file:///' + hf.replace(/\\/g, '/'), { settle: 300 });
      await mk.waitFor(`[...document.images].every(i=>i.complete)`, 5000).catch(() => {});
      const hh = await mk.eval('Math.ceil(document.documentElement.scrollHeight)');
      await mk.setViewport(W, hh);
      await sleep(200);
      await mk.screenshot(path.join(OUT, 'strips', `${s.kind}.png`));
      note(path.join(OUT, 'strips', `${s.kind}.png`), `${s.kind} transition frame strip (${s.picks.length} frames)`);
    }
    await mk.close();
  }
} finally { await browser.close(); }
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(made, null, 2));
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>os-shots</title><body style="font:14px sans-serif;background:#fff"><h1>os-shots</h1><ul>${made.map((m) => `<li><a href="${m.file}">${m.file}</a> - ${m.what}</li>`).join('')}</ul>`);
console.log(`\n${made.length} files in ${OUT}  (open index.html)`);
