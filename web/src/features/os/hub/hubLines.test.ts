import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ALERT_RING_SEGMENTS, blipLocal, buildBracket, buildHubLines, countSegments, housingGeometry, HUB_SEGMENT_CAP, LOCK_POOL, LOCK_SEGMENTS, MAX_BLIPS, PULSE_POOL, PULSE_SEGMENTS, RADAR, SEGMENTS_PER_BLIP, WEDGE_LINES } from "./hubLines";
import { CASING_HULL_XZ, CASING_Y, MONITOR_COUNT } from "./layout";
import type { Blip } from "./radar";

const colors = {
  floor: "#2c4054",
  housing: "#2c4054",
  outline: "#2c4054",
  accent: "#22e6ff",
  ringDim: "#14202c",
  ringStrong: "#2c4054",
  page: "#05080c",
};

const blipOf = (i: number): Blip => ({ machine: `M${i}`, angle: (i * 0.7) % (Math.PI * 2), radius: 0.35 + ((i * 0.13) % 0.55), colorKey: "warning", count: 1 });

describe("hubLines（X2：7 台螢幕＋雷達台）", () => {
  it("線段總數 > 0 且 ≤ 4,000（含光點與脈衝環的預先配置上限）", () => {
    const parts = buildHubLines(colors);
    expect(parts.segments).toBeGreaterThan(300);
    expect(parts.segments).toBeLessThanOrEqual(HUB_SEGMENT_CAP);
    expect(countSegments(parts.group)).toBe(parts.segments);
  });

  it("預算分解：光點上限與脈衝環都已計入", () => {
    const parts = buildHubLines(colors);
    expect(countSegments(parts.radar.blips)).toBe(MAX_BLIPS * SEGMENTS_PER_BLIP);
    expect(parts.radar.pulses).toHaveLength(PULSE_POOL);
    for (const p of parts.radar.pulses) expect(countSegments(p.ring)).toBe(PULSE_SEGMENTS);
    expect(parts.radar.locks).toHaveLength(LOCK_POOL);
    for (const l of parts.radar.locks) expect(countSegments(l.obj)).toBe(LOCK_SEGMENTS);
    expect(countSegments(parts.radar.alertRing.obj)).toBe(ALERT_RING_SEGMENTS);
    expect(parts.segments).toBeGreaterThanOrEqual(
      MAX_BLIPS * SEGMENTS_PER_BLIP + PULSE_POOL * PULSE_SEGMENTS + LOCK_POOL * LOCK_SEGMENTS + ALERT_RING_SEGMENTS + WEDGE_LINES,
    );
  });

  it("有 7 台螢幕、每台一個外框與一個螢幕面", () => {
    const parts = buildHubLines(colors);
    expect(parts.monitors).toHaveLength(MONITOR_COUNT);
    for (const m of parts.monitors) {
      expect(m.outline.parent).toBe(m.group);
      expect(m.screen.parent).toBe(m.group);
    }
  });

  it("四角框是 Line2 系列，4 個角共 8 段，且只掛在被選中的螢幕下（計入總數）", () => {
    expect(countSegments(buildBracket(colors.accent))).toBe(8);
    const parts = buildHubLines(colors);
    parts.select(1);
    expect(parts.bracket.parent).toBe(parts.monitors[1]!.group);
    parts.select(5);
    expect(parts.bracket.parent).toBe(parts.monitors[5]!.group);
    expect(parts.monitors.filter((m) => m.group.children.includes(parts.bracket))).toHaveLength(1);
  });

  it("懸停預覽（H0）：淡的四角框掛在被懸停的螢幕下（選中的那台不重複畫）；null 或換台就移走；不計入建立時的線段總數", () => {
    const parts = buildHubLines(colors);
    const base = countSegments(parts.group);
    parts.select(3);
    const baseSel = countSegments(parts.group);
    expect(baseSel).toBe(base);
    expect(parts.hoverBracket()).toBeNull();
    parts.setHover(1);
    const hb = parts.hoverBracket()!;
    expect(hb.parent).toBe(parts.monitors[1]!.group);
    expect(hb).not.toBe(parts.bracket);
    expect((hb.material as unknown as { opacity: number }).opacity).toBeLessThan(1);
    expect(countSegments(parts.group)).toBe(base + 8);
    parts.setHover(5);
    expect(parts.hoverBracket()!.parent).toBe(parts.monitors[5]!.group);
    expect(parts.monitors.filter((m) => m.group.children.includes(hb))).toHaveLength(1);
    parts.setHover(3); // 選中的那台：不重複畫
    expect(hb.parent).toBeNull();
    parts.setHover(2);
    parts.setHover(null);
    expect(hb.parent).toBeNull();
    expect(countSegments(parts.group)).toBe(base);
    parts.dispose();
  });

  it("選取：只有選中螢幕的外框是選中色", () => {
    const parts = buildHubLines(colors);
    parts.select(3);
    const accent = new THREE.Color(colors.accent);
    parts.monitors.forEach((m, i) => expect(m.outlineMat.color.equals(accent)).toBe(i === 3));
  });

  it("光點：最多 MAX_BLIPS，drawRange 跟著數量，超過上限的略過；不改變線段總數", () => {
    const parts = buildHubLines(colors);
    const before = countSegments(parts.group);
    const colorOf = () => new THREE.Color("#ffaa00");
    expect(parts.setBlips([blipOf(1), blipOf(2), blipOf(3)], colorOf)).toBe(3);
    expect(parts.radar.blips.geometry.drawRange.count).toBe(3 * SEGMENTS_PER_BLIP * 2);
    const many = Array.from({ length: MAX_BLIPS + 20 }, (_, i) => blipOf(i));
    expect(parts.setBlips(many, colorOf)).toBe(MAX_BLIPS);
    expect(parts.radar.blips.geometry.drawRange.count).toBe(MAX_BLIPS * SEGMENTS_PER_BLIP * 2);
    expect(parts.setBlips([], colorOf)).toBe(0);
    expect(countSegments(parts.group)).toBe(before);
  });

  it("光點位置在雷達半徑的 35%–90% 內（局部座標）", () => {
    for (let i = 0; i < 30; i++) {
      const p = blipLocal(blipOf(i));
      const r = Math.hypot(p.x, p.z);
      expect(r).toBeGreaterThanOrEqual(0.35 * RADAR.radius - 1e-9);
      expect(r).toBeLessThanOrEqual(0.9 * RADAR.radius + 1e-9);
    }
  });

  it("外殼的所有頂點都在 layout 的凸包稜柱內（投影間距與構圖測試依賴它）", () => {
    const pos = housingGeometry().getAttribute("position");
    const poly = CASING_HULL_XZ;
    const inside = (x: number, z: number) => {
      // 凸多邊形（逆時針或順時針皆可）：所有邊的叉積同號（含邊上）
      let sign = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        const c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
        if (Math.abs(c) < 1e-6) continue;
        if (sign === 0) sign = Math.sign(c);
        else if (Math.sign(c) !== sign) return false;
      }
      return true;
    };
    for (let i = 0; i < pos.count; i++) {
      expect(inside(pos.getX(i), pos.getZ(i)), `頂點 ${i}`).toBe(true);
      expect(pos.getY(i)).toBeGreaterThanOrEqual(CASING_Y[0] - 1e-6);
      expect(pos.getY(i)).toBeLessThanOrEqual(CASING_Y[1] + 1e-6);
    }
  });

  it("dispose 可重複呼叫", () => {
    const parts = buildHubLines(colors);
    parts.dispose();
    expect(() => parts.dispose()).not.toThrow();
  });
});

