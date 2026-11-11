// Reduced-motion stillness check for the H1 lab (docs/holo-mode-spec.md section 4.2: with prefers-reduced-motion nothing may move).
//   node scripts/verify/holo-still.mjs --url http://localhost:3114/ [--gap 700] [--out dir] [--allow-software]
// For machine and spiral (spiral needs holo-seed data so tracked cards exist) x crt std / off / max: with prefers-reduced-motion: reduce emulated, nothing touched
// (machine auto-rotate left on), two screenshots --gap ms apart must be pixel-identical (diff 0). A control run WITHOUT reduced motion (std) must differ,
// otherwise the check proves nothing. Exit 1 on any failure, 2 if the renderer is software (unless --allow-software).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Browser, sleep } from './cdp.mjs';

const { values: A } = parseArgs({ options: { url: { type: 'string' }, gap: { type: 'string', default: '700' }, out: { type: 'string', default: 'verify-out/holo-still' }, 'allow-software': { type: 'boolean', default: false }, 'cdp-port': { type: 'string', default: '9661' }, help: { type: 'boolean', default: false } } });
if (A.help || !A.url) { console.log('node scripts/verify/holo-still.mjs --url http://localhost:3114/ [--gap 700] [--out dir] [--allow-software]'); process.exit(A.help ? 0 : 2); }
fs.mkdirSync(A.out, { recursive: true });
const base = A.url.replace(/\/?$/, '/');
const DIFF = `(async (a, b) => {
  const load = async (x) => { const i = new Image(); i.src = 'data:image/png;base64,' + x; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
  const [da, db] = [await load(a), await load(b)]; let n = 0, max = 0;
  for (let i = 0; i < da.length; i += 4) { const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2])); if (d) { n++; if (d > max) max = d; } }
  return { differingPixels: n, maxChannelDelta: max, totalPixels: da.length / 4 };
})`;
const browser = await Browser.launch({ port: +A['cdp-port'], headless: false });
const results = [];
let bad = false;
try {
  for (const [scene, extra] of [['machine', ''], ['spiral', '']]) {
    for (const [crt, reduced] of [['std', true], ['off', true], ['max', true], ['std', false]]) {
      const p = await browser.newPage({ width: 1280, height: 720 });
      await p.setMedia('dark', 'screen', [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }]);
      await p.goto(`${base}#/_holo?scene=${scene}&crt=${crt}&holodebug=1&slate=off${extra}`, { settle: 300 });
      const renderer = await p.webglRenderer();
      if (/swiftshader|llvmpipe|software|no-webgl/i.test(String(renderer)) && !A['allow-software']) { console.log(`INVALID: software renderer (${renderer})`); await browser.close(); process.exit(2); }
      await p.waitFor('window.__holoLab && window.__holoLab().frames > 10', 30000);
      if (scene === 'spiral') await p.waitFor('window.__holoLab().spiral && window.__holoLab().spiral.total > 0', 60000);
      const info = JSON.parse(await p.eval('JSON.stringify(window.__holoLab())'));
      await p.eval("(()=>{const h=document.querySelector('.holo-lab-hud');if(h)h.style.visibility='hidden';return true})()"); // the lab's fps readout text changes every 500 ms: not part of the world
      await sleep(2500); // thumbnails decoded, fades done
      const a = await p.send('Page.captureScreenshot', { format: 'png' });
      await sleep(+A.gap);
      const b = await p.send('Page.captureScreenshot', { format: 'png' });
      const d = await p.eval(`(${DIFF})(${JSON.stringify(a.data)}, ${JSON.stringify(b.data)})`, true);
      const tag = `${scene}-${crt}-${reduced ? 'reduced' : 'motion'}`;
      fs.writeFileSync(path.join(A.out, `${tag}-a.png`), Buffer.from(a.data, 'base64'));
      fs.writeFileSync(path.join(A.out, `${tag}-b.png`), Buffer.from(b.data, 'base64'));
      const ok = reduced ? d.differingPixels === 0 && info.reducedMotion === true : d.differingPixels > 0;
      if (!ok) bad = true;
      results.push({ scene, crt, reducedMotion: info.reducedMotion, level: info.level, cards: info.spiral?.fullCards ?? null, ...d, ok });
      console.log(`${ok ? 'PASS' : 'FAIL'} ${scene} crt=${crt} ${reduced ? 'reduced motion' : 'CONTROL (motion allowed, must differ)'}: ${d.differingPixels} differing px of ${d.totalPixels} (max channel delta ${d.maxChannelDelta}); page says reducedMotion=${info.reducedMotion}${info.spiral ? ', full cards ' + info.spiral.fullCards : ''}`);
      await p.close();
    }
  }
} finally {
  fs.writeFileSync(path.join(A.out, 'result.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
process.exit(bad ? 1 : 0);
