/*
 * CRT 管線（docs/os-mode-spec.md §4.2、§4.7）：場景先畫進低解析度離屏緩衝（最近鄰），
 * 兩次模糊（水平、垂直）做螢光暈開，最後一個全螢幕四邊形用自製片段著色器在裝置解析度合成。
 * 不使用後處理套件、沒有磷光殘影。
 * 強度（X2，zones.ts 的 A_ZONE）：關＝640×360、不做任何效果；標準＝640×360 ＋ 全部效果；濃＝426×240 ＋ 暈開／暗角／弧面約 1.5 倍。
 * 管線以強度為建構參數：切換強度＝丟掉舊管線（dispose 全部離屏緩衝）、建新的，不留舊的 render target。
 * 開機（§5.5）：setBoot 設定 B3 亮線與 B4 揭曉；setOverlay 把 BIOS 文字貼圖畫進場景緩衝（所以也會經過 CRT 效果）。
 */
import * as THREE from "three";
import type { CrtLevel } from "./settings";
import { BLUR_FRAG, CRT_FRAG, FULLSCREEN_VERT } from "./shaders";
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
    this.sceneRT = new THREE.WebGLRenderTarget(this.lowW, this.lowH, rtOpts(THREE.NearestFilter));
    this.rtA = new THREE.WebGLRenderTarget(this.lowW, this.lowH, rtOpts(THREE.LinearFilter));
    this.rtB = new THREE.WebGLRenderTarget(this.lowW, this.lowH, rtOpts(THREE.LinearFilter));

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
    (this.crtMat.uniforms.uLow!.value as THREE.Vector2).set(w, this.lowH);
  }

  /** 開機參數；null＝不在開機中（全部關閉）。 */
  setBoot(b: BootUniforms | null) {
    const u = this.crtMat.uniforms;
    u.uReveal!.value = b ? b.reveal : 1;
    u.uBand!.value = b ? b.band : -1;
    u.uBandW!.value = b ? b.bandW : 0;
    u.uLine!.value = b ? b.line : 0;
    u.uGlow!.value = b ? b.glow : 0;
  }

  /** 蓋滿整個場景緩衝的貼圖（BIOS 文字）；null＝不畫。貼圖由呼叫端擁有與釋放。 */
  setOverlay(tex: THREE.Texture | null) {
    this.overlayOn = tex !== null;
    this.overlayMat.map = tex;
    this.overlayMat.needsUpdate = true;
  }

  render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, aspect: number, time: number) {
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

    // 螢光暈開：兩次模糊（水平 → 垂直）
    if (this.bloomPass) {
      this.quad.material = this.blurMat;
      this.blurMat.uniforms.tSource!.value = this.sceneRT.texture;
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
    this.sceneRT.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
    this.blurMat.dispose();
    this.crtMat.dispose();
    this.quad.geometry.dispose();
    this.overlayMat.dispose();
    this.overlayMesh.geometry.dispose();
  }
}
