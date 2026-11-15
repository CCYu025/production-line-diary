/*
 * 軌道鏡頭控制（docs/holo-mode-spec.md §5.4、§5.5；H1 雛形）。
 * 左鍵拖曳轉、滾輪縮（或交給呼叫端）、右鍵拖曳平移、R 回正。
 * 手勢規則：位移 ≥ 4px 才算拖曳；拖曳期間用 pointer capture；pointerup／pointercancel／lostpointercapture／視窗 blur／
 * 分頁變成 hidden 任何一種都算手勢結束，結束後一律清除拖曳狀態。慣性 ≤ 400ms，減少動態效果時沒有慣性。
 */
import * as THREE from "three";
import { clamp, DragTracker, INERTIA_MS, inertiaStep, panScale, rotated, VelocityTracker, zoomed, type OrbitLimits, type OrbitState, type Velocity } from "./orbit";

export interface RigConfig {
  limits: OrbitLimits;
  home: OrbitState;
  homeTarget: THREE.Vector3;
  fovDeg: number;
  /** 滾輪做什麼：zoom＝縮放；cursor＝交給 onWheel（螺旋的時間游標），這時 Ctrl＋滾輪才縮放 */
  wheelMode: "zoom" | "cursor";
}

export interface RigCallbacks {
  onClick?: (clientX: number, clientY: number) => void;
  onWheel?: (e: WheelEvent) => void;
  onKey?: (e: KeyboardEvent) => void;
}

const isTypingTarget = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.getAttribute("role") === "combobox";
};

export class OrbitRig {
  state: OrbitState;
  readonly target = new THREE.Vector3();
  /** 目標（平滑追隨）；沒有要追隨時等於 target */
  readonly goal = new THREE.Vector3();
  /** 自動緩轉（弧度／秒；0＝關） */
  autoRotate = 0;
  reducedMotion = false;
  /** 目前是否在拖曳（給外部讀；結束手勢一定清掉） */
  get dragging(): boolean {
    return this.drag.isDragging;
  }
  /** 平移鎖住 z（螺旋：z 由時間游標決定） */
  lockPanZ = false;
  /** 統計：手勢結束的次數（依原因），驗證用 */
  readonly endCounts: Record<string, number> = {};

  private readonly drag = new DragTracker();
  private readonly vel = new VelocityTracker();
  private inertiaV: Velocity = { yaw: 0, pitch: 0 };
  private inertiaLeft = 0;
  private viewportH = 1;
  private cleanup: Array<() => void> = [];

  constructor(
    private cfg: RigConfig,
    private cb: RigCallbacks = {},
  ) {
    this.state = { ...cfg.home };
    this.target.copy(cfg.homeTarget);
    this.goal.copy(cfg.homeTarget);
  }

  configure(cfg: RigConfig, cb: RigCallbacks = {}): void {
    this.cfg = cfg;
    this.cb = cb;
    this.reset();
  }

  setViewportHeight(h: number): void {
    this.viewportH = h;
  }

  reset(): void {
    this.state = { ...this.cfg.home };
    this.goal.copy(this.cfg.homeTarget);
    if (this.reducedMotion) this.target.copy(this.goal);
    this.inertiaLeft = 0;
  }

  attach(el: HTMLElement): void {
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return;
      this.drag.down(e.pointerId, e.clientX, e.clientY, e.button);
      this.inertiaLeft = 0;
      this.vel.reset();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* 沒有 pointer capture（測試環境）：照常運作，靠 blur／visibilitychange 收尾 */
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!this.drag.isActive || e.pointerId !== this.drag.pointerId) return;
      const r = this.drag.move(e.clientX, e.clientY);
      if (r.event === "none") return;
      if (this.drag.button === 2) this.pan(r.dx, r.dy);
      else {
        const prev = this.state;
        this.state = rotated(prev, r.dx, r.dy, this.cfg.limits);
        this.vel.push(performance.now(), this.state.yaw - prev.yaw, this.state.pitch - prev.pitch);
      }
    };
    const finish = (reason: string, e?: PointerEvent) => {
      const button = this.drag.button;
      const { wasDragging, wasActive } = this.drag.end();
      if (!wasActive) return;
      this.endCounts[reason] = (this.endCounts[reason] ?? 0) + 1;
      if (wasDragging && button !== 2) {
        this.inertiaV = this.vel.release(performance.now());
        this.inertiaLeft = this.reducedMotion ? 0 : INERTIA_MS;
      } else {
        this.vel.reset();
        if (!wasDragging && reason === "pointerup" && e && button === 0) this.cb.onClick?.(e.clientX, e.clientY);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== this.drag.pointerId) return;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      finish("pointerup", e);
    };
    const onCancel = () => finish("pointercancel");
    const onLost = () => finish("lostpointercapture");
    const onBlur = () => finish("blur");
    const onVis = () => {
      if (document.visibilityState === "hidden") finish("visibilitychange");
    };
    const onWheel = (e: WheelEvent) => {
      if (this.cfg.wheelMode === "cursor" && !e.ctrlKey) {
        e.preventDefault();
        this.cb.onWheel?.(e);
        return;
      }
      e.preventDefault();
      this.state = zoomed(this.state, e.deltaY, this.cfg.limits);
    };
    const onContext = (e: Event) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === "r" || e.key === "R") {
        this.reset();
        return;
      }
      this.cb.onKey?.(e);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    el.addEventListener("lostpointercapture", onLost);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onContext);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("keydown", onKey);
    this.cleanup.push(() => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("lostpointercapture", onLost);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onContext);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("keydown", onKey);
    });
  }

  detach(): void {
    for (const c of this.cleanup) c();
    this.cleanup = [];
    this.drag.end();
  }

  private pan(dxPx: number, dyPx: number): void {
    const s = panScale(this.state.dist, this.cfg.fovDeg, this.viewportH);
    const { yaw, pitch } = this.state;
    // 相機的右與上方向（世界座標）
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const up = new THREE.Vector3(-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch));
    const d = right.multiplyScalar(-dxPx * s).add(up.multiplyScalar(dyPx * s));
    if (this.lockPanZ) d.z = 0;
    this.goal.add(d);
    this.target.add(d);
  }

  /** 每幀：慣性、自動緩轉、目標平滑追隨 */
  step(dtMs: number): void {
    if (!this.drag.isDragging) {
      if (this.inertiaLeft > 0) {
        const r = inertiaStep(this.inertiaV, this.inertiaLeft, dtMs, this.reducedMotion);
        this.state = { ...this.state, yaw: this.state.yaw + r.dYaw, pitch: clamp(this.state.pitch + r.dPitch, this.cfg.limits.minPitch, this.cfg.limits.maxPitch) };
        this.inertiaLeft = r.remainingMs;
      } else if (this.autoRotate && !this.reducedMotion) {
        this.state = { ...this.state, yaw: this.state.yaw + this.autoRotate * (dtMs / 1000) };
      }
    }
    if (this.reducedMotion) this.target.copy(this.goal);
    else {
      const k = 1 - Math.exp(-dtMs / 120);
      this.target.lerp(this.goal, k);
    }
  }

  applyTo(camera: THREE.PerspectiveCamera): void {
    const { yaw, pitch, dist } = this.state;
    camera.position.set(
      this.target.x + dist * Math.sin(yaw) * Math.cos(pitch),
      this.target.y + dist * Math.sin(pitch),
      this.target.z + dist * Math.cos(yaw) * Math.cos(pitch),
    );
    camera.lookAt(this.target);
  }
}
