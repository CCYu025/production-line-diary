import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ActiveAlert } from "./alerts";
import { buildHubLines, countSegments, HUB_SEGMENT_CAP, LOCK_POOL } from "./hubLines";
import {
  blinkLevel,
  blipBrightness,
  blipFrame,
  phosphor,
  secondsSinceSweep,
  severityColorKey,
  sweepCrossed,
  SWEEP_OMEGA,
  TIER_PARAMS,
  tierOf,
  type Blip,
  type BlipColorKey,
} from "./radar";
import { RadarAnimator } from "./radarAnim";

const TWO_PI = Math.PI * 2;

describe("PPI 雷達：磷光衰減", () => {
  it("secondsSinceSweep：掃描線剛過＝0；落後角度／ω；超過一圈包裹", () => {
    expect(secondsSinceSweep(1, 1)).toBeCloseTo(0);
    expect(secondsSinceSweep(1 + SWEEP_OMEGA * 0.5, 1)).toBeCloseTo(0.5);
    expect(secondsSinceSweep(0.1, 0.2)).toBeCloseTo((TWO_PI - 0.1) / SWEEP_OMEGA);
    expect(secondsSinceSweep(TWO_PI * 3 + 1.5, 1.5)).toBeCloseTo(0);
  });
  it("phosphor：峰值 1、tau 處 1/e、約 1.3s 幾乎消失", () => {
    expect(phosphor(0, 0.45)).toBe(1);
    expect(phosphor(0.45, 0.45)).toBeCloseTo(Math.exp(-1));
    expect(phosphor(1.3, 0.45)).toBeLessThan(0.06);
  });
  it("normal 光點：被掃過那刻 1，之後單調下降，兩次掃描之間完全看不見", () => {
    const b = (t: number) => blipBrightness("normal", 2 + t * SWEEP_OMEGA, 2);
    expect(b(0)).toBeCloseTo(1);
    expect(b(0.2)).toBeGreaterThan(b(0.5));
    expect(b(0.5)).toBeGreaterThan(b(1));
    expect(b(1.3)).toBeLessThan(0.06);
    expect(b(2.5)).toBe(0);
    expect(b(3.9)).toBe(0);
  });
  it("分級：已解決 tau 0.3 衰減較快且間隔期不可見；嚴重／重大有 15% 底光", () => {
    const at = (tier: Parameters<typeof blipBrightness>[0], t: number) => blipBrightness(tier, t * SWEEP_OMEGA, 0);
    expect(at("resolved", 0.45)).toBeLessThan(at("normal", 0.45));
    expect(at("resolved", 2.5)).toBe(0);
    expect(at("serious", 2.5)).toBeCloseTo(0.15);
    expect(at("critical", 3.5)).toBeCloseTo(0.15);
    expect(at("serious", 0)).toBeCloseTo(1);
    expect(TIER_PARAMS.resolved.tau).toBe(0.3);
  });
  it("tierOf 與分級參數；severityColorKey", () => {
    expect(tierOf("dim")).toBe("resolved");
    expect(tierOf("good")).toBe("normal");
    expect(tierOf("warning")).toBe("normal");
    expect(tierOf("serious")).toBe("serious");
    expect(tierOf("critical")).toBe("critical");
    expect(TIER_PARAMS.serious.ping && !TIER_PARAMS.serious.lock).toBe(true);
    expect(TIER_PARAMS.critical.ping && TIER_PARAMS.critical.lock).toBe(true);
    expect(TIER_PARAMS.normal.ping || TIER_PARAMS.resolved.ping).toBe(false);
    expect(severityColorKey("重大")).toBe("critical");
    expect(severityColorKey("輕微")).toBe("good");
  });
  it("sweepCrossed：這一幀掃過方位角；環繞 2π；間隔超過半圈不算", () => {
    expect(sweepCrossed(0.9, 1.1, 1)).toBe(true);
    expect(sweepCrossed(0.9, 1.1, 1.2)).toBe(false);
    expect(sweepCrossed(6.2, 6.4, 0.05)).toBe(true);
    expect(sweepCrossed(0, 4, 2)).toBe(false);
  });
  it("blinkLevel：柔和（有中間值）、在 lo..1 之間、週期正確", () => {
    const vals = Array.from({ length: 200 }, (_, i) => blinkLevel(i / 200, 2, 0.1));
    expect(Math.min(...vals)).toBeCloseTo(0.1);
    expect(Math.max(...vals)).toBeCloseTo(1);
    expect(vals.some((v) => v > 0.2 && v < 0.9)).toBe(true);
    expect(blinkLevel(0.125, 2, 0)).toBeCloseTo(blinkLevel(0.625, 2, 0));
  });
  it("blipFrame：未確認警示在兩次掃描之間也看得見並閃爍；重大的鎖定框 1Hz 閃爍", () => {
    expect(blipFrame("normal", 0, 3, false, 0.3, false).brightness).toBe(0);
    const seen = Array.from({ length: 50 }, (_, i) => blipFrame("normal", 0, 3, true, i * 0.01, false).brightness);
    expect(Math.max(...seen)).toBeGreaterThan(0.9);
    expect(Math.min(...seen)).toBeLessThan(0.3);
    expect(blipFrame("normal", 0, 3, false, 0, false).lock).toBe(0);
    const locks = Array.from({ length: 100 }, (_, i) => blipFrame("critical", 0, 3, false, i * 0.01, false).lock);
    expect(Math.max(...locks)).toBeGreaterThan(0.9);
    expect(Math.min(...locks)).toBeLessThan(0.3);
  });
  it("減少動態效果：全部常亮、不閃爍；重大常亮鎖定框；未確認警示＝較粗的常亮框", () => {
    for (const t of [0, 0.1, 0.37, 2.2]) {
      for (const tier of ["resolved", "normal", "serious", "critical"] as const) {
        const f = blipFrame(tier, t * 3, 1, false, t, true);
        expect(f).toEqual({ brightness: 1, lock: tier === "critical" ? 1 : 0, thick: false });
      }
      expect(blipFrame("normal", t, 1, true, t, true)).toEqual({ brightness: 1, lock: 1, thick: true });
    }
  });
});

