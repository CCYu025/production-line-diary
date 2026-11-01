import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { blipLocal, buildBracket, buildHubLines, countSegments, HUB_SEGMENT_CAP, MAX_BLIPS, PULSE_POOL, PULSE_SEGMENTS, RADAR, SEGMENTS_PER_BLIP } from "./hubLines";
import { MONITOR_COUNT } from "./layout";
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
    expect(parts.segments).toBeGreaterThanOrEqual(MAX_BLIPS * SEGMENTS_PER_BLIP + PULSE_POOL * PULSE_SEGMENTS);
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

  it("dispose 可重複呼叫", () => {
    const parts = buildHubLines(colors);
    parts.dispose();
    expect(() => parts.dispose()).not.toThrow();
  });
});
