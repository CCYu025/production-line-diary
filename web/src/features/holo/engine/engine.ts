/*
 * 全像引擎（H1 雛形）：原生 three（不經過 r3f）的世界迴圈。
 *   renderer（原生解析度、DPR ≤ 1.5）＋ 透視鏡頭 ＋ OrbitRig ＋ HoloPass ＋ 一個「世界」（時間螺旋）。
 * 強度讀 pld.os.crt（getCrtLevel／subscribeCrt）；網址覆寫只在這次載入有效，不寫入偏好。
 * 迴圈只在分頁可見時由 rAF 驅動（瀏覽器對隱藏分頁本來就暫停 rAF）。
 */
import * as THREE from "three";
import { getCrtLevel, subscribeCrt, type CrtLevel } from "@/features/os/crt/settings";
import { OrbitRig, type RigCallbacks, type RigConfig } from "./controls";
import { HoloPass } from "./holoPass";
import { ReducedMotionSource } from "./reducedMotion";
import { effectiveDpr, FlickerClock, levelParams } from "./level";
import { HoloMaterials } from "./material";
import { readHoloColors, type HoloColors } from "./tokens";

THREE.ColorManagement.enabled = false;

export const CAMERA_FOV = 45;

/** 一個世界（場景模組）：engine 負責迴圈與渲染，世界負責內容。 */
export interface HoloWorld {
  root: THREE.Object3D;
  /** 景深霧：[近, 遠]（最遠保留 15% 亮度） */
  fog: [number, number];
  update?(dtMs: number, nowMs: number): void;
  dispose(): void;
}

export interface EngineOptions {
  host: HTMLElement;
  levelOverride?: CrtLevel | null;
  onContextLost?: () => void;
}

export interface FrameStats {
  frames: number;
  /** 第一幀完成的時間（performance.now()，從導覽開始起算） */
  firstFrameAt: number | null;
}