describe("兩側螢幕淡入霧（X3 E1／X4）", () => {
  it("fade(i, 0)＝原色；fade(i, 1)＝--page；選中的外框保持 accent 但 fade 時往 page 混；沒變時不重算", () => {
    const parts = buildHubLines(colors);
    const page = new THREE.Color(colors.page);
    const housing = new THREE.Color(colors.housing);
    parts.fade(1, 1);
    const near = (a: THREE.Color, b: THREE.Color) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 1e-6;
    expect(near(parts.monitors[1]!.housingMat.color, page)).toBe(true);
    expect(near(parts.monitors[1]!.outlineMat.color, page)).toBe(true);
    parts.fade(1, 0);
    expect(near(parts.monitors[1]!.housingMat.color, housing)).toBe(true);
    parts.fade(2, 0.5);
    expect(parts.monitors[2]!.housingMat.color.r).toBeCloseTo((housing.r + page.r) / 2, 6);
    // 外殼材質每台各自一份（才能各自淡出）
    const mats = new Set(parts.monitors.map((m) => m.housingMat));
    expect(mats.size).toBe(MONITOR_COUNT);
    // select 之後仍尊重目前的淡出量
    parts.select(2);
    expect(parts.monitors[2]!.outlineMat.color.r).toBeGreaterThan(new THREE.Color(colors.page).r);
    parts.fade(2, 0);
    expect(near(parts.monitors[2]!.outlineMat.color, new THREE.Color(colors.accent))).toBe(true);
    // 線段預算不變
    expect(parts.segments).toBeLessThanOrEqual(HUB_SEGMENT_CAP);
  });
});
