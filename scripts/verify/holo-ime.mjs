// HF3 (automated part): Chinese IME composition inside the floating terminal slate of the H1 lab, while the world keeps moving (the spiral does not turn by itself: the script drives it - yaw drifts and the cursor flips one day back and forth, so the slate anchor, a card, keeps moving).
//   node scripts/verify/holo-ime.mjs --url http://localhost:3114/ [--methods proj,css3d] [--freeze 1,0] [--out dir] [--headless]
// Needs the LAB build (VITE_HOLO_LAB=1 npm run build) served by serve.mjs (scratch data; this script writes nothing).
// For every (method, freeze) combination it drives the real slate with CDP Input.imeSetComposition / insertText and key events:
//   C1  <input>   composition, Enter (plain Enter and IME-style key 229 "Process"), insert text  -> no dropped text, no submit, no stray commit
//   C2  <textarea> same, Enter must not add a newline while composing
//   C3  Combobox  composition, ArrowDown / ArrowUp / Enter / Escape -> no option picked, list not committed, value intact, no submit; two scenarios: text that matches no option (ㄈ) and text that matches options (F)
//   C4  sanity    Enter outside composition does submit (the checks above are not vacuous)
//   C5  world     the world really kept moving during composition (yaw and the anchor's screen position); slate position change during composition is reported
// What CDP cannot show: where the OS candidate window appears. That is part of the manual HF3 check (the user's Zhuyin session).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Browser, sleep } from './cdp.mjs';

const { values: A } = parseArgs({
  options: {
    url: { type: 'string' }, methods: { type: 'string', default: 'proj,css3d' }, freeze: { type: 'string', default: '1,0' }, drive: { type: 'string', default: '1' },
    out: { type: 'string', default: 'verify-out/holo-ime' }, headless: { type: 'boolean', default: false }, 'cdp-port': { type: 'string', default: '9631' }, help: { type: 'boolean', default: false },
  },
});
if (A.help || !A.url) { console.log('node scripts/verify/holo-ime.mjs --url http://localhost:3114/ [--methods proj,css3d] [--freeze 1,0] [--out dir] [--headless]'); process.exit(A.help ? 0 : 2); }
fs.mkdirSync(A.out, { recursive: true });
const base = A.url.replace(/\/?$/, '/');

