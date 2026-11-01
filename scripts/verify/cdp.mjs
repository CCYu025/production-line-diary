// Minimal CDP driver (no deps). Node 22+ global WebSocket / fetch.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Browser {
  /**
   * @param {object} o
   * @param {number} [o.port] remote debugging port
   * @param {string} [o.userDataDir] default: fresh temp dir
   * @param {boolean} [o.headless=true] false => headed window, hardware GPU (no --disable-gpu / swiftshader flags)
   * @param {string[]} [o.args]
   */
  static async launch({ port = 9333, userDataDir, headless = true, args = [] } = {}) {
    const b = new Browser();
    userDataDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'pld-cdp-'));
    fs.mkdirSync(userDataDir, { recursive: true });
    b.headless = headless;
    const flags = [
      `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`,
      '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--remote-allow-origins=*',
    ];
    if (headless) flags.unshift('--headless=new');
    flags.push('about:blank', ...args);
    b.proc = spawn(CHROME, flags, { stdio: 'ignore' });
    let ver;
    for (let i = 0; i < 100; i++) {
      try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(100); }
    }
    if (!ver) throw new Error('chrome did not start');
    b.ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((res, rej) => { b.ws.onopen = res; b.ws.onerror = rej; });
    b.id = 0; b.pending = new Map(); b.handlers = [];
    b.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && b.pending.has(m.id)) { const { res, rej } = b.pending.get(m.id); b.pending.delete(m.id); m.error ? rej(new Error(m.error.message + ' ' + JSON.stringify(m.error))) : res(m.result); }
      else if (m.method) for (const h of b.handlers) h(m);
    };
    b.version = ver.Browser;
    return b;
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error('CDP timeout ' + method)); }, 30000);
      this.pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
    });
  }
  async newPage({ width = 1280, height = 900, scheme = 'light', media = 'screen', context = true, url = 'about:blank', mobile = false, preScripts = [] } = {}) {
    let browserContextId;
    if (context) browserContextId = (await this.send('Target.createBrowserContext', { disposeOnDetach: true })).browserContextId;
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const p = new Page(this, sessionId, targetId, browserContextId);
    await p.send('Page.enable'); await p.send('Runtime.enable'); await p.send('Network.enable'); await p.send('DOM.enable');
    await p.setViewport(width, height, mobile);
    await p.setMedia(scheme, media);
    for (const s of preScripts) await p.addInitScript(s);
    if (url !== 'about:blank') await p.goto(url);
    return p;
  }
  async close() {
    try { await this.send('Browser.close'); } catch {}
    await sleep(300);
    try { this.proc.kill(); } catch {}
  }
}

const KEYS = {
  Tab: [9, 'Tab'], Enter: [13, 'Enter'], ' ': [32, 'Space'], Space: [32, 'Space'], Escape: [27, 'Escape'],
  ArrowDown: [40, 'ArrowDown'], ArrowUp: [38, 'ArrowUp'], ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'],
};
const keyInfo = (key) => KEYS[key] ?? [key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0, key.length === 1 ? 'Key' + key.toUpperCase() : key];

