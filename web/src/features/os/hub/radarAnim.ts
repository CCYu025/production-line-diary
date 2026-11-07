/*
 * 雷達每幀動畫（X2）：只改顏色與不透明度（光點頂點色、ping 環與鎖定框的材質、警示外圈），不產生新幾何、不配置物件。
 * 純計算在 radar.ts（blipFrame、sweepCrossed…），這裡把結果套到 hubLines 預先建立的物件池上。
 */
import * as THREE from "three";
import type { ActiveAlert } from "./alerts";
import { topSeverity } from "./alerts";
import type { CrtLevel } from "../crt/settings";
import { blipLocal, type HubParts, LOCK_POOL, MAX_BLIPS, PULSE_POOL, SEGMENTS_PER_BLIP } from "./hubLines";
import { ALERT_RING_PERIOD_S, blipFrame, PING_MS, severityColorKey, SWEEP_OMEGA, sweepCrossed, TIER_PARAMS, tierOf, type Blip, type BlipColorKey, type BlipTier } from "./radar";

const PING_R0 = 0.1;
const PING_R1 = 0.6;
const LOCK_WIDTH = 2;
const LOCK_WIDTH_THICK = 4;
/**
 * 濃 CRT（426×240）下，標準大小的鎖定框只剩約 8 個粗像素、看起來是一團點：框放大成這個倍數，線寬也加粗 1 像素
 * （斜線在低解析度加掃描線下會斷成點，粗一點才連得起來、讀得出「框」）。標準與關不變。
 */
export const LOCK_SCALE_MAX = 1.6;
export const LOCK_WIDTH_MAX = 3;
export const LOCK_WIDTH_THICK_MAX = 5;

interface Item {
  angle: number;
  tier: BlipTier;
  base: THREE.Color;
  x: number;
  z: number;
  alert: boolean;
  lock: number;
  last: number;
}

export class RadarAnimator {
  private items: Item[] = [];
  private pingStart: number[] = Array.from({ length: PULSE_POOL }, () => -1);
  private prevSweep: number | null = null;
  private tmp = new THREE.Color();
  private ringColor = new THREE.Color();
  private ringOn = false;
  private lockScale = 1;
  private lockW = LOCK_WIDTH;
  private lockWThick = LOCK_WIDTH_THICK;

  constructor(
    private parts: HubParts,
    private page: THREE.Color,
    private colorOf: (k: BlipColorKey) => THREE.Color,
  ) {}

  /** CRT 強度改變時呼叫：濃＝鎖定框放大。 */
  setLevel(level: CrtLevel): void {
    this.lockScale = level === "max" ? LOCK_SCALE_MAX : 1;
    this.lockW = level === "max" ? LOCK_WIDTH_MAX : LOCK_WIDTH;
    this.lockWThick = level === "max" ? LOCK_WIDTH_THICK_MAX : LOCK_WIDTH_THICK;
    for (const lock of this.parts.radar.locks) lock.obj.scale.setScalar(this.lockScale);
  }