export class HoloEngine {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 4000);
  readonly scene = new THREE.Scene();
  readonly rig: OrbitRig;
  readonly materials = new HoloMaterials();
  readonly colors: HoloColors;
  readonly stats: FrameStats = { frames: 0, firstFrameAt: null };

  private readonly pass: HoloPass;
  private world: HoloWorld | null = null;
  private raf = 0;
  private last = 0;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private level: CrtLevel;
  private readonly flicker = new FlickerClock();
  private readonly reducedSource = new ReducedMotionSource();
  private unsubReduced: () => void;
  private readonly frameCbs = new Set<(nowMs: number) => void>();
  private readonly ro: ResizeObserver;
  private unsubCrt: () => void;
  private disposed = false;

  constructor(private readonly opts: EngineOptions) {
    this.colors = readHoloColors();
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    // 一幀會畫兩次（場景進緩衝、合成到畫面）：統計手動歸零，renderer.info 才是「一整幀」的數字
    this.renderer.info.autoReset = false;
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.dataset.holo = "canvas";
    this.canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none";
    opts.host.appendChild(this.canvas);
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      opts.onContextLost?.();
    });

    this.pass = new HoloPass(this.renderer, this.colors.page);
    this.level = opts.levelOverride ?? getCrtLevel();
    this.rig = new OrbitRig(
      { limits: { minDist: 1, maxDist: 100, minPitch: -0.3, maxPitch: 1.3 }, home: { yaw: 0, pitch: 0.3, dist: 20 }, homeTarget: new THREE.Vector3(), fovDeg: CAMERA_FOV, wheelMode: "zoom" },
      {},
    );
    this.rig.attach(this.canvas);
    this.applyLevel();
    this.unsubCrt = opts.levelOverride ? () => {} : subscribeCrt(() => this.setLevel(getCrtLevel()));
    this.unsubReduced = this.reducedSource.subscribe(this.onReducedChange);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(opts.host);
    this.resize();
  }

  /** 減少動態效果：唯一來源是 ReducedMotionSource（只由 change 事件更新，不每幀讀 mql.matches） */
  get reducedMotion(): boolean {
    return this.reducedSource.matches;
  }
  /** 場景內隨時間流動的效果現在是否該動（減少動態效果或強度「關」時為 false） */
  get animating(): boolean {
    return levelParams(this.level, this.reducedMotion).animate;
  }
  get currentLevel(): CrtLevel {
    return this.level;
  }
  get size(): { width: number; height: number; dpr: number } {
    return { width: this.cssW, height: this.cssH, dpr: this.dpr };
  }

  private onReducedChange = () => {
    this.rig.reducedMotion = this.reducedMotion;
    this.applyLevel();
  };

  private applyLevel(): void {
    this.rig.reducedMotion = this.reducedMotion;
    this.pass.setParams(levelParams(this.level, this.reducedMotion));
  }

  setLevel(level: CrtLevel): void {
    if (level === this.level) return;
    this.level = level;
    this.applyLevel();
  }

  /** 設定場景的軌道鏡頭（每個世界自己的範圍與預設視角） */
  configureRig(cfg: Omit<RigConfig, "fovDeg">, cb: RigCallbacks): void {
    this.rig.configure({ ...cfg, fovDeg: CAMERA_FOV }, cb);
  }

  setWorld(w: HoloWorld | null): void {
    if (this.world) {
      this.scene.remove(this.world.root);
      this.world.dispose();
    }
    this.world = w;
    if (w) {
      this.scene.add(w.root);
      this.scene.fog = new THREE.Fog(0x000000, w.fog[0], w.fog[1]);
    } else this.scene.fog = null;
  }

  onFrame(cb: (nowMs: number) => void): () => void {
    this.frameCbs.add(cb);
    return () => {
      this.frameCbs.delete(cb);
    };
  }

  /** 世界座標 → 畫面座標（CSS px，相對於 host 左上角）；在鏡頭後方回傳 behind: true */
  project(v: THREE.Vector3, out: { x: number; y: number; behind: boolean } = { x: 0, y: 0, behind: false }): { x: number; y: number; behind: boolean } {
    const p = v.clone().project(this.camera);
    out.x = (p.x * 0.5 + 0.5) * this.cssW;
    out.y = (-p.y * 0.5 + 0.5) * this.cssH;
    out.behind = p.z > 1;
    return out;
  }

  start(): void {
    if (this.raf || this.disposed) return;
    this.last = performance.now();
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private resize(): void {
    const rect = this.opts.host.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = effectiveDpr(window.devicePixelRatio);
    if (w === this.cssW && h === this.cssH && dpr === this.dpr && this.stats.frames > 0) return;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    const dw = Math.floor(w * dpr);
    const dh = Math.floor(h * dpr);
    this.pass.setSize(dw, dh, dpr);
    this.materials.setSize(dw, dh, dpr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.rig.setViewportHeight(h);
  }

  private frame(t: number): void {
    if (window.devicePixelRatio && effectiveDpr(window.devicePixelRatio) !== this.dpr) this.resize();
    const dt = Math.min(100, Math.max(0, t - this.last));
    this.last = t;
    this.renderer.info.reset();
    this.rig.step(dt);
    this.world?.update?.(dt, t);
    this.rig.applyTo(this.camera);
    this.camera.updateMatrixWorld();
    const lp = levelParams(this.level, this.reducedMotion);
    this.pass.render(this.scene, this.camera, this.flicker.factor(t, lp.flicker));
    this.stats.frames++;
    if (this.stats.firstFrameAt === null) this.stats.firstFrameAt = performance.now();
    for (const cb of Array.from(this.frameCbs)) cb(t);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.unsubCrt();
    this.unsubReduced();
    this.reducedSource.dispose();
    this.ro.disconnect();
    this.rig.detach();
    this.setWorld(null);
    this.pass.dispose();
    this.materials.dispose();
    this.frameCbs.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
