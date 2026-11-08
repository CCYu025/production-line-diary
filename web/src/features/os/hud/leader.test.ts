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

describe("keyLayout（H0 r2：鍵中心對齊螢幕投影）", () => {
  it("1920×1080、1280×720、1024×600：7 個鍵由左到右、相鄰至少 4px、寬度 84–176px、都在遮罩實心區內", async () => {
    const { keyLayout, KEY_GAP_PX, KEY_MAX_PX, KEY_MIN_PX, KEY_EDGE_FRAC } = await import("./leader");
    for (const [w, h] of [[1920, 1080], [1280, 720], [1024, 600]] as const) {
      const l = keyLayout(w, h, 0)!;
      expect(l, `${w}x${h}`).not.toBeNull();
      expect(l.x).toHaveLength(7);
      expect(l.w).toBeGreaterThanOrEqual(KEY_MIN_PX);
      expect(l.w).toBeLessThanOrEqual(KEY_MAX_PX);
      for (let i = 1; i < 7; i++) expect(l.x[i]! - l.x[i - 1]! - l.w).toBeGreaterThanOrEqual(KEY_GAP_PX - 1e-6);
      expect(l.x[0]! - l.w / 2).toBeGreaterThanOrEqual(w * KEY_EDGE_FRAC - 1e-6);
      expect(l.x[6]! + l.w / 2).toBeLessThanOrEqual(w * (1 - KEY_EDGE_FRAC) + 1e-6);
    }
  });
  it("鍵中心就是螢幕投影中心（未被邊界夾住時）：CH-04 在畫面中央，左右對稱", async () => {
    const { keyLayout } = await import("./leader");
    const l = keyLayout(1920, 1080, 0)!;
    expect(l.x[3]!).toBeCloseTo(960, 0);
    expect(l.x[0]! + l.x[6]!).toBeCloseTo(1920, -1);
  });
  it("空間不夠（很窄）或尺寸無效時回傳 null，退回平均排列", async () => {
    const { keyLayout } = await import("./leader");
    expect(keyLayout(0, 600, 0)).toBeNull();
    expect(keyLayout(700, 600, 0)).toBeNull();
  });
});

describe("keyLayout 隨選取偏航", () => {
  it("選 CH-01（偏航往左）與選 CH-07 時，鍵整體往相反方向平移，寬度不變", async () => {
    const { keyLayout } = await import("./leader");
    const a = keyLayout(1920, 1080, 0, -3)!;
    const b = keyLayout(1920, 1080, 0, 3)!;
    expect(a.w).toBe(b.w);
    expect(a.x[3]!).toBeGreaterThan(b.x[3]!);
  });
});
