import { describe, expect, it } from "vitest";
import { DRAG_THRESHOLD_PX, DragTracker, INERTIA_MS, inertiaStep, rotated, VelocityTracker, zoomed, type OrbitLimits } from "./orbit";

const limits: OrbitLimits = { minDist: 10, maxDist: 60, minPitch: -0.2, maxPitch: 1.2 };

describe("DragTracker（§5.4）", () => {
  it("位移未達 4px 放開算點擊", () => {
    const d = new DragTracker();
    d.down(1, 100, 100, 0);
    expect(d.move(102, 102).event).toBe("none");
    expect(d.move(103, 100).event).toBe("none"); // 距離 3
    expect(d.end()).toEqual({ wasDragging: false, wasActive: true });
    expect(d.isActive).toBe(false);
  });
  it("達 4px 才開始拖曳；開始那一次帶著門檻前的位移", () => {
    const d = new DragTracker();
    d.down(1, 0, 0, 0);
    const a = d.move(DRAG_THRESHOLD_PX, 0);
    expect(a).toEqual({ event: "start", dx: DRAG_THRESHOLD_PX, dy: 0 });
    expect(d.move(10, 3)).toEqual({ event: "move", dx: 10 - DRAG_THRESHOLD_PX, dy: 3 });
    expect(d.end().wasDragging).toBe(true);
  });
  it("end 後清乾淨：再 move 沒反應；重複 end 安全", () => {
    const d = new DragTracker();
    d.down(1, 0, 0, 0);
    d.move(20, 20);
    d.end();
    expect(d.move(50, 50).event).toBe("none");
    expect(d.end()).toEqual({ wasDragging: false, wasActive: false });
  });
});

describe("鏡頭範圍", () => {
  it("俯仰與縮放都夾在範圍內，偏航不限", () => {
    const s = { yaw: 0, pitch: 0.5, dist: 30 };
    expect(rotated(s, 0, 100000, limits).pitch).toBe(limits.maxPitch);
    expect(rotated(s, 0, -100000, limits).pitch).toBe(limits.minPitch);
    expect(rotated(s, 100000, 0, limits).yaw).toBeLessThan(-100);
    let far = s, near = s;
    for (let i = 0; i < 20; i++) {
      far = zoomed(far, 400, limits);
      near = zoomed(near, -400, limits);
    }
    expect(far.dist).toBe(limits.maxDist);
    expect(near.dist).toBe(limits.minDist);
    expect(zoomed(s, 100, limits).dist).toBeGreaterThan(s.dist);
  });
});

describe("慣性 ≤ 400ms", () => {
  it("線性衰減，累計時間不超過 400ms；位移小於以初速等速走 400ms", () => {
    let remaining = INERTIA_MS;
    let t = 0;
    let yaw = 0;
    const v = { yaw: 0.01, pitch: 0 };
    while (remaining > 0 && t < 5000) {
      const r = inertiaStep(v, remaining, 16, false);
      yaw += r.dYaw;
      remaining = r.remainingMs;
      t += 16;
    }
    expect(t).toBeLessThanOrEqual(INERTIA_MS + 16);
    expect(yaw).toBeCloseTo(0.01 * INERTIA_MS * 0.5, 2);
  });
  it("減少動態效果時沒有慣性", () => {
    expect(inertiaStep({ yaw: 1, pitch: 1 }, INERTIA_MS, 16, true)).toEqual({ dYaw: 0, dPitch: 0, remainingMs: 0 });
  });
  it("VelocityTracker：停住不動後放開沒有速度", () => {
    const v = new VelocityTracker();
    v.push(0, 0.1, 0);
    v.push(16, 0.1, 0);
    expect(v.release(500)).toEqual({ yaw: 0, pitch: 0 });
    v.push(1000, 0.1, 0);
    v.push(1016, 0.1, 0);
    expect(v.release(1020).yaw).toBeGreaterThan(0);
  });
});
