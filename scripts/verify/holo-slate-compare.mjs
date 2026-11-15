// H1: terminal-slate positioning, method P (projection, translate only) vs method C (CSS3DRenderer): numbers + screenshots for the six comparison points
// (docs/holo-mode-spec.md section 3.3). Needs the LAB build served by serve.mjs. Writes nothing to the app's data.
//   node scripts/verify/holo-slate-compare.mjs --url http://localhost:3114/ [--out dir] [--headless]
//   1 sharpness   p99 / mean horizontal luminance gradient at DPR 1 and 1.5 over the SAME fixed-size crop (PROBE_W x PROBE_H device px, centred on a fixed test-text block
//                 that the script puts into the slate; nothing else of the slate or the 3D world is in the crop). Higher = crisper. PNG crops are saved too.
//   2 IME popup   NOT measurable with CDP (the OS candidate window). Reported: where the focused <input> and its caret box are on screen at each yaw,
//                 which is what Chrome hands to the IME. Judge the popup itself in the manual Zhuyin session.
//   3 focus ring  the ring box of each field stays inside the slate and the viewport (programmatic focus after a Tab, so :focus-visible applies)
//   4 click hit   at several camera yaws, reported separately: hitRateInView = of the controls whose centre is inside the viewport, how many are hit by
//                 elementFromPoint AND focused by a real CDP click; offscreenFraction = share of the controls whose centre is outside the viewport (not clickable at all)
//   5 frame cost  per second over 5 s with the world turning: style recalcs, layouts, their durations (CDP Performance), style mutations seen by a MutationObserver
//   6 red lines   transform / filter / perspective on the root nodes and on every ancestor of the slate, print emulation, accessibility tree roles
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Browser, sleep } from './cdp.mjs';

const { values: A } = parseArgs({ options: { url: { type: 'string' }, out: { type: 'string', default: 'verify-out/holo-slate' }, headless: { type: 'boolean', default: false }, 'cdp-port': { type: 'string', default: '9651' }, help: { type: 'boolean', default: false } } });
if (A.help || !A.url) { console.log('node scripts/verify/holo-slate-compare.mjs --url http://localhost:3114/ [--out dir] [--headless]'); process.exit(A.help ? 0 : 2); }
fs.mkdirSync(A.out, { recursive: true });
const base = A.url.replace(/\/?$/, '/');
const VARIANTS = [{ id: 'proj', q: 'slate=proj' }, { id: 'css3d', q: 'slate=css3d' }, { id: 'css3d-billboard', q: 'slate=css3d&bb=1' }];
const FIELDS = ['holo-problem', 'holo-action', 'holo-equipment'];
const YAWS = [0.45, 0, 0.9, 1.4, -0.6];
const report = { url: A.url, variants: {} };
const browser = await Browser.launch({ port: +A['cdp-port'], headless: A.headless });

const PROBE_W = 240, PROBE_H = 40; // CSS px of the crop; identical for every method
const PROBE_TEXT = 'ABCDEFGHIJKLM nopqrstuvwxyz 0123456789 設備異常 處理 iIl1|';
// fixed-size test block appended inside the slate body (same DOM, same CSS for every method); returns its viewport rect
const ADD_PROBE = `(() => {
  const body = document.querySelector('.holo-slate-body');
  let b = document.getElementById('holo-sharp-probe');
  if (!b) { b = document.createElement('div'); b.id = 'holo-sharp-probe'; b.setAttribute('aria-hidden', 'true');
    b.style.cssText = 'height:${PROBE_H}px;overflow:hidden;white-space:nowrap;font:14px/${PROBE_H}px "IBM Plex Mono","Noto Sans TC",monospace;color:var(--ink-1);background:var(--surface);';
    b.textContent = ${JSON.stringify(PROBE_TEXT)}; body.appendChild(b); }
  const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
})()`;

