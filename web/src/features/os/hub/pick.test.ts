import { describe, expect, it } from "vitest";
import { CHANNELS } from "../channels";
import { dollyTarget, monitorPoses, screenCenter, SCREEN_SIZE, type Vec3 } from "./layout";
import { hitScreen, pickChannel } from "./pick";

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cam: Vec3 = { x: 0, y: 2.2, z: 13 };

describe("pickChannel（射線 × 螢幕面）", () => {
  it("從休息位置朝每台螢幕中心發射，打到對應的頻道", () => {
    for (const pose of monitorPoses()) {
      const c = screenCenter(pose);
      expect(pickChannel({ origin: cam, direction: sub(c, cam) })).toBe(CHANNELS[pose.index]!.id);
    }
  });
  it("打到螢幕面邊緣內算、外面不算", () => {
    const pose = monitorPoses()[3]!; // 中間那台
    const c = screenCenter(pose);
    const inside = { x: c.x + SCREEN_SIZE.width / 2 - 0.05, y: c.y, z: c.z };
    const outside = { x: c.x + SCREEN_SIZE.width / 2 + 0.2, y: c.y, z: c.z };
    expect(hitScreen({ origin: cam, direction: sub(inside, cam) }, pose)).not.toBeNull();
    expect(hitScreen({ origin: cam, direction: sub(outside, cam) }, pose)).toBeNull();
    const above = { x: c.x, y: c.y + SCREEN_SIZE.height / 2 + 0.2, z: c.z };
    expect(pickChannel({ origin: cam, direction: sub(above, cam) })).toBeNull();
  });
  it("打到地板、天空、鏡頭後方（沒有螢幕）回傳 null", () => {
    expect(pickChannel({ origin: cam, direction: { x: 0, y: -1, z: -1 } })).toBeNull();
    expect(pickChannel({ origin: cam, direction: { x: 0, y: 1, z: -1 } })).toBeNull();
    expect(pickChannel({ origin: cam, direction: { x: 0, y: 0, z: 1 } })).toBeNull();
  });
  it("背面看過去不算（鏡頭在螢幕後方）", () => {
    const pose = monitorPoses()[3]!;
    const c = screenCenter(pose);
    const behind = { x: 0, y: c.y, z: -5 };
    expect(hitScreen({ origin: behind, direction: sub(c, behind) }, pose)).toBeNull();
  });
  it("推近到選中螢幕前時，正中央打到的就是它", () => {
    for (const pose of monitorPoses()) {
      const t = dollyTarget(pose);
      expect(pickChannel({ origin: t.position, direction: sub(t.lookAt, t.position) })).toBe(CHANNELS[pose.index]!.id);
    }
  });
});