const colors = { floor: "#2c4054", housing: "#2c4054", outline: "#2c4054", accent: "#22e6ff", ringDim: "#14202c", ringStrong: "#2c4054", page: "#05080c" };
const palette: Record<BlipColorKey, THREE.Color> = {
  good: new THREE.Color("#00ff00"),
  warning: new THREE.Color("#ffaa00"),
  serious: new THREE.Color("#ff6600"),
  critical: new THREE.Color("#ff0000"),
  dim: new THREE.Color("#556677"),
};
const blip = (machine: string, colorKey: BlipColorKey, angle: number): Blip => ({ machine, angle, radius: 0.6, colorKey, count: 1 });

function setup(blips: Blip[], alerts: ActiveAlert[] = []) {
  const parts = buildHubLines(colors);
  const anim = new RadarAnimator(parts, new THREE.Color(colors.page), (k) => palette[k]);
  anim.set(blips, alerts);
  return { parts, anim };
}
const vertexRed = (parts: ReturnType<typeof buildHubLines>, blipIndex: number) => (parts.radar.blips.geometry.getAttribute("color") as THREE.BufferAttribute).getX(blipIndex * 10);

describe("RadarAnimator（只動顏色與不透明度）", () => {
  it("掃描線掃過 serious 光點：產生 ping 環，約 500ms 後消失；normal 光點不產生", () => {
    const { parts, anim } = setup([blip("A", "serious", 1), blip("B", "warning", 1)]);
    const tAt = (a: number) => a / SWEEP_OMEGA;
    anim.frame(tAt(0.9), false);
    expect(parts.radar.pulses.filter((p) => p.ring.visible)).toHaveLength(0);
    anim.frame(tAt(1.05), false);
    expect(parts.radar.pulses.filter((p) => p.ring.visible)).toHaveLength(1);
    anim.frame(tAt(1.05) + 0.6, false);
    expect(parts.radar.pulses.filter((p) => p.ring.visible)).toHaveLength(0);
  });
  it("重大光點有鎖定框且閃爍；減少動態效果時常亮、沒有 ping、沒有閃爍", () => {
    const { parts, anim } = setup([blip("A", "critical", 1)]);
    const lock = parts.radar.locks[0]!;
    const ops = new Set<number>();
    for (let i = 0; i < 40; i++) {
      anim.frame(5 + i * 0.025, false);
      ops.add(Math.round(lock.mat.opacity * 100));
    }
    expect(ops.size).toBeGreaterThan(3);
    anim.frame(10, true);
    expect(lock.obj.visible && lock.mat.opacity === 1).toBe(true);
    anim.frame(10.01, true);
    expect(parts.radar.pulses.every((p) => !p.ring.visible)).toBe(true);
    expect(vertexRed(parts, 0)).toBeCloseTo(palette.critical.r);
  });
  it("未確認警示：外圈用最嚴重的顏色；減少動態效果時外圈常亮、框加粗；沒有警示時外圈隱藏", () => {
    const alerts: ActiveAlert[] = [
      { id: 1, machine: "A", severity: "輕微" },
      { id: 2, machine: "B", severity: "嚴重" },
    ];
    const { parts, anim } = setup([blip("A", "good", 0.5), blip("B", "serious", 2)], alerts);
    anim.frame(1, true);
    const ring = parts.radar.alertRing;
    expect(ring.obj.visible).toBe(true);
    expect(ring.mat.color.equals(palette.serious)).toBe(true);
    expect(ring.mat.opacity).toBeCloseTo(0.9);
    const lockA = parts.radar.locks.find((l) => l.obj.visible && l.mat.color.equals(palette.good))!;
    expect(lockA.mat.linewidth).toBeGreaterThan(2);
    anim.set([blip("A", "good", 0.5)], []);
    anim.frame(1.1, true);
    expect(ring.obj.visible).toBe(false);
  });
  it("未確認警示的光點在兩次掃描之間仍會亮起（普通光點不會）", () => {
    const { parts, anim } = setup([blip("A", "good", 0.5), blip("B", "good", 0.5)], [{ id: 1, machine: "A", severity: "輕微" }]);
    const page = new THREE.Color(colors.page);
    let maxA = 0;
    for (let i = 0; i < 40; i++) {
      anim.frame(2 + i * 0.01, false);
      maxA = Math.max(maxA, vertexRed(parts, 0));
      expect(vertexRed(parts, 1)).toBeCloseTo(page.r);
    }
    expect(maxA).toBeGreaterThan(palette.good.r * 0.5);
  });
  it("線段預算：任何光點數量與警示下總數不變且 <= 4000；鎖定框不超過池", () => {
    const many = Array.from({ length: 80 }, (_, i) => blip(`M${i}`, "critical", i * 0.07));
    const { parts, anim } = setup(many, many.map((b, i) => ({ id: i, machine: b.machine, severity: "重大" as const })));
    const before = countSegments(parts.group);
    for (let i = 0; i < 100; i++) anim.frame(i * 0.05, i % 2 === 0);
    expect(countSegments(parts.group)).toBe(before);
    expect(before).toBeLessThanOrEqual(HUB_SEGMENT_CAP);
    expect(parts.radar.locks.filter((l) => l.obj.visible).length).toBeLessThanOrEqual(LOCK_POOL);
  });
});

