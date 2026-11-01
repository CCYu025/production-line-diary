import { describe, expect, it } from "vitest";
import { CHANNELS } from "../channels";
import {
  ARC_HALF_DEG,
  ARC_RADIUS,
  arcAngleDeg,
  CLOSE_DISTANCE,
  dollyTarget,
  easeToward,
  facing,
  fitRestCamera,
  monitorFootprint,
  monitorPose,
  monitorPoses,
  poseForChannel,
  screenCenter,
  SELECT_YAW_MAX_DEG,
  SELECT_YAW_MS,
  selectYawDeg,
  withinHorizontalFov,
} from "./layout";

describe("螢幕牆弧形", () => {
  it("7 台，角度由 -55° 到 +55° 等間隔，CH-01 在最左", () => {
    const poses = monitorPoses();
    expect(poses).toHaveLength(7);
    expect(poses.map((p) => p.channel)).toEqual(CHANNELS.map((c) => c.id));
    expect(arcAngleDeg(0)).toBe(-ARC_HALF_DEG);
    expect(arcAngleDeg(6)).toBe(ARC_HALF_DEG);
    expect(arcAngleDeg(3)).toBeCloseTo(0, 10);
    const step = arcAngleDeg(1) - arcAngleDeg(0);
    for (let i = 1; i < 7; i++) expect(arcAngleDeg(i) - arcAngleDeg(i - 1)).toBeCloseTo(step, 10);
    for (let i = 1; i < 7; i++) expect(poses[i]!.position.x).toBeGreaterThan(poses[i - 1]!.position.x);
  });
  it("中間那台在原點、朝 +z（與 X0 單台螢幕相同）", () => {
    const m = monitorPose(3);
    expect(m.position.x).toBeCloseTo(0);
    expect(m.position.z).toBeCloseTo(0);
    expect(m.yaw).toBeCloseTo(0);
  });
  it("兩側往鏡頭方向彎、左右對稱、螢幕面朝向圓心", () => {
    const l = monitorPose(0);
    const r = monitorPose(6);
    expect(l.position.x).toBeCloseTo(-r.position.x);
    expect(l.position.z).toBeCloseTo(r.position.z);
    expect(l.position.z).toBeGreaterThan(0);
    for (const p of monitorPoses()) {
      const f = facing(p);
      const toC = { x: -p.position.x, z: ARC_RADIUS - p.position.z };
      const len = Math.hypot(toC.x, toC.z);
      expect(f.x).toBeCloseTo(toC.x / len, 6);
      expect(f.z).toBeCloseTo(toC.z / len, 6);
    }
  });
  it("poseForChannel", () => expect(poseForChannel("CH-02").index).toBe(1));
});

describe("進入推近的目標是選中的螢幕", () => {
  it("每台的目標鏡頭在該螢幕面正前方 CLOSE_DISTANCE，看向螢幕面中心；七台目標都不同", () => {
    const seen = new Set<string>();
    for (const p of monitorPoses()) {
      const t = dollyTarget(p);
      const c = screenCenter(p);
      expect(t.lookAt).toEqual(c);
      expect(Math.hypot(t.position.x - c.x, t.position.z - c.z)).toBeCloseTo(CLOSE_DISTANCE, 6);
      expect(t.position.y).toBeCloseTo(c.y);
      seen.add(`${t.position.x.toFixed(3)},${t.position.z.toFixed(3)}`);
    }
    expect(seen.size).toBe(7);
  });
  it("中間那台與 X1 的推近目標一致（x=0，z=0.69+1.25）", () => {
    const t = dollyTarget(monitorPose(3));
    expect(t.position.x).toBeCloseTo(0);
    expect(t.position.z).toBeCloseTo(0.69 + 1.25);
    expect(t.lookAt.y).toBeCloseTo(1.55);
  });
});

describe("選中偏航（≤ 8°）", () => {
  it("最左 -8°、最右 +8°、中間 0；全部不超過上限；單調", () => {
    expect(selectYawDeg(0)).toBeCloseTo(-SELECT_YAW_MAX_DEG);
    expect(selectYawDeg(6)).toBeCloseTo(SELECT_YAW_MAX_DEG);
    expect(selectYawDeg(3)).toBeCloseTo(0);
    for (let i = 0; i < 7; i++) expect(Math.abs(selectYawDeg(i))).toBeLessThanOrEqual(8);
    for (let i = 1; i < 7; i++) expect(selectYawDeg(i)).toBeGreaterThan(selectYawDeg(i - 1));
  });
  it("easeToward：250ms 內到位（誤差 < 1%），與幀率無關，不會過衝", () => {
    const sim = (dt: number) => {
      let v = 0;
      for (let t = 0; t < SELECT_YAW_MS - 1e-6; t += dt) v = easeToward(v, 8, dt);
      return v;
    };
    for (const dt of [5, 10, 25, 50]) {
      expect(Math.abs(8 - sim(dt))).toBeLessThan(0.08 + 1e-6);
      expect(sim(dt)).toBeLessThanOrEqual(8);
    }
    expect(easeToward(3, 3, 16)).toBe(3);
    expect(easeToward(1, 5, 0)).toBe(1);
  });
});

describe("休息鏡頭看得到整面牆", () => {
  const FOV = 50;
  for (const aspect of [16 / 9, 16 / 10, 21 / 9]) {
    it(`aspect ${aspect.toFixed(2)}：七台外殼的所有角落都在水平視角內`, () => {
      const cam = fitRestCamera(FOV, aspect);
      for (const p of monitorPoses()) for (const q of monitorFootprint(p)) expect(withinHorizontalFov(cam.position, q, FOV, aspect)).toBe(true);
    });
  }
  it("退得剛剛好：再近一點就有角落出框", () => {
    const aspect = 16 / 9;
    const cam = fitRestCamera(FOV, aspect, { marginFrac: 0 });
    const closer = { ...cam.position, z: cam.position.z - 0.5 };
    const anyOut = monitorPoses().some((p) => monitorFootprint(p).some((q) => !withinHorizontalFov(closer, q, FOV, aspect)));
    expect(anyOut).toBe(true);
  });
});
