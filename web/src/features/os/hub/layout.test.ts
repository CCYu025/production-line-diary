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
  makeProjector,
  MIN_CASING_GAP_FRAC,
  MIN_WALL_MARGIN_FRAC,
  wallExtents,
  CAMERA_FOV,
  monitorPose,
  monitorPoses,
  poseForChannel,
  screenCenter,
  SELECT_YAW_MAX_DEG,
  SELECT_YAW_MS,
  selectYawDeg,
} from "./layout";
import { RADAR } from "./hubLines";
const RADAR_Z = RADAR.z;
const RADAR_R = RADAR.radius;

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
  it("中間那台推近目標在螢幕面正前方（x=0，z=0.69+CLOSE_DISTANCE）", () => {
    const t = dollyTarget(monitorPose(3));
    expect(t.position.x).toBeCloseTo(0);
    expect(t.position.z).toBeCloseTo(0.69 + CLOSE_DISTANCE);
    expect(t.lookAt.y).toBeCloseTo(1.55);
  });
});

describe("選中偏航（≤ 3°）", () => {
  it("最左 -3°、最右 +3°、中間 0；全部不超過上限；單調", () => {
    expect(selectYawDeg(0)).toBeCloseTo(-SELECT_YAW_MAX_DEG);
    expect(selectYawDeg(6)).toBeCloseTo(SELECT_YAW_MAX_DEG);
    expect(selectYawDeg(3)).toBeCloseTo(0);
    for (let i = 0; i < 7; i++) expect(Math.abs(selectYawDeg(i))).toBeLessThanOrEqual(3);
    for (let i = 1; i < 7; i++) expect(selectYawDeg(i)).toBeGreaterThan(selectYawDeg(i - 1));
  });
  it("easeToward：250ms 內到位（誤差 < 1%），與幀率無關，不會過衝", () => {
    const sim = (dt: number) => {
      let v = 0;
      for (let t = 0; t < SELECT_YAW_MS - 1e-6; t += dt) v = easeToward(v, 3, dt);
      return v;
    };
    for (const dt of [5, 10, 25, 50]) {
      expect(Math.abs(3 - sim(dt))).toBeLessThan(0.03 + 1e-6);
      expect(sim(dt)).toBeLessThanOrEqual(3);
    }
    expect(easeToward(3, 3, 16)).toBe(3);
    expect(easeToward(1, 5, 0)).toBe(1);
  });
});

describe("休息鏡頭：構圖與選取偏航後的邊距", () => {
  const FOV = CAMERA_FOV;
  // 驗證用視窗：1920×1080、1280×720、1024×640
  const VIEWPORTS: Array<[number, number]> = [
    [1920, 1080],
    [1280, 720],
    [1024, 640],
  ];

  it("選取偏航 ≤ 3° 且沒有位移（只有角度）", () => {
    expect(SELECT_YAW_MAX_DEG).toBeLessThanOrEqual(3);
    for (let i = 0; i < 7; i++) expect(Math.abs(selectYawDeg(i))).toBeLessThanOrEqual(3);
  });

  for (const [w, h] of VIEWPORTS) {
    const aspect = w / h;
    describe(`${w}×${h}`, () => {
      const rest = fitRestCamera(FOV, aspect);

      it("螢幕面中心在畫面高度約 45%（42–48%）、牆占寬度 75–85%（1.6:1 窄視窗放寬到 70%）", () => {
        const e = wallExtents(rest, FOV, aspect);
        expect(e.faceCenterY).toBeGreaterThanOrEqual(0.42);
        expect(e.faceCenterY).toBeLessThanOrEqual(0.48);
        const width = e.maxX - e.minX;
        expect(width).toBeGreaterThanOrEqual(aspect < 1.7 ? 0.7 : 0.75);
        expect(width).toBeLessThanOrEqual(0.85);
      });

      it("每台外殼的輪廓分開：相鄰外殼投影後的水平間距 ≥ 視窗寬度的 1%", () => {
        for (const g of wallExtents(rest, FOV, aspect).gaps) expect(g).toBeGreaterThanOrEqual(MIN_CASING_GAP_FRAC - 1e-3);
      });

      it("選到 CH-01、CH-07（以及每一台）時，整面牆仍在視窗內，兩側邊距 ≥ 4%", () => {
        for (let i = 0; i < 7; i++) {
          const e = wallExtents({ ...rest, yawDeg: selectYawDeg(i) }, FOV, aspect);
          expect(e.minX).toBeGreaterThanOrEqual(MIN_WALL_MARGIN_FRAC);
          expect(1 - e.maxX).toBeGreaterThanOrEqual(MIN_WALL_MARGIN_FRAC);
          expect(e.minY).toBeGreaterThan(0);
          expect(e.maxY).toBeLessThan(1);
        }
      });
    });
  }

  it("牆的垂直範圍：下緣（底座）在 HUD 下方清單之上，地板與雷達台看得到（雷達台在牆與鏡頭之間）", () => {
    const aspect = 16 / 9;
    const rest = fitRestCamera(FOV, aspect);
    const e = wallExtents(rest, FOV, aspect);
    expect(e.maxY).toBeLessThan(0.9);
    const project = makeProjector(rest, FOV, aspect);
    const radarFront = project({ x: 0, y: 0, z: RADAR_Z + RADAR_R });
    const radarBack = project({ x: 0, y: 0, z: RADAR_Z - RADAR_R });
    expect(radarFront!.y).toBeLessThan(0.9); // 在 HUD 頻道列（約 93%）之上
    expect(radarBack!.y).toBeGreaterThan(e.maxY - 0.03); // 在牆的底座附近或之下
  });
});

describe("投影工具", () => {
  it("正前方的點在視窗中央；偏航往右時，原本在正前方的點往左移", () => {
    const cam = { position: { x: 0, y: 2, z: 10 }, lookAt: { x: 0, y: 2, z: 0 } };
    const p = makeProjector(cam, 45, 16 / 9)({ x: 0, y: 2, z: 0 })!;
    expect(p.x).toBeCloseTo(0.5, 6);
    expect(p.y).toBeCloseTo(0.5, 6);
    const q = makeProjector({ ...cam, yawDeg: 3 }, 45, 16 / 9)({ x: 0, y: 2, z: 0 })!;
    expect(q.x).toBeLessThan(0.5);
    expect(makeProjector(cam, 45, 16 / 9)({ x: 0, y: 2, z: 20 })).toBeNull();
  });
});
