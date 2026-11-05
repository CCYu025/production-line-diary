/*
 * CRT 管線（docs/os-mode-spec.md §4.2、§4.7）：場景先畫進低解析度離屏緩衝（最近鄰），
 * 兩次模糊（水平、垂直）做螢光暈開，最後一個全螢幕四邊形用自製片段著色器在裝置解析度合成。
 * 不使用後處理套件。
 * 磷光殘影（X3，phosphor.ts）：場景緩衝與上一幀的合成結果在 PHOSPHOR_FRAG 合成進一組乒乓緩衝（accA／accB），CRT pass 讀合成結果；
 * 強度「關」、減少動態效果、本分頁被自動降級時不建這組緩衝；開機中（setBoot／setOverlay）與第一幀、暫停後一律不拖影。
 * 強度（X2，zones.ts 的 A_ZONE）：關＝640×360、不做任何效果；標準＝640×360 ＋ 全部效果；濃＝426×240 ＋ 暈開／暗角／弧面約 1.5 倍。
 * 管線以強度為建構參數：切換強度＝丟掉舊管線（dispose 全部離屏緩衝）、建新的，不留舊的 render target。
 * 開機（§5.5）：setBoot 設定 B3 亮線與 B4 揭曉；setOverlay 把 BIOS 文字貼圖畫進場景緩衝（所以也會經過 CRT 效果）。
 */
import * as THREE from "three";
import type { CrtLevel } from "./settings";
import { decayFactor, keepFor, needsReset } from "./phosphor";
import { BLUR_FRAG, CRT_FRAG, FULLSCREEN_VERT, PHOSPHOR_FRAG } from "./shaders";
import { A_ZONE, lowWidthFor } from "./zones";

// 向量線框的顏色直接用 CSS token 的 sRGB 值，不做色彩管理轉換（輸出到離屏緩衝再由 CRT 著色器合成）
THREE.ColorManagement.enabled = false;

export interface CrtOptions {
  pageColor: THREE.Color;
  /** 開機亮線的顏色（--accent 往白色混） */
  bandColor?: THREE.Color;
  level: CrtLevel;
  /** 驗證用降級開關（?osdebug=nobloom）：false＝不做暈開 */
  bloom?: boolean;
  flicker: boolean;
  /** 磷光殘影：false＝不建回饋緩衝（減少動態效果、被自動降級）。預設 true；強度「關」永遠沒有。 */
  phosphor?: boolean;
}

let liveTargets = 0;
/** 目前存活的離屏 render target 數（?osdebug=gldebug 驗證強度切換不洩漏用）。 */
export function liveRenderTargets(): number {
  return liveTargets;
}
function makeRT(w: number, h: number, opts: ConstructorParameters<typeof THREE.WebGLRenderTarget>[2]): THREE.WebGLRenderTarget {
  liveTargets++;
  return new THREE.WebGLRenderTarget(w, h, opts);
}

export interface BootUniforms {
  /** B4：0..1，>= 1 不遮 */
  reveal: number;
  /** B3：暗光柵半高（-1..1 座標單位），< 0 沒有 */
  band: number;
  /** 亮線與光柵的半寬 */
  bandW: number;
  /** 亮線亮度 0..1 */
  line: number;
  /** 暗光柵亮度（<= 亮線的 20%） */
  glow: number;
}

export class CrtPipeline {
  readonly level: CrtLevel;
  private sceneRT: THREE.WebGLRenderTarget;
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blurMat: THREE.ShaderMaterial;
  private crtMat: THREE.ShaderMaterial;
  private overlayScene = new THREE.Scene();
  private overlayMesh: THREE.Mesh;
  private overlayMat: THREE.MeshBasicMaterial;
  private overlayOn = false;
  private lowW: number;
  private readonly lowH: number;
  private bloomPass: boolean;
  private acc: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private accCur = 0;
  private phosphorMat: THREE.ShaderMaterial | null = null;
  private bootActive = false;
  private resetNext = true;
  private disposed = false;

