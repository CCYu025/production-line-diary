import { describe, expect, it } from "vitest";
import { ENTER, EXIT } from "../transition/timing";
import { cameraProgress, dollyPose, patrolYawDeg, PATROL_RETURN_MS, PATROL_YAW_MAX_DEG, poseAt, restPose, stepRig } from "./camera";
import { dollyTarget, hudInsets, monitorPoses, poseForChannel, selectYawDeg, SELECT_YAW_MAX_DEG } from "./layout";

describe("cameraProgress（X1 時間不變）", () => {
  it("進入：E1 結束（600ms）到 1；離開：X4 區間拉回 0", () => {
    expect(cameraProgress("hub", 100)).toBe(0);
    expect(cameraProgress("entering", 0)).toBe(0);
    expect(cameraProgress("entering", ENTER.E1[1])).toBe(1);
    expect(cameraProgress("station", 0)).toBe(1);
    expect(cameraProgress("exiting", EXIT.X4[0] - 1)).toBe(1);
    expect(cameraProgress("exiting", EXIT.X4[1])).toBe(0);
  });
});

describe("推近／拉遠以選中螢幕為目標", () => {
  it("p=1 的鏡頭位置與看向點就是 dollyTarget(選中螢幕)，不同頻道不同", () => {
    const left = poseAt(16 / 9, "CH-01", 1);
    const right = poseAt(16 / 9, "CH-07", 1);
    const t1 = dollyTarget(poseForChannel("CH-01"));
    expect(left.lookAt.x).toBeCloseTo(t1.lookAt.x, 9);
    expect(left.position.z).toBeCloseTo(t1.position.z, 9);
    expect(left.lookAt.x).toBeLessThan(-3);
    expect(right.lookAt.x).toBeGreaterThan(3);
    // 中間那台在原點（與 X0 單台螢幕同位置）
    expect(poseAt(16 / 9, "CH-04", 1).lookAt.x).toBeCloseTo(0, 9);
  });
  it("p=0 是休息位置，與頻道無關", () => {
    expect(poseAt(16 / 9, "CH-01", 0)).toEqual(poseAt(16 / 9, "CH-07", 0));
    expect(poseAt(16 / 9, "CH-02", 0)).toEqual(restPose(16 / 9));
    expect(dollyPose("CH-02")).toEqual(dollyTarget(poseForChannel("CH-02")));
  });
  it("休息位置往後退到整面牆在 16:9 看得到（z 大於最外側螢幕）", () => {
    const max = Math.max(...monitorPoses().map((p) => p.position.z));
    expect(restPose(16 / 9).position.z).toBeGreaterThan(max + 3);
  });
});

describe("stepRig", () => {
  const base = { selectYaw: 0, patrolW: 0 };
  const input = { channel: "CH-07" as const, mode: "hub" as const, patrolling: false, reduced: false, dtMs: 16, tSec: 0 };

  it("選取偏航 ≤ 8°，逐步趨近目標（不是瞬間）", () => {
    const one = stepRig(base, input, 0);
    expect(one.state.selectYaw).toBeGreaterThan(0);
    expect(one.state.selectYaw).toBeLessThan(selectYawDeg(6));
    let s = base;
    for (let i = 0; i < 40; i++) s = stepRig(s, input, 0).state; // 640ms
    expect(s.selectYaw).toBeCloseTo(selectYawDeg(6), 1);
    expect(Math.abs(s.selectYaw)).toBeLessThanOrEqual(SELECT_YAW_MAX_DEG);
  });
  it("減少動態效果：偏航直接到位、沒有巡視", () => {
    const r = stepRig(base, { ...input, reduced: true, patrolling: true }, 0);
    expect(r.state.selectYaw).toBe(selectYawDeg(6));
    expect(r.state.patrolW).toBe(0);
    expect(r.yawDeg).toBe(selectYawDeg(6));
  });
  it("巡視：只在 hub；淡入；輸入後（patrolling=false）在 PATROL_RETURN_MS 內收回", () => {
    let s = { selectYaw: 0, patrolW: 0 };
    for (let i = 0; i < 200; i++) s = stepRig(s, { ...input, channel: "CH-04", patrolling: true, tSec: 10 }, 0).state;
    expect(s.patrolW).toBeGreaterThan(0.95);
    const yawPatrolling = stepRig(s, { ...input, channel: "CH-04", patrolling: true, tSec: 10 }, 0).yawDeg;
    expect(Math.abs(yawPatrolling)).toBeGreaterThan(5);
    expect(Math.abs(yawPatrolling)).toBeLessThanOrEqual(PATROL_YAW_MAX_DEG);
    let back = s;
    for (let i = 0; i < Math.ceil(PATROL_RETURN_MS / 16) + 1; i++) back = stepRig(back, { ...input, channel: "CH-04", patrolling: false, tSec: 10 }, 0).state;
    expect(back.patrolW).toBeLessThan(0.05);
    // 非 hub 模式不巡視
    const notHub = stepRig({ selectYaw: 0, patrolW: 0 }, { ...input, mode: "entering", patrolling: true }, 0);
    expect(notHub.state.patrolW).toBe(0);
  });
  it("偏航乘上 (1 - 進度)：推近到位時沒有偏航", () => {
    const s = { selectYaw: selectYawDeg(6), patrolW: 0 };
    expect(stepRig(s, { ...input, mode: "station", dtMs: 0 }, 1).yawDeg).toBeCloseTo(0, 9);
  });
  it("巡視波形 ±PATROL_YAW_MAX_DEG", () => {
    for (let t = 0; t < 80; t += 1.3) expect(Math.abs(patrolYawDeg(t))).toBeLessThanOrEqual(PATROL_YAW_MAX_DEG + 1e-9);
  });
});

describe("休息位置納入 HUD（H0）", () => {
  it("有 HUD 時休息位置與沒有 HUD 不同（鏡頭較遠、整面牆往上讓出控制台），且同一組參數回傳同一個快取物件", () => {
    const hud = hudInsets(720);
    const a = restPose(16 / 9, hud);
    expect(a).toBe(restPose(16 / 9, hud));
    expect(a).not.toEqual(restPose(16 / 9));
    expect(a.position.z).toBeGreaterThan(restPose(16 / 9).position.z);
  });
  it("poseAt 的 p=0 就是有 HUD 的休息位置；p=1 不受 HUD 影響（推近終點只看選中螢幕）", () => {
    const hud = hudInsets(720);
    expect(poseAt(16 / 9, "CH-02", 0, hud)).toEqual(restPose(16 / 9, hud));
    expect(poseAt(16 / 9, "CH-02", 1, hud)).toEqual(poseAt(16 / 9, "CH-02", 1));
  });
});
