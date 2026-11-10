/*
 * 全像後處理（docs/holo-mode-spec.md §4.2；H1 雛形）。不使用後處理套件，也不經過 OS 的低解析度 CRT 管線：
 * 場景以原生解析度（DPR ≤ 1.5）畫進一張緩衝，一個全螢幕三角形著色器完成
 *   光暈（單次模糊：標準 4px、濃 8px，加色疊回）、掃描線（只疊在世界上：2px 週期、5% 強度）、偶發閃爍（亮度倍率）。
 * 景深霧在材質裡做（material.ts／spiralScene 的著色器），不在這裡。
 * 強度「關」時不建緩衝：呼叫端直接把場景畫到畫面上（只有線）。
 */
import * as THREE from "three";
import { SCAN_PERIOD_PX, type LevelParams } from "./level";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uBlur;      // 光暈半徑（device px）
uniform float uGlow;
uniform float uScan;
uniform float uScanPeriod; // device px
uniform float uFlicker;
uniform vec3 uPage;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  vec3 g = vec3(0.0);
  #if TAPS > 0
    for (int i = 0; i < TAPS; i++) {
      float a = float(i) * 2.39996323;
      float r = sqrt((float(i) + 0.5) / float(TAPS));
      vec2 o = vec2(cos(a), sin(a)) * r * uBlur / uRes;
      g += texture2D(tScene, vUv + o).rgb;
    }
    g /= float(TAPS);
  #endif
  vec3 col = c + g * uGlow;
  float line = step(uScanPeriod * 0.5, mod(gl_FragCoord.y, uScanPeriod));
  col *= 1.0 - uScan * line;
  gl_FragColor = vec4((uPage + col) * uFlicker, 1.0);
}`;

export class HoloPass {
  private rt: THREE.WebGLRenderTarget | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private readonly quad: THREE.Mesh;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly scene = new THREE.Scene();
  private taps = -1;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private params: LevelParams = { blurPx: 0, glow: 0, scan: 0, flicker: false, taps: 0 };
  private readonly page = new THREE.Color();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    pageColor: string,
  ) {
    this.page.set(pageColor);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(g);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  get enabled(): boolean {
    return this.params.taps > 0 || this.params.scan > 0 || this.params.flicker;
  }

  setSize(widthDevicePx: number, heightDevicePx: number, dpr: number): void {
    this.width = Math.max(1, Math.floor(widthDevicePx));
    this.height = Math.max(1, Math.floor(heightDevicePx));
    this.dpr = dpr;
    this.rt?.setSize(this.width, this.height);
  }

  setParams(p: LevelParams): void {
    this.params = p;
    if (!this.enabled) {
      this.releaseBuffers();
      return;
    }
    if (!this.rt) {
      this.rt = new THREE.WebGLRenderTarget(this.width, this.height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
    }
    if (this.taps !== p.taps || !this.material) {
      this.material?.dispose();
      this.material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        defines: { TAPS: p.taps },
        uniforms: {
          tScene: { value: this.rt.texture },
          uRes: { value: new THREE.Vector2(1, 1) },
          uBlur: { value: 0 },
          uGlow: { value: 0 },
          uScan: { value: 0 },
          uScanPeriod: { value: 2 },
          uFlicker: { value: 1 },
          uPage: { value: this.page },
        },
        depthTest: false,
        depthWrite: false,
      });
      this.quad.material = this.material;
      this.taps = p.taps;
    }
  }

  /** 把場景畫進（或繞過）緩衝並合成到畫面。flicker 是亮度倍率。 */
  render(scene: THREE.Scene, camera: THREE.Camera, flicker: number): void {
    const r = this.renderer;
    if (!this.enabled || !this.rt || !this.material) {
      r.setRenderTarget(null);
      r.setClearColor(this.page, 1);
      r.clear();
      r.render(scene, camera);
      return;
    }
    const u = this.material.uniforms;
    u.uRes!.value.set(this.width, this.height);
    u.uBlur!.value = this.params.blurPx * this.dpr;
    u.uGlow!.value = this.params.glow;
    u.uScan!.value = this.params.scan;
    u.uScanPeriod!.value = SCAN_PERIOD_PX * this.dpr;
    u.uFlicker!.value = flicker;
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }

  private releaseBuffers(): void {
    this.rt?.dispose();
    this.rt = null;
    this.material?.dispose();
    this.material = null;
    this.taps = -1;
  }

  dispose(): void {
    this.releaseBuffers();
    this.quad.geometry.dispose();
  }
}