  constructor(opts: CrtOptions) {
    this.level = opts.level;
    const zone = A_ZONE[opts.level];
    this.lowH = zone.lowHeight;
    this.lowW = zone.lowWidth16x9;
    this.bloomPass = zone.effects && zone.bloom > 0 && opts.bloom !== false;
    const rtOpts = (filter: THREE.MagnificationTextureFilter) => ({
      minFilter: filter,
      magFilter: filter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.sceneRT = makeRT(this.lowW, this.lowH, rtOpts(THREE.NearestFilter));
    this.rtA = makeRT(this.lowW, this.lowH, rtOpts(THREE.LinearFilter));
    this.rtB = makeRT(this.lowW, this.lowH, rtOpts(THREE.LinearFilter));

    if (opts.phosphor !== false && keepFor(opts.level) > 0) {
      this.acc = [makeRT(this.lowW, this.lowH, rtOpts(THREE.NearestFilter)), makeRT(this.lowW, this.lowH, rtOpts(THREE.NearestFilter))];
      this.phosphorMat = new THREE.ShaderMaterial({
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: PHOSPHOR_FRAG,
        uniforms: {
          tScene: { value: null },
          tPrev: { value: null },
          uPage: { value: new THREE.Vector3(opts.pageColor.r, opts.pageColor.g, opts.pageColor.b) },
          uKeep: { value: 0 },
        },
        depthTest: false,
        depthWrite: false,
      });
    }

    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: { tSource: { value: null }, uDir: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    const band = opts.bandColor ?? opts.pageColor;
    this.crtMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: CRT_FRAG,
      uniforms: {
        tScene: { value: this.sceneRT.texture },
        tBloom: { value: this.rtB.texture },
        uLow: { value: new THREE.Vector2(this.lowW, this.lowH) },
        uPage: { value: new THREE.Vector3(opts.pageColor.r, opts.pageColor.g, opts.pageColor.b) },
        uTime: { value: 0 },
        uEffects: { value: zone.effects ? 1 : 0 },
        uBloom: { value: this.bloomPass ? zone.bloom : 0 },
        uVignette: { value: zone.vignette },
        uBarrel: { value: zone.barrel },
        uFlicker: { value: opts.flicker && zone.effects ? 1 : 0 },
        uReveal: { value: 1 },
        uBand: { value: -1 },
        uBandW: { value: 0 },
        uLine: { value: 0 },
        uGlow: { value: 0 },
        uBandColor: { value: new THREE.Vector3(band.r, band.g, band.b) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.crtMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.overlayMat = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    this.overlayMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.overlayMat);
    this.overlayMesh.frustumCulled = false;
    this.overlayScene.add(this.overlayMesh);
  }

  /** 目前的低解析度尺寸（開機 BIOS 貼圖與 Line2 的 resolution 用）。 */
  get lowSize(): { width: number; height: number } {
    return { width: this.lowW, height: this.lowH };
  }

  /** 低解析度寬度依視窗長寬比決定（lowWidthFor；16:9 時剛好 640×360／426×240）。 */
  syncSize(aspect: number) {
    const w = lowWidthFor(this.level, aspect);
    if (w === this.lowW) return;
    this.lowW = w;
    this.sceneRT.setSize(w, this.lowH);
    this.rtA.setSize(w, this.lowH);
    this.rtB.setSize(w, this.lowH);
    if (this.acc) {
      this.acc[0].setSize(w, this.lowH);
      this.acc[1].setSize(w, this.lowH);
      this.resetNext = true; // 縮放清掉了緩衝內容
    }
    (this.crtMat.uniforms.uLow!.value as THREE.Vector2).set(w, this.lowH);
  }

  /** 開機參數；null＝不在開機中（全部關閉）。 */
  setBoot(b: BootUniforms | null) {
    if (this.bootActive && !b) this.resetNext = true;
    this.bootActive = b !== null;
    const u = this.crtMat.uniforms;
    u.uReveal!.value = b ? b.reveal : 1;
    u.uBand!.value = b ? b.band : -1;
    u.uBandW!.value = b ? b.bandW : 0;
    u.uLine!.value = b ? b.line : 0;
    u.uGlow!.value = b ? b.glow : 0;
  }

  /** 蓋滿整個場景緩衝的貼圖（BIOS 文字）；null＝不畫。貼圖由呼叫端擁有與釋放。 */
  setOverlay(tex: THREE.Texture | null) {
    if (this.overlayOn && !tex) this.resetNext = true;
    this.overlayOn = tex !== null;
    this.overlayMat.map = tex;
    this.overlayMat.needsUpdate = true;
  }

  /** 是否有回饋緩衝（除錯與測試用）。 */
  get hasPhosphor(): boolean {
    return this.acc !== null;
  }

  /**
   * dtMs：距上一幀的毫秒（磷光殘影依它換算，與 fps 無關）；省略或 > 250ms＝剛恢復繪製，這一幀不拖影。
   */
  render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, aspect: number, time: number, dtMs?: number) {
    this.syncSize(aspect);
    if (camera.aspect !== aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    gl.setRenderTarget(this.sceneRT);
    gl.render(scene, camera);
    if (this.overlayOn) {
      const prev = gl.autoClear;
      gl.autoClear = false;
      gl.render(this.overlayScene, this.quadCam);
      gl.autoClear = prev;
    }

    // 磷光殘影：場景與上一幀的合成結果合成進另一張緩衝；開機中不做（BIOS 文字與亮線要乾淨）
    let sceneTex = this.sceneRT.texture;
    if (this.acc && this.phosphorMat) {
      if (this.bootActive || this.overlayOn) {
        this.resetNext = true;
      } else {
        const keep = this.resetNext || needsReset(dtMs) ? 0 : decayFactor(keepFor(this.level), dtMs ?? 0);
        const next = 1 - this.accCur;
        this.phosphorMat.uniforms.tScene!.value = this.sceneRT.texture;
        this.phosphorMat.uniforms.tPrev!.value = this.acc[this.accCur]!.texture;
        this.phosphorMat.uniforms.uKeep!.value = keep;
        this.quad.material = this.phosphorMat;
        gl.setRenderTarget(this.acc[next]!);
        gl.render(this.quadScene, this.quadCam);
        this.accCur = next;
        this.resetNext = false;
        sceneTex = this.acc[next]!.texture;
      }
    }
    this.crtMat.uniforms.tScene!.value = sceneTex;

    // 螢光暈開：兩次模糊（水平 → 垂直）
    if (this.bloomPass) {
      this.quad.material = this.blurMat;
      this.blurMat.uniforms.tSource!.value = sceneTex;
      (this.blurMat.uniforms.uDir!.value as THREE.Vector2).set(1 / this.lowW, 0);
      gl.setRenderTarget(this.rtA);
      gl.render(this.quadScene, this.quadCam);
      this.blurMat.uniforms.tSource!.value = this.rtA.texture;
      (this.blurMat.uniforms.uDir!.value as THREE.Vector2).set(0, 1 / this.lowH);
      gl.setRenderTarget(this.rtB);
      gl.render(this.quadScene, this.quadCam);
    }

    this.quad.material = this.crtMat;
    this.crtMat.uniforms.uTime!.value = time;
    gl.setRenderTarget(null);
    gl.render(this.quadScene, this.quadCam);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const rts = [this.sceneRT, this.rtA, this.rtB, ...(this.acc ?? [])];
    for (const rt of rts) rt.dispose();
    liveTargets -= rts.length;
    this.acc = null;
    this.phosphorMat?.dispose();
    this.blurMat.dispose();
    this.crtMat.dispose();
    this.quad.geometry.dispose();
    this.overlayMat.dispose();
    this.overlayMesh.geometry.dispose();
  }
}