describe("警示閃爍中途切換減少動態效果（X3 補驗 X2 未測項）", () => {
  it("閃爍與 ping 進行到一半，下一幀 reduced＝true 立刻是穩態：光點常亮、鎖定框常亮加粗、外圈 0.9、ping 環消失", () => {
    const alerts: ActiveAlert[] = [{ id: 1, machine: "A", severity: "嚴重" }];
    const { parts, anim } = setup([blip("A", "serious", 1), blip("B", "good", 2)], alerts);
    const tAt = (a: number) => a / SWEEP_OMEGA;
    anim.frame(tAt(0.9), false);
    anim.frame(tAt(1.05), false); // 掃過 A：產生 ping 環
    expect(parts.radar.pulses.some((p) => p.ring.visible)).toBe(true);
    const lock = parts.radar.locks.find((l) => l.obj.visible || l.mat.linewidth >= 2)!;
    const mid = tAt(1.05) + 0.12;
    const seen = new Set<number>();
    for (let i = 0; i < 12; i++) {
      anim.frame(mid + i * 0.021, false);
      seen.add(Math.round(vertexRed(parts, 0) * 1000));
    }
    expect(seen.size).toBeGreaterThan(1); // 還在閃
    // 切換：下一幀就是穩態（不需要等 ping／閃爍的週期走完）
    anim.frame(mid + 0.3, true);
    expect(vertexRed(parts, 0)).toBeCloseTo(palette.serious.r);
    expect(vertexRed(parts, 1)).toBeCloseTo(palette.good.r);
    expect(parts.radar.pulses.every((p) => !p.ring.visible)).toBe(true);
    expect(lock.obj.visible).toBe(true);
    expect(lock.mat.opacity).toBe(1);
    expect(lock.mat.linewidth).toBeGreaterThan(2);
    expect(parts.radar.alertRing.mat.opacity).toBeCloseTo(0.9);
    // 穩態之後每一幀都不變（不再閃）
    const a = vertexRed(parts, 0);
    for (let i = 0; i < 10; i++) {
      anim.frame(mid + 0.4 + i * 0.037, true);
      expect(vertexRed(parts, 0)).toBe(a);
      expect(parts.radar.alertRing.mat.opacity).toBeCloseTo(0.9);
    }
    // 再切回動態：回到閃爍（不卡在穩態）
    const seen2 = new Set<number>();
    for (let i = 0; i < 20; i++) {
      anim.frame(20 + i * 0.021, false);
      seen2.add(Math.round(parts.radar.alertRing.mat.opacity * 1000));
    }
    expect(seen2.size).toBeGreaterThan(1);
  });
});
