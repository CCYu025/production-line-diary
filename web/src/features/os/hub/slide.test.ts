import { describe, expect, it } from "vitest";
import { ENTER, EXIT } from "../transition/timing";
import { cameraProgress } from "./camera";
import { arcAngleDeg, monitorPose } from "./layout";
import { SIDE_SLIDE_DEG, sideFade, slideAngleDeg, slidePose, type SlidePose } from "./slide";

describe("E1／X4 兩側螢幕滑動", () => {
  const sel = 3;
  it("p＝0：全部在原位（與 layout.monitorPose 完全相同）、沒有淡出", () => {
    const out: SlidePose = { x: 0, z: 0, yaw: 0 };
    for (let i = 0; i < 7; i++) {
      slidePose(i, sel, 0, out);
      const base = monitorPose(i);
      expect(out.x).toBeCloseTo(base.position.x, 12);
      expect(out.z).toBeCloseTo(base.position.z, 12);
      expect(out.yaw).toBeCloseTo(base.yaw, 12);
      expect(sideFade(i, sel, 0)).toBe(0);
    }
  });
  it("選中的那台永遠不動、不淡出", () => {
    for (const p of [0, 0.3, 0.7, 1]) {
      expect(slideAngleDeg(sel, sel, p)).toBe(arcAngleDeg(sel));
      expect(sideFade(sel, sel, p)).toBe(0);
    }
  });
  it("p＝1（600ms）：另外 6 台各往外（遠離選中的那台）滑 SIDE_SLIDE_DEG，完全融進霧", () => {
    for (let i = 0; i < 7; i++) {
      if (i === sel) continue;
      const dir = Math.sign(i - sel);
      expect(slideAngleDeg(i, sel, 1) - arcAngleDeg(i)).toBeCloseTo(dir * SIDE_SLIDE_DEG, 12);
      expect(sideFade(i, sel, 1)).toBe(1);
    }
  });
  it("選在邊上時（CH-01）：右邊 6 台都往右滑", () => {
    for (let i = 1; i < 7; i++) expect(slideAngleDeg(i, 0, 1)).toBeGreaterThan(arcAngleDeg(i));
  });
  it("滑動與淡出對 p 單調", () => {
    let prevA = arcAngleDeg(5);
    let prevF = 0;
    for (let i = 1; i <= 20; i++) {
      const a = slideAngleDeg(5, sel, i / 20);
      const f = sideFade(5, sel, i / 20);
      expect(a).toBeGreaterThanOrEqual(prevA);
      expect(f).toBeGreaterThanOrEqual(prevF);
      prevA = a;
      prevF = f;
    }
  });
  it("滑動沿著弧線：滑動後的螢幕仍面向圓心（yaw ＝ -角度），仍在同一個圓上", () => {
    const out: SlidePose = { x: 0, z: 0, yaw: 0 };
    slidePose(6, sel, 0.6, out);
    const a = (slideAngleDeg(6, sel, 0.6) * Math.PI) / 180;
    expect(out.yaw).toBeCloseTo(-a, 12);
    expect(Math.hypot(out.x, out.z - 10.5)).toBeCloseTo(10.5, 9);
  });
  it("離開 X4 把同一條曲線倒回去：300ms 還在最遠、900ms 回到原位；進入 600ms 在最遠", () => {
    expect(cameraProgress("entering", ENTER.E1[1])).toBe(1);
    expect(cameraProgress("exiting", EXIT.X4[0])).toBe(1);
    expect(cameraProgress("exiting", EXIT.X4[1])).toBe(0);
    expect(slideAngleDeg(6, sel, cameraProgress("exiting", EXIT.X4[1]))).toBe(arcAngleDeg(6));
    // 進入 200ms 與離開 X4 結束前 200ms（同樣離端點 200ms）進度對稱
    expect(cameraProgress("exiting", EXIT.X4[1] - 200)).toBeCloseTo(1 - cameraProgress("entering", ENTER.E1[1] - 200 + 0) + 0, 6);
  });
  it("p 超出 0..1 夾住", () => {
    expect(slideAngleDeg(6, sel, 2)).toBe(slideAngleDeg(6, sel, 1));
    expect(slideAngleDeg(6, sel, -1)).toBe(arcAngleDeg(6));
  });
});
