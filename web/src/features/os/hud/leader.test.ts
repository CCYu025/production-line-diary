import { describe, expect, it } from "vitest";
import { CHANNELS } from "../channels";
import { LEADER_GAP_PX, LEADER_MIN_PX, leaderGeometry } from "./leader";

describe("leaderGeometry（H0 控制台引線）", () => {
  const W = 1920;
  const H = 1080;
  // 控制台鍵的上緣大約在畫面下緣往上 60–80px
  const key = (i: number) => ({ left: 360 + i * 170, top: H - 70, width: 150 });

  it("上端在螢幕底座（鍵的上方）、下端在鍵上緣正中央（留 3px 空隙）", () => {
    CHANNELS.forEach((ch, i) => {
      const l = leaderGeometry({ width: W, height: H, channel: ch.id, barrelK: 0, key: key(i) })!;
      expect(l).not.toBeNull();
      expect(l.x2).toBeCloseTo(key(i).left + 75, 6);
      expect(l.y2).toBeCloseTo(H - 70 - LEADER_GAP_PX, 6);
      expect(l.y1).toBeLessThan(l.y2);
      expect(l.y1).toBeGreaterThan(0);
    });
  });

  it("螢幕端依頻道由左到右，且隨 CRT 桶狀弧面往內縮", () => {
    const xs = CHANNELS.map((ch, i) => leaderGeometry({ width: W, height: H, channel: ch.id, barrelK: 0, key: key(i) })!.x1);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    const flat = leaderGeometry({ width: W, height: H, channel: "CH-01", barrelK: 0, key: key(0) })!;
    const barrel = leaderGeometry({ width: W, height: H, channel: "CH-01", barrelK: 0.045, key: key(0) })!;
    expect(barrel.x1).toBeGreaterThan(flat.x1);
  });

  it("尺寸或鍵寬為 0（例如測試環境沒有版面）回傳 null", () => {
    expect(leaderGeometry({ width: 0, height: H, channel: "CH-02", barrelK: 0, key: key(1) })).toBeNull();
    expect(leaderGeometry({ width: W, height: H, channel: "CH-02", barrelK: 0, key: { left: 0, top: 0, width: 0 } })).toBeNull();
  });

  it("太短（鍵貼在螢幕底下）就不畫", () => {
    const l = leaderGeometry({ width: W, height: H, channel: "CH-02", barrelK: 0, key: key(1) })!;
    const tooClose = { left: 100, top: l.y1 + LEADER_GAP_PX + LEADER_MIN_PX - 1, width: 150 };
    expect(leaderGeometry({ width: W, height: H, channel: "CH-02", barrelK: 0, key: tooClose })).toBeNull();
  });
});