const GRAD = `(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data; const w = c.width, h = c.height; const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
  const gr = []; for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) gr.push(Math.abs(L[y * w + x] - L[y * w + x - 1]));
  gr.sort((a, b) => a - b); const mean = gr.reduce((a, b) => a + b, 0) / gr.length;
  return { w, h, p99: gr[Math.floor(gr.length * 0.99)], mean: +mean.toFixed(3) };
})`;

try {
  for (const v of VARIANTS) {
    const R = (report.variants[v.id] = {});
    // ---------------------------------------------------------------- 1 sharpness (+ screenshots)
    R.sharpness = {};
    for (const dpr of [1, 1.5]) {
      const p = await browser.newPage({ width: 1600, height: 900 });
      await p.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: dpr, mobile: false });
      await p.goto(`${base}#/_holo?${v.q}&holodebug=1`, { settle: 800 });
      await p.waitFor('window.__holoLab && window.__holoLab().frames > 10', 15000);
      await p.eval('window.__holoLab.setView(0.45, 0.12, 14)');
      await sleep(600);
      const r = await p.eval(ADD_PROBE);
      await sleep(300);
      const r2 = await p.eval(ADD_PROBE);
      // fixed-size crop centred on the probe block (identical size for every method), clamped inside the viewport
      const cx = r2.x + r2.width / 2, cy = r2.y + r2.height / 2;
      const clip = { x: Math.max(0, Math.min(1600 - PROBE_W, cx - PROBE_W / 2)), y: Math.max(0, Math.min(900 - PROBE_H, cy - PROBE_H / 2)), width: PROBE_W, height: PROBE_H };
      const shot = await p.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
      fs.writeFileSync(path.join(A.out, `sharp-${v.id}-dpr${dpr}.png`), Buffer.from(shot.data, 'base64'));
      R.sharpness[`dpr${dpr}`] = { ...(await p.eval(`(${GRAD})(${JSON.stringify(shot.data)})`, true)), probeRect: { x: +r2.x.toFixed(1), y: +r2.y.toFixed(1), w: +r2.width.toFixed(1), h: +r2.height.toFixed(1) }, cropCssPx: [PROBE_W, PROBE_H], probeMoved: Math.abs(r.x - r2.x) > 0.5 || Math.abs(r.y - r2.y) > 0.5 };
      await p.screenshot(path.join(A.out, `full-${v.id}-dpr${dpr}.png`));
      await p.close();
    }

    const p = await browser.newPage({ width: 1600, height: 900 });
    await p.goto(`${base}#/_holo?${v.q}&holodebug=1`, { settle: 800 });
    await p.waitFor('window.__holoLab && window.__holoLab().frames > 10', 15000);
    const slateRect = () => p.rectOf(`document.querySelector('[data-holo="slate"]')`);

    // ---------------------------------------------------------------- 2 + 4 click hit at several yaws, IME anchor positions
    R.hit = []; R.imeAnchor = [];
    for (const yaw of YAWS) {
      await p.eval(`window.__holoLab.setView(${yaw}, 0.12, 14)`);
      await sleep(500);
      const row = { yaw, controls: {} };
      // buttons first: focusing the Combobox opens its suggestion list, which sits on top of the buttons
      for (const id of ['submit', 'cancel', ...FIELDS]) {
        const sel = id === 'submit' || id === 'cancel' ? `document.querySelector('[data-field="${id}"]')` : `document.getElementById('${id}')`;
        const r = await p.rectOf(sel);
        if (!r || r.width < 2) { row.controls[id] = { visible: false }; continue; }
        const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
        const inView = cx > 0 && cy > 0 && cx < 1600 && cy < 900;
        const top = inView ? await p.eval(`(()=>{const t=document.elementFromPoint(${cx},${cy});const e=${sel};return !!t&&(t===e||e.contains(t)||t.contains(e)&&t!==document.body)})()`) : false;
        let clicked = false;
        if (inView && top) {
          await p.eval('document.activeElement && document.activeElement.blur()');
          await p.click(cx, cy);
          await sleep(60);
          clicked = await p.eval(`document.activeElement===${sel}`);
        }
        row.controls[id] = { visible: true, centreInView: inView, centre: [Math.round(cx), Math.round(cy)], size: [Math.round(r.width), Math.round(r.height)], elementFromPointHit: top, clickFocused: clicked };
      }
      const all = Object.values(row.controls);
      const inV = all.filter((c) => c.visible && c.centreInView);
      row.controlsInView = inV.length;
      row.hitRateInView = inV.length ? +(inV.filter((c) => c.elementFromPointHit && c.clickFocused).length / inV.length).toFixed(2) : null;
      row.offscreenFraction = +(all.filter((c) => !c.visible || !c.centreInView).length / all.length).toFixed(2);
      await p.key('Escape');
      await p.eval('document.activeElement && document.activeElement.blur()');
      R.hit.push(row);
      const caret = await p.eval(`(()=>{const e=document.getElementById('holo-problem');e.focus();const r=e.getBoundingClientRect();return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)}})()`);
      R.imeAnchor.push({ yaw, inputBox: caret });
    }
    await p.eval('window.__holoLab.setView(0.45, 0.12, 14)');
    await sleep(400);

    // ---------------------------------------------------------------- 3 focus ring
    R.focusRing = [];
    await p.eval('document.activeElement && document.activeElement.blur(); document.body.focus()');
    for (let i = 0; i < FIELDS.length + 2; i++) {
      await p.key('Tab');
      await sleep(80);
      const ring = await p.eval(`(()=>{const e=document.activeElement;if(!e||e===document.body)return null;const cs=getComputedStyle(e);const r=e.getBoundingClientRect();
        const ow=parseFloat(cs.outlineWidth)||0, oo=parseFloat(cs.outlineOffset)||0, ext=cs.outlineStyle==='none'?0:ow+Math.max(0,oo);
        const s=document.querySelector('[data-holo=slate]').getBoundingClientRect();
        const box={l:r.left-ext,t:r.top-ext,r:r.right+ext,b:r.bottom+ext};
        return {id:e.id||e.getAttribute('data-field')||e.tagName, outline:cs.outlineStyle+' '+cs.outlineWidth, focusVisible:e.matches(':focus-visible'),
          insideSlate:box.l>=s.left-0.5&&box.t>=s.top-0.5&&box.r<=s.right+0.5&&box.b<=s.bottom+0.5, insideViewport:box.l>=0&&box.t>=0&&box.r<=innerWidth&&box.b<=innerHeight}})()`);
      if (ring) R.focusRing.push(ring);
    }
    const s = await slateRect();
    await p.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, s.x), y: Math.max(0, s.y), width: Math.min(s.width, 1600 - s.x), height: Math.min(s.height, 900 - s.y), scale: 1 } }).then((shot) => fs.writeFileSync(path.join(A.out, `focus-${v.id}.png`), Buffer.from(shot.data, 'base64')));

    // ---------------------------------------------------------------- 5 per-frame cost (world turning)
    // the spiral does not turn by itself: drive the world (yaw drift every 50 ms, cursor one day back/forth every 300 ms) so the slate really follows it
    await p.eval(`(()=>{let dir=-1;let n=0;window.__drive=setInterval(()=>{const L=window.__holoLab;const c=L().camera;L.setView(c.yaw+0.004,c.pitch,c.dist);if(++n%6===0){L.moveCursor(dir);dir=-dir}},50);return true})()`);
    await p.eval('document.activeElement && document.activeElement.blur()');
    await p.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await p.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    await sleep(1000);
    const m0 = await metrics(); const l0 = JSON.parse(await p.eval('JSON.stringify(window.__holoLab())'));
    const T = 5;
    await sleep(T * 1000);
    const m1 = await metrics(); const l1 = JSON.parse(await p.eval('JSON.stringify(window.__holoLab())'));
    const d = (k) => (m1[k] ?? 0) - (m0[k] ?? 0);
    R.frameCost = {
      seconds: T, worldFrames: l1.frames - l0.frames,
      styleRecalcsPerSec: +(d('RecalcStyleCount') / T).toFixed(1), layoutsPerSec: +(d('LayoutCount') / T).toFixed(1),
      styleRecalcMsPerSec: +((d('RecalcStyleDuration') * 1000) / T).toFixed(2), layoutMsPerSec: +((d('LayoutDuration') * 1000) / T).toFixed(2), scriptMsPerSec: +((d('ScriptDuration') * 1000) / T).toFixed(1),
      slateWritesPerSec: +((l1.slate.stats.writes - l0.slate.stats.writes) / T).toFixed(1), styleMutationsPerSec: +((l1.slate.stats.styleMutations - l0.slate.stats.styleMutations) / T).toFixed(1),
    };

    // ---------------------------------------------------------------- 6 red lines
    R.redLines = await p.eval(`(()=>{
      const tf=(e)=>{const c=getComputedStyle(e);return {transform:c.transform,filter:c.filter,perspective:c.perspective}};
      const roots={html:tf(document.documentElement),body:tf(document.body),'#root':tf(document.getElementById('root')),'.holo-root':tf(document.querySelector('.holo-root'))};
      const chain=[];for(let e=document.querySelector('[data-holo=slate]');e&&e!==document.documentElement;e=e.parentElement){const c=tf(e);if(c.transform!=='none'||c.filter!=='none'||c.perspective!=='none')chain.push({node:e.tagName.toLowerCase()+(e.className&&typeof e.className==='string'?'.'+e.className.split(' ')[0]:''),...c})}
      return {roots,ancestorsOfSlateWithTransformOrFilter:chain,rootNodesClean:Object.values(roots).every(r=>r.transform==='none'&&r.filter==='none'&&r.perspective==='none')}})()`);
    await p.send('Emulation.setEmulatedMedia', { media: 'print' });
    await sleep(150);
    R.redLines.print = await p.eval(`(()=>{const q=(s)=>{const e=document.querySelector(s);if(!e)return '(none)';const r=e.getBoundingClientRect();return getComputedStyle(e).display+(r.width>0?' (still takes space)':' (no box)')};return {holoRoot:q('.holo-root'),slate:q('[data-holo=slate]'),hud:q('.holo-lab-hud'),css3dLayer:q('[data-holo=css3d]')}})()`);
    await p.send('Emulation.setEmulatedMedia', { media: '' });
    await p.send('Accessibility.enable').catch(() => {});
    const ax = await p.send('Accessibility.getFullAXTree').catch(() => ({ nodes: [] }));
    const roles = {};
    for (const n of ax.nodes) { if (n.ignored) continue; const r = n.role?.value; if (['textbox', 'combobox', 'button', 'form', 'canvas', 'img'].includes(r)) roles[r] = (roles[r] ?? 0) + 1; }
    R.redLines.accessibilityRoles = roles;
    await p.close();
  }
} finally {
  fs.writeFileSync(path.join(A.out, 'result.json'), JSON.stringify(report, null, 2));
  await browser.close();
}

// ---- summary
const f = (n) => (typeof n === 'number' ? n : '-');
console.log('\nvariant           | sharp p99 dpr1 / dpr1.5 (fixed crop) | hit rate in view by yaw (0.45,0,0.9,1.4,-0.6) | offscreen fraction by yaw | recalc/s layout/s mutations/s | root clean | print slate');
for (const [id, R] of Object.entries(report.variants)) {
  console.log(`${id.padEnd(17)} | ${f(R.sharpness.dpr1.p99)} / ${f(R.sharpness['dpr1.5'].p99)} | ${R.hit.map((r) => r.hitRateInView).join(' ')} | ${R.hit.map((r) => r.offscreenFraction).join(' ')} | ${R.frameCost.styleRecalcsPerSec} ${R.frameCost.layoutsPerSec} ${R.frameCost.styleMutationsPerSec} | ${R.redLines.rootNodesClean} | ${R.redLines.print.slate}`);
}
console.log(`\nfull result: ${path.join(A.out, 'result.json')}`);