const browser = await Browser.launch({ port: +A['cdp-port'], headless: A.headless });
const results = [];
let failed = 0;
let invalid = null;
/** bringToFront + focus emulation, then prove the field really takes IME input (document.hasFocus(), activeElement, and a probe composition that must fire compositionstart). Up to 3 tries, 200 ms apart. */
async function ensureFocused(p, id) {
  for (let i = 0; i < 3; i++) {
    try {
      await p.send('Page.bringToFront');
      await p.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await p.eval(`(()=>{const e=document.getElementById('${id}');window.__imeProbe=0;e.addEventListener('compositionstart',()=>{window.__imeProbe++},{once:true});e.focus();return true})()`);
      await sleep(200);
      const ok = await p.eval(`document.hasFocus() && document.activeElement === document.getElementById('${id}')`);
      if (ok) {
        await p.send('Input.imeSetComposition', { text: 'ㄅ', selectionStart: 1, selectionEnd: 1 });
        await sleep(100);
        const started = await p.eval('window.__imeProbe > 0');
        await p.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
        await sleep(100);
        await p.eval(`(()=>{const e=document.getElementById('${id}');e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
        if (started) return true;
      }
    } catch { /* retry */ }
    await sleep(200);
  }
  return false;
}
const record = (cfg, name, pass, evidence) => {
  results.push({ ...cfg, name, pass, evidence });
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'} [${cfg.method} freeze=${cfg.freeze}] ${name}  ${JSON.stringify(evidence)}`);
};

try {
  for (const method of A.methods.split(',')) {
    if (invalid) break;
    for (const freeze of A.freeze.split(',')) {
      const cfg = { method, freeze };
      const p = await browser.newPage({ width: 1600, height: 900 });
      await p.goto(`${base}#/_holo?slate=${method}&freeze=${freeze}&holodebug=1`, { settle: 800 });
      await p.waitFor('window.__holoLab && window.__holoLab().frames > 10', 15000);
      const lab = async () => JSON.parse(await p.eval('JSON.stringify(window.__holoLab())'));
      const fld = (id) => `document.getElementById('${id}')`;
      const val = (id) => p.eval(`${fld(id)}.value`);
      const focus = (id) => p.eval(`${fld(id)}.focus()`);
      const comp = (text) => p.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
      const commit = (text) => p.insertText(text);
      /** IME-style key: Chrome reports key "Process" / keyCode 229 for keys consumed by an IME */
      /** A key the IME is consuming reaches the page as keydown + keyup only (no keypress/char): do not use p.key('Enter'), which adds a char event. */
      const rawKey = async (key, code, vk) => {
        await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
        await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
      };
      const imeKey = async (code, vk) => {
        await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Process', code, windowsVirtualKeyCode: 229, nativeVirtualKeyCode: vk });
        await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: code, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
      };
      const rectOfSlate = () => p.eval(`(()=>{const r=document.querySelector('[data-holo="slate"]').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
      const submits = async () => (await lab()).slate.probe.submits;
      const keyEvents = async () => (await lab()).slate.probe.events.filter((e) => e.type === 'keydown');
      // Window-focus gate (H2-0): a fresh Chrome window that did not get OS focus swallows Input.imeSetComposition, which used to be judged as a product FAIL.
      // Not focused after 3 tries = INVALID (exit 2), never FAIL. The judging logic below is unchanged.
      if (!(await ensureFocused(p, 'holo-problem'))) { invalid = 'window not focused'; console.log(`INVALID: window not focused [${method} freeze=${freeze}]`); await p.close(); break; }
      await p.eval('window.__holoLab.resetProbe()'); // also wipes the probe composition the focus gate made
      const before = await lab();
      // drive the world: yaw drift every 50 ms; cursor one day back / forth every 300 ms (the slate anchor is the cursor's card, so it jumps and drifts)
      if (A.drive === '1') await p.eval(`(()=>{let dir=-1;let n=0;window.__drive=setInterval(()=>{const L=window.__holoLab;const c=L().camera;L.setView(c.yaw+0.004,c.pitch,c.dist);if(++n%6===0){L.moveCursor(dir);dir=-dir}},50);return true})()`);
      await sleep(300);
      const a0 = await p.eval('JSON.stringify(window.__holoLab.anchorScreen())').then(JSON.parse);
      await sleep(400);
      const a1 = await p.eval('JSON.stringify(window.__holoLab.anchorScreen())').then(JSON.parse);
      record(cfg, 'world is moving (script-driven yaw drift + cursor flips)', Math.hypot(a1.x - a0.x, a1.y - a0.y) > 1, { anchorMovedPx: +Math.hypot(a1.x - a0.x, a1.y - a0.y).toFixed(1) });

      // ---------- C1 <input>
      await focus('holo-problem');
      const yaw0 = (await lab()).camera.yaw;
      const anchor0 = await p.eval('JSON.stringify(window.__holoLab.anchorScreen())').then(JSON.parse);
      await comp('ㄋㄧˇ');
      await sleep(120); // the freeze applies from compositionstart on; measure the baseline only AFTER it took effect: a rect read before compositionstart can be
                        // one rendered frame older than the frozen position (css3d moves ~1px per frame while the world turns) and would look like movement
      const rect0 = await rectOfSlate();
      await sleep(580); // the world keeps moving while composing
      const mid = await lab();
      const rectMid = await rectOfSlate();
      await rawKey('Enter', 'Enter', 13);
      await sleep(80);
      await imeKey('Enter', 13);
      await sleep(80);
      await rawKey('ArrowDown', 'ArrowDown', 40);
      await sleep(80);
      const afterKeys = await lab();
      const vMid = await val('holo-problem');
      record(cfg, 'C1 composition text survives Enter / Process-Enter / ArrowDown while the world turns', vMid.includes('ㄋㄧˇ') && afterKeys.slate.probe.submits === 0, { value: vMid, submits: afterKeys.slate.probe.submits, composing: afterKeys.slate.probe.composing });
      const kd = (await keyEvents()).slice(-3);
      record(cfg, 'C1 info: Chrome flags key events during CDP composition (isComposing)', true, { keydowns: kd.map((e) => ({ key: e.key, keyCode: e.keyCode, isComposing: e.isComposing })) });
      await commit('你好');
      await sleep(100);
      const vAfter = await val('holo-problem');
      record(cfg, 'C1 commit replaces composition exactly (no dropped / doubled text)', vAfter === '你好', { value: vAfter });
      await comp('ㄕˋ');
      await sleep(150);
      await commit('世界');
      await sleep(100);
      const vTwo = await val('holo-problem');
      record(cfg, 'C1 second composition appends (no dropped text)', vTwo === '你好世界', { value: vTwo });
      const end1 = await lab();
      record(cfg, 'C1 no submit during composition', end1.slate.probe.submits === 0 && end1.slate.probe.compositions >= 2, { submits: end1.slate.probe.submits, compositions: end1.slate.probe.compositions });

      // ---------- C5 world moving / slate position during composition
      const yawMoved = Math.abs(mid.camera.yaw - yaw0);
      const slateMoved = Math.hypot(rectMid.x - rect0.x, rectMid.y - rect0.y);
      const anchor1 = await p.eval('JSON.stringify(window.__holoLab.anchorScreen())').then(JSON.parse);
      const anchorMoved = Math.hypot(anchor1.x - anchor0.x, anchor1.y - anchor0.y);
      record(cfg, 'C5 world kept moving during composition (camera yaw drifted, anchor moved on screen)', yawMoved > 0.01 && anchorMoved > 1, { yawDeltaRad: +yawMoved.toFixed(4), anchorMovedPx: +anchorMoved.toFixed(1) });
      record(cfg, `C5 slate position during composition (freeze=${freeze})`, freeze === '1' ? slateMoved < 0.5 : true, {
        slateMovedPx: +slateMoved.toFixed(2), frozenFrames: mid.slate.stats.frozenFrames, note: freeze === '1' ? 'expected frozen (< 0.5px)' : 'freeze disabled: movement is the observation, not a failure',
      });

      // ---------- C2 <textarea>
      await focus('holo-action');
      await comp('ㄏㄠˇ');
      await sleep(300);
      await rawKey('Enter', 'Enter', 13);
      await imeKey('Enter', 13);
      await sleep(80);
      const ta = await val('holo-action');
      record(cfg, 'C2 textarea: Enter while composing adds no newline and keeps the text', !ta.includes('\n') && ta.includes('ㄏㄠˇ'), { value: ta });
      await commit('好');
      await sleep(80);
      const ta2 = await val('holo-action');
      record(cfg, 'C2 textarea: commit', ta2 === '好', { value: ta2 });

      // ---------- C3 Combobox. Two scenarios: 'ㄈ' (matches no option) and 'F' (the composition text matches equipment options such as F3 / F4 / F7 / F8, so a Combobox that
      // wrongly acts on ArrowDown/Enter while composing would substitute an option). The second one is what makes the check able to see a missing isComposing guard (H2-0 L2).
      const OPTIONS = ['F3', 'F4', 'G5', 'G6', 'F7', 'F8', 'RB2', '原材區'];
      for (const [tag, text] of [['no-match', 'ㄈ'], ['matches-options', 'F']]) {
        await p.eval('window.__holoLab.resetProbe()');
        await p.eval(`(()=>{const e=${fld('holo-equipment')};e.focus();return true})()`);
        await sleep(120);
        await comp(text);
        await sleep(250);
        for (const [k, vk] of [['ArrowDown', 40], ['ArrowDown', 40], ['ArrowUp', 38]]) { await rawKey(k, k, vk); await sleep(60); }
        await rawKey('Enter', 'Enter', 13);
        await imeKey('Enter', 13);
        await rawKey('Escape', 'Escape', 27);
        await sleep(120);
        const cb = await p.eval(`(()=>{const e=${fld('holo-equipment')};return {value:e.value,active:document.activeElement===e,expanded:e.getAttribute('aria-expanded'),activedescendant:e.getAttribute('aria-activedescendant')||''}})()`);
        const cbSub = await submits();
        record(cfg, `C3 combobox [${tag}]: ArrowDown/Up/Enter/Escape during composition pick nothing, keep focus and text, no submit`,
          cb.value.includes(text) && !OPTIONS.includes(cb.value) && cb.active && cbSub === 0, { ...cb, typed: text, submits: cbSub });
        await commit(`設備X${tag === 'no-match' ? '' : 'Y'}`);
        await sleep(100);
        const cb2 = await val('holo-equipment');
        record(cfg, `C3 combobox [${tag}]: commit keeps exactly the typed text (no option substituted)`, cb2 === `設備X${tag === 'no-match' ? '' : 'Y'}`, { value: cb2, submits: await submits() });
        // empty the field for the next scenario (same trick as the focus gate; not part of any check)
        await p.eval(`(()=>{const e=${fld('holo-equipment')};e.focus();const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
        await sleep(80);
      }

      // ---------- C4 sanity
      await p.eval('window.__holoLab.resetProbe()');
      await focus('holo-problem');
      await p.key('Enter');
      await sleep(150);
      const sub = await submits();
      record(cfg, 'C4 sanity: Enter outside composition submits the form (checks above are not vacuous)', sub === 1, { submits: sub });
      await p.screenshot(path.join(A.out, `ime-${method}-freeze${freeze}.png`));
      await p.close();
    }
  }
} finally {
  fs.writeFileSync(path.join(A.out, 'result.json'), JSON.stringify({ url: A.url, results, failed, invalid }, null, 2));
  await browser.close();
}
console.log(failed ? `\nRESULT: FAIL (${failed} checks)` : invalid ? `\nRESULT: INVALID (${invalid})` : `\nRESULT: PASS (${results.length} checks)`);
process.exit(failed ? 1 : invalid ? 2 : 0);