  /** 光點或警示改變時呼叫（不是每幀）：寫入光點位置、分配鎖定框、設定警示外圈顏色。 */
  set(blips: readonly Blip[], alerts: readonly ActiveAlert[]): void {
    const n = this.parts.setBlips(blips, this.colorOf);
    const alertMachines = new Set(alerts.map((a) => a.machine));
    this.items = [];
    for (let i = 0; i < n; i++) {
      const b = blips[i]!;
      const p = blipLocal(b);
      this.items.push({ angle: b.angle, tier: tierOf(b.colorKey), base: this.colorOf(b.colorKey).clone(), x: p.x, z: p.z, alert: alertMachines.has(b.machine), lock: -1, last: -1 });
    }
    // 鎖定框：重大光點優先，其次未確認警示的光點（減少動態效果時才會畫出來）
    let slot = 0;
    const assign = (pred: (it: Item) => boolean) => {
      for (const it of this.items) if (it.lock < 0 && pred(it) && slot < LOCK_POOL) it.lock = slot++;
    };
    assign((it) => TIER_PARAMS[it.tier].lock);
    assign((it) => it.alert);
    for (let k = 0; k < LOCK_POOL; k++) {
      const lock = this.parts.radar.locks[k]!;
      lock.obj.visible = false;
    }
    for (const it of this.items) {
      if (it.lock < 0) continue;
      const lock = this.parts.radar.locks[it.lock]!;
      lock.obj.position.x = it.x;
      lock.obj.position.z = it.z;
      lock.mat.color.copy(it.base);
    }
    const top = topSeverity(alerts);
    this.ringOn = top !== null;
    if (top !== null) {
      this.ringColor.copy(this.colorOf(severityColorKey(top)));
      this.parts.radar.alertRing.mat.color.copy(this.ringColor);
    } else {
      this.parts.radar.alertRing.obj.visible = false;
    }
  }

  /** 每幀：tSec＝時鐘秒數。reduced＝靜態（掃描停止、全部常亮、無 ping、無閃爍）。 */
  frame(tSec: number, reduced: boolean): void {
    const sweep = tSec * SWEEP_OMEGA;
    const radar = this.parts.radar;
    const col = radar.blips.geometry.getAttribute("color") as THREE.BufferAttribute;
    let dirty = false;
    for (let i = 0; i < this.items.length && i < MAX_BLIPS; i++) {
      const it = this.items[i]!;
      const f = blipFrame(it.tier, sweep, it.angle, it.alert, tSec, reduced);
      if (f.brightness !== it.last) {
        it.last = f.brightness;
        this.tmp.copy(this.page).lerp(it.base, f.brightness);
        for (let k = 0; k < SEGMENTS_PER_BLIP * 2; k++) col.setXYZ(i * SEGMENTS_PER_BLIP * 2 + k, this.tmp.r, this.tmp.g, this.tmp.b);
        dirty = true;
      }
      if (it.lock >= 0) {
        const lock = radar.locks[it.lock]!;
        lock.obj.visible = f.lock > 0.01;
        lock.mat.opacity = f.lock;
        const w = f.thick ? this.lockWThick : this.lockW;
        if (lock.mat.linewidth !== w) lock.mat.linewidth = w;
      }
      // ping：掃描線這一幀掃過方位角（嚴重／重大）
      if (!reduced && this.prevSweep !== null && TIER_PARAMS[it.tier].ping && sweepCrossed(this.prevSweep, sweep, it.angle)) {
        const free = this.pingStart.indexOf(-1);
        if (free >= 0) {
          this.pingStart[free] = tSec;
          const ring = radar.pulses[free]!;
          ring.ring.position.x = it.x;
          ring.ring.position.z = it.z;
          ring.mat.color.copy(it.base);
        }
      }
    }
    if (dirty) col.needsUpdate = true;
    this.prevSweep = reduced ? null : sweep;

    for (let k = 0; k < PULSE_POOL; k++) {
      const ring = radar.pulses[k]!;
      const start = this.pingStart[k]!;
      const x = start < 0 || reduced ? 1 : ((tSec - start) * 1000) / PING_MS;
      if (x >= 1 || x < 0) {
        if (ring.ring.visible) {
          ring.ring.visible = false;
          ring.mat.opacity = 0;
        }
        this.pingStart[k] = -1;
        continue;
      }
      ring.ring.visible = true;
      ring.ring.scale.setScalar(PING_R0 + (PING_R1 - PING_R0) * x);
      ring.mat.opacity = 1 - x;
    }

    const ar = radar.alertRing;
    if (this.ringOn) {
      ar.obj.visible = true;
      ar.mat.opacity = reduced ? 0.9 : 0.25 + 0.75 * (0.5 + 0.5 * Math.sin((tSec * Math.PI * 2) / ALERT_RING_PERIOD_S));
    }
  }
}
