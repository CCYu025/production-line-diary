/*
 * CRT 管線（docs/os-mode-spec.md §4.2、§4.7）：場景先畫進 640×360 的離屏緩衝（最近鄰），
 * 兩次模糊（水平、垂直）做螢光暈開，最後一個全螢幕四邊形用自製片段著色器在裝置解析度合成。
 * 不使用後處理套件、沒有磷光殘影。
 */
import * as THREE from "three";

// 向量線框的顏色直接用 CSS token 的 sRGB 值，不做色彩管理轉換（輸出到離屏緩衝再由 CRT 著色器合成）
THREE.ColorManagement.enabled = false;
import { BLUR_FRAG, CRT_FRAG, FULLSCREEN_VERT } from "./shaders";

export const LOW_HEIGHT = 360;

export interface CrtOptions {
  pageColor: THREE.Color;
  bloom: boolean;
  flicker: boolean;
}

export class CrtPipeline {
  private sceneRT: THREE.WebGLRenderTarget;
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blurMat: THREE.ShaderMaterial;
  private crtMat: THREE.ShaderMaterial;
  private lowW = 640;

  constructor(opts: CrtOptions) {
    const rtOpts = (filter: THREE.MagnificationTextureFilter) => ({
      minFilter: filter,
      magFilter: filter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.sceneRT = new THREE.WebGLRenderTarget(640, LOW_HEIGHT, rtOpts(THREE.NearestFilter));
    this.rtA = new THREE.WebGLRenderTarget(640, LOW_HEIGHT, rtOpts(THREE.LinearFilter));
    this.rtB = new THREE.WebGLRenderTarget(640, LOW_HEIGHT, rtOpts(THREE.LinearFilter));

    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: { tSource: { value: null }, uDir: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.crtMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: CRT_FRAG,
      uniforms: {
        tScene: { value: this.sceneRT.texture },
        tBloom: { value: this.rtB.texture },
        uLow: { value: new THREE.Vector2(640, LOW_HEIGHT) },
        uPage: { value: new THREE.Vector3(opts.pageColor.r, opts.pageColor.g, opts.pageColor.b) },
        uTime: { value: 0 },
        uBloom: { value: opts.bloom ? 1 : 0 },
        uFlicker: { value: opts.flicker ? 1 : 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.crtMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** 低解析度寬度依視窗長寬比決定（高度固定 360；16:9 時剛好 640×360）。 */
  private resize(aspect: number) {
    const w = Math.max(16, Math.round(LOW_HEIGHT * aspect));
    if (w === this.lowW) return;
    this.lowW = w;
    this.sceneRT.setSize(w, LOW_HEIGHT);
    this.rtA.setSize(w, LOW_HEIGHT);
    this.rtB.setSize(w, LOW_HEIGHT);
    (this.crtMat.uniforms.uLow!.value as THREE.Vector2).set(w, LOW_HEIGHT);
  }

  render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, aspect: number, time: number) {
    this.resize(aspect);
    if (camera.aspect !== aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    gl.setRenderTarget(this.sceneRT);
    gl.render(scene, camera);

    // 螢光暈開：兩次模糊（水平 → 垂直）
    if ((this.crtMat.uniforms.uBloom!.value as number) > 0) {
      this.quad.material = this.blurMat;
      this.blurMat.uniforms.tSource!.value = this.sceneRT.texture;
      (this.blurMat.uniforms.uDir!.value as THREE.Vector2).set(1 / this.lowW, 0);
      gl.setRenderTarget(this.rtA);
      gl.render(this.quadScene, this.quadCam);
      this.blurMat.uniforms.tSource!.value = this.rtA.texture;
      (this.blurMat.uniforms.uDir!.value as THREE.Vector2).set(0, 1 / LOW_HEIGHT);
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
  }
}
