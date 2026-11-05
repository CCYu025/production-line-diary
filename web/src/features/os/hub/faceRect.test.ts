import { describe, expect, it } from "vitest";
import { CHANNELS } from "../channels";
import { A_ZONE } from "../crt/zones";
import { cardFrameRect, type Rect } from "../transition/choreo";
import { ENTER } from "../transition/timing";
import { cameraProgress } from "./camera";
import { barrelDisplay, faceRectAt } from "./faceRect";
import { CLOSE_DISTANCE, FACE_FILL_FRAC } from "./layout";

const ASPECTS: Array<[string, number]> = [
  ["1920×1080", 1920 / 1080],
  ["1280×720", 1280 / 720],
  ["1024×600", 1024 / 600],
];

describe("螢幕面投影矩形（E1 結束＝台標卡外框起點）", () => {
  it("600ms 鏡頭進度剛好是 1（推到位）", () => {
    expect(cameraProgress("entering", ENTER.E1[1])).toBe(1);
  });
  it("推到位時螢幕面置中、高度＝FACE_FILL_FRAC、完整在畫面內（不超出）、4:3", () => {
    for (const [, aspect] of ASPECTS) {
      for (const ch of CHANNELS) {
        const r = faceRectAt(aspect, ch.id, 1, 0);
        expect(r.h).toBeCloseTo(FACE_FILL_FRAC, 6);
        expect(r.x + r.w / 2).toBeCloseTo(0.5, 6);
        expect(r.y + r.h / 2).toBeCloseTo(0.5, 6);
        expect(r.x).toBeGreaterThan(0);
        expect(r.x + r.w).toBeLessThan(1);
        expect((r.w * aspect) / r.h).toBeCloseTo(2.0 / 1.5, 6);
      }
    }
  });
  it("CLOSE_DISTANCE 由 FACE_FILL_FRAC 推出，且比 X0–X2 的 1.25 遠（螢幕面不再超出畫面）", () => {
    expect(CLOSE_DISTANCE).toBeCloseTo(1.5 / (FACE_FILL_FRAC * 2 * Math.tan(Math.PI / 8)), 9);
    expect(CLOSE_DISTANCE).toBeGreaterThan(1.25);
  });
  it("休息位置（p=0）時螢幕面很小；推近過程中矩形單調變大", () => {
    const rest = faceRectAt(16 / 9, "CH-02", 0, 0);
    expect(rest.h).toBeLessThan(0.15);
    let prev = rest.h;
    for (let i = 1; i <= 10; i++) {
      const r = faceRectAt(16 / 9, "CH-02", i / 10, 0);
      expect(r.h).toBeGreaterThan(prev);
      prev = r.h;
    }
  });
  it("桶狀弧面：標準／濃把四角往內拉，矩形略小、仍置中；差距遠小於 4%", () => {
    const flat = faceRectAt(16 / 9, "CH-04", 1, 0);
    for (const level of ["std", "max"] as const) {
      const r = faceRectAt(16 / 9, "CH-04", 1, A_ZONE[level].barrel);
      expect(r.h).toBeLessThan(flat.h);
      expect(r.w).toBeLessThan(flat.w);
      expect(r.x + r.w / 2).toBeCloseTo(0.5, 6);
      expect(flat.h - r.h).toBeLessThan(0.04);
    }
  });
  it("barrelDisplay：k＝0 原值；反算後再套前向公式回到原場景座標", () => {
    expect(barrelDisplay(0.4, -0.3, 0)).toEqual({ x: 0.4, y: -0.3 });
    const d = barrelDisplay(0.7, 0.5, 0.03);
    const s = 1 + 0.03 * (d.x * d.x + d.y * d.y);
    expect(d.x * s).toBeCloseTo(0.7, 9);
    expect(d.y * s).toBeCloseTo(0.5, 9);
  });
  it("卡片外框連續：600ms 的外框矩形＝螢幕面投影矩形（0 誤差，驗收 ≤ 2%）", () => {
    for (const [, aspect] of ASPECTS) {
      for (const level of ["off", "std", "max"] as const) {
        const face = faceRectAt(aspect, "CH-02", cameraProgress("entering", ENTER.E1[1]), A_ZONE[level].barrel);
        const card: Rect = cardFrameRect(ENTER.E2[0], face);
        expect(card).toEqual(face);
      }
    }
  });
});