export class Page {
  constructor(b, sessionId, targetId, ctx) {
    this.b = b; this.sid = sessionId; this.targetId = targetId; this.ctx = ctx; this.console = []; this.listeners = [];
    b.handlers.push((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.consoleAPICalled') this.console.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description).join(' ') });
      if (m.method === 'Runtime.exceptionThrown') this.console.push({ type: 'exception', text: m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description ?? '') });
      for (const l of this.listeners) l(m);
    });
  }
  send(method, params) { return this.b.send(method, params, this.sid); }
  async setViewport(width, height, mobile = false) {
    this.w = width; this.h = height;
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  }
  async setMedia(scheme, media = 'screen', extra = []) {
    await this.send('Emulation.setEmulatedMedia', { media: media === 'screen' ? '' : media, features: [{ name: 'prefers-color-scheme', value: scheme }, ...extra] });
  }
  /** Run `src` (JS source string) in every new document before page scripts. */
  async addInitScript(src) { return this.send('Page.addScriptToEvaluateOnNewDocument', { source: src }); }
  /** rate 1 = none, 4 = 4x slowdown. */
  async throttleCPU(rate = 1) { await this.send('Emulation.setCPUThrottlingRate', { rate }); }
  /** Returns UNMASKED_RENDERER_WEBGL string ('no-webgl' if unavailable). */
  async webglRenderer() {
    return this.eval(`(()=>{const c=document.createElement('canvas');const gl=c.getContext('webgl2')||c.getContext('webgl');if(!gl)return 'no-webgl';
      const e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):('masked:'+gl.getParameter(gl.RENDERER));})()`);
  }
  async goto(url, { settle = 600 } = {}) {
    await this.send('Page.navigate', { url });
    await this.waitLoad();
    await this.settle(settle);
  }
  async waitLoad() {
    for (let i = 0; i < 200; i++) { const r = await this.eval('document.readyState').catch(() => null); if (r === 'complete') break; await sleep(50); }
  }
  async settle(ms = 600) {
    await this.eval('document.fonts.ready.then(()=>true)', true);
    await sleep(ms);
    await this.eval('document.fonts.ready.then(()=>true)', true);
  }
  async eval(expr, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text) + '\n' + expr.slice(0, 200));
    return r.result.value;
  }
  async waitFor(expr, timeout = 8000, interval = 60) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { if (await this.eval(`!!(${expr})`)) return true; await sleep(interval); }
    throw new Error('waitFor timeout: ' + expr);
  }
  async screenshot(file, clip) {
    const params = { format: 'png', captureBeyondViewport: false };
    if (clip) params.clip = { ...clip, scale: 1 };
    const r = await this.send('Page.captureScreenshot', params);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
  async keyDown(key, { modifiers = 0 } = {}) {
    const [k, c] = keyInfo(key);
    const base = { key: key === 'Space' ? ' ' : key, code: c, windowsVirtualKeyCode: k, nativeVirtualKeyCode: k, modifiers };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    if (key === 'Enter') await this.send('Input.dispatchKeyEvent', { type: 'char', ...base, text: '\r' });
    else if (key === ' ' || key === 'Space') await this.send('Input.dispatchKeyEvent', { type: 'char', ...base, text: ' ' });
  }
  async keyUp(key, { modifiers = 0 } = {}) {
    const [k, c] = keyInfo(key);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: key === 'Space' ? ' ' : key, code: c, windowsVirtualKeyCode: k, nativeVirtualKeyCode: k, modifiers });
  }
  /** Full key gesture (keydown + char + keyup). */
  async key(key, opts = {}) { await this.keyDown(key, opts); await this.keyUp(key, opts); }
  async pressKey(key, opts = {}) { return this.key(key, opts); }
  async mouseMove(x, y) { await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); }
  async mouseDown(x, y, { button = 'left', clickCount = 1 } = {}) { await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount }); }
  async mouseUp(x, y, { button = 'left', clickCount = 1 } = {}) { await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount }); }
  async click(x, y) {
    await this.mouseMove(x, y);
    await this.mouseDown(x, y);
    await this.mouseUp(x, y);
  }
  async rectOf(selExpr) { // selExpr: JS expression returning an Element
    return this.eval(`(()=>{const e=(${selExpr});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  }
  async clickEl(selExpr) { const r = await this.rectOf(selExpr); if (!r) throw new Error('no el ' + selExpr); await this.click(r.x + r.width / 2, r.y + r.height / 2); }
  async close() {
    try { await this.b.send('Target.closeTarget', { targetId: this.targetId }); } catch {}
    if (this.ctx) try { await this.b.send('Target.disposeBrowserContext', { browserContextId: this.ctx }); } catch {}
  }
}

export const TOGGLE_FIND = `[...document.querySelectorAll('button[aria-pressed]')].filter(b=>/CYBER/.test(b.textContent||'')||b.getAttribute('aria-label')==='CYBER 介面').find(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.height>0})`;
