import { describe, expect, it } from "vitest";
import {
  CARD_FRAME_FULL,
  cardFrameRect,
  easeInCubic,
  easeInOutCubic,
  easeOutCubic,
  ENTER_LOCK_AT,
  ENTER_TAG,
  enterNoise,
  enterRollPx,
  exitBlockRect,
  exitGeometry,
  EXIT_DOT,
  EXIT_LINE_H,
  hash01,
  lerpRect,
  lockCells,
  NOISE_CLEAN_TAIL_MS,
  osdAlpha,
  rollFrac,
  SWITCH_TAG,
  switchNoise,
  tagLerp,
  tagPlanOf,
  tagRectAt,
  tagStartRect,
  tearBands,
  tearCount,
  tearDx,
  tearStrength,
  type Rect,
} from "./choreo";
import { ENTER, EXIT, SWITCH } from "./timing";

describe("緩動函式", () => {
  it("端點與單調", () => {
    for (const f of [easeInCubic, easeOutCubic, easeInOutCubic]) {
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
      let prev = -1;
      for (let i = 0; i <= 20; i++) {
        const v = f(i / 20);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInCubic(0.5)).toBeLessThan(0.5); // ease-in 起步慢
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe("E2 卡片外框接續（600ms 等於螢幕面投影矩形）", () => {
  const start: Rect = { x: 0.185, y: 0.08, w: 0.63, h: 0.84 };
  it("E1 與 E2 開始：外框就是 start（不跳）", () => {
    expect(cardFrameRect(0, start)).toEqual(start);
    expect(cardFrameRect(ENTER.E2[0], start)).toEqual(start);
  });
  it("E2 結束（750ms）起是終點外框（四周各 24 像素）", () => {
    expect(cardFrameRect(ENTER.E2[1], start)).toEqual(CARD_FRAME_FULL);
    expect(cardFrameRect(1000, start)).toEqual(CARD_FRAME_FULL);
    expect(CARD_FRAME_FULL.x * 640).toBeCloseTo(24, 9);
    expect((CARD_FRAME_FULL.x + CARD_FRAME_FULL.w) * 640).toBeCloseTo(640 - 24, 9);
    expect(CARD_FRAME_FULL.y * 360).toBeCloseTo(24, 9);
  });
  it("E2 中間單調展開、不超出終點", () => {
    let prev = cardFrameRect(ENTER.E2[0], start);
    for (let t = ENTER.E2[0] + 10; t <= ENTER.E2[1]; t += 10) {
      const r = cardFrameRect(t, start);
      expect(r.w).toBeGreaterThanOrEqual(prev.w - 1e-12);
      expect(r.h).toBeGreaterThanOrEqual(prev.h - 1e-12);
      expect(r.x).toBeLessThanOrEqual(prev.x + 1e-12);
      prev = r;
    }
    expect(lerpRect(start, CARD_FRAME_FULL, 0)).toEqual(start);
  });
});

describe("signal lock 格子", () => {
  it("進入：E2 開始 0 格、750ms 前到 3 格（▮▮▮▯）、E4 開始（1000ms）第 4 格", () => {
    expect(lockCells("enter", 0)).toBe(0);
    expect(lockCells("enter", ENTER.E2[0])).toBe(0);
    expect(lockCells("enter", 624)).toBe(0);
    expect(lockCells("enter", 625)).toBe(1);
    expect(lockCells("enter", 675)).toBe(2);
    expect(lockCells("enter", 725)).toBe(3);
    expect(lockCells("enter", ENTER.E2[1] - 1)).toBe(3);
    expect(lockCells("enter", ENTER.E3[0])).toBe(3);
    expect(lockCells("enter", ENTER.E4[0] - 1)).toBe(3);
    expect(lockCells("enter", ENTER.E4[0])).toBe(4);
    expect(lockCells("enter", ENTER.total)).toBe(4);
  });
  it("逐格單調、一次一格", () => {
    let prev = 0;
    for (let t = 0; t <= ENTER.total; t++) {
      const n = lockCells("enter", t);
      expect(n).toBeGreaterThanOrEqual(prev);
      expect(n - prev).toBeLessThanOrEqual(1);
      prev = n;
    }
    expect(ENTER_LOCK_AT).toHaveLength(4);
  });
  it("短轉場：交接點（75ms）前 3 格，訊號鎖定（150ms）第 4 格；離開沒有", () => {
    expect(lockCells("switch", SWITCH.handoff)).toBe(3);
    expect(lockCells("switch", SWITCH.lock[0] - 1)).toBe(3);
    expect(lockCells("switch", SWITCH.lock[0])).toBe(4);
    expect(lockCells("exit", 100)).toBe(0);
  });
});

describe("雜訊不透明度與顆粒強度（最後 60ms 完全乾淨）", () => {
  it("進入：E3 之前沒有、E3 起 0.55、交接點前升到 1、交接點後 0.85", () => {
    expect(enterNoise(ENTER.E3[0] - 1)).toEqual({ opacity: 0, grain: 0 });
    expect(enterNoise(ENTER.E3[0]).opacity).toBeCloseTo(0.55, 10);
    expect(enterNoise(ENTER.handoff - 60).opacity).toBeCloseTo(1, 10);
    expect(enterNoise(ENTER.handoff).opacity).toBe(1);
    expect(enterNoise(ENTER.handoff + 20).opacity).toBe(0.85);
    expect(enterNoise(ENTER.E4[0] - 1).opacity).toBe(0.85);
    expect(enterNoise(ENTER.E3[0]).grain).toBe(1);
  });
  it("E4：不透明度與顆粒強度一起單調淡出，且同步到 0", () => {
    let prevO = 1;
    let prevG = 1;
    for (let t = ENTER.E4[0]; t < ENTER.total; t++) {
      const n = enterNoise(t);
      expect(n.opacity).toBeLessThanOrEqual(prevO + 1e-12);
      expect(n.grain).toBeLessThanOrEqual(prevG + 1e-12);
      expect(n.opacity).toBeCloseTo(0.85 * n.grain, 10);
      prevO = n.opacity;
      prevG = n.grain;
    }
  });
  it("最後 60ms（1140–1200）不透明度與顆粒強度都是 0", () => {
    expect(NOISE_CLEAN_TAIL_MS).toBe(60);
    for (let t = ENTER.total - 60; t <= ENTER.total + 5; t += 1) expect(enterNoise(t)).toEqual({ opacity: 0, grain: 0 });
    expect(enterNoise(ENTER.total - 61).opacity).toBeGreaterThan(0);
    expect(enterNoise(ENTER.total - 61).grain).toBeGreaterThan(0);
  });
  it("短轉場：0–75ms 1、75–150ms 0.85、之後一起淡出，最後 60ms 乾淨", () => {
    for (const t of [0, 1, SWITCH.handoff - 1]) expect(switchNoise(t).opacity).toBe(1);
    for (const t of [SWITCH.handoff, 100, 149]) expect(switchNoise(t).opacity).toBe(0.85);
    expect(switchNoise(SWITCH.lock[0]).opacity).toBeCloseTo(0.85, 10);
    expect(switchNoise(195).opacity).toBeCloseTo(0.425, 10);
    expect(switchNoise(195).grain).toBeCloseTo(0.5, 10);
    for (let t = SWITCH.total - 60; t <= SWITCH.total + 5; t++) expect(switchNoise(t)).toEqual({ opacity: 0, grain: 0 });
  });
});

describe("水平撕裂與垂直滾動（決定性）", () => {
  it("撕裂帶 3–5 條：任何 seed 都在範圍內，且三種數量都出得來", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 200; seed++) {
      const n = tearCount(seed);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
      expect(tearBands(seed)).toHaveLength(n);
      seen.add(n);
    }
    expect(seen).toEqual(new Set([3, 4, 5]));
  });
  it("同一個 seed 永遠同一組帶（決定性）；帶不重疊、由上到下、都在畫面內", () => {
    expect(tearBands(7)).toEqual(tearBands(7));
    for (const seed of [1, 2, 3, 42, 99]) {
      const bands = tearBands(seed);
      bands.forEach((b, i) => {
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y + b.h).toBeLessThanOrEqual(1 + 1e-9);
        if (i > 0) expect(b.y).toBeGreaterThanOrEqual(bands[i - 1]!.y + bands[i - 1]!.h - 1e-9);
      });
    }
  });
  it("位移：強度 0 沒有位移；同一時刻決定性；每 33ms 換一次", () => {
    const b = tearBands(5)[0]!;
    expect(tearDx(b, 0, 5, 800, 0)).toBe(0);
    expect(tearDx(b, 0, 5, 800, 1)).toBe(tearDx(b, 0, 5, 800, 1));
    expect(tearDx(b, 0, 5, 800, 1)).toBe(tearDx(b, 0, 5, 801, 1)); // 同一個 33ms 區間
    expect(Math.abs(tearDx(b, 0, 5, 800, 1))).toBeLessThanOrEqual(b.amp);
  });
  it("撕裂強度包絡：只在 E3（進入）／雜訊段（短轉場）", () => {
    expect(tearStrength("enter", ENTER.E3[0] - 1)).toBe(0);
    expect(tearStrength("enter", ENTER.E3[0])).toBe(1);
    expect(tearStrength("enter", ENTER.E3[1] - 1)).toBeCloseTo(0.4, 1);
    expect(tearStrength("enter", ENTER.E3[1])).toBe(0);
    expect(tearStrength("switch", 0)).toBe(1);
    expect(tearStrength("switch", SWITCH.noise[1])).toBe(0);
    expect(tearStrength("exit", 100)).toBe(0);
  });
  it("垂直滾動：一次減速的滾動，k=0 在原位、k=1 剛好滾完一圈（接縫對齊）", () => {
    expect(rollFrac(0)).toBe(0);
    expect(rollFrac(1)).toBe(1);
    let prevStep = Infinity;
    for (let i = 0; i < 10; i++) {
      const step = rollFrac((i + 1) / 10) - rollFrac(i / 10);
      expect(step).toBeLessThan(prevStep); // 減速：每一段的位移越來越小
      prevStep = step;
    }
    expect(enterRollPx(ENTER.E3[0])).toBe(0);
    expect(enterRollPx(ENTER.E3[1])).toBe(0);
    expect(enterRollPx(ENTER.E3[0] + 1)).toBeGreaterThan(0);
    expect(enterRollPx(875)).toBe(enterRollPx(875)); // 決定性
  });
  it("hash01 在 [0,1) 且決定性", () => {
    for (let i = 0; i < 100; i++) {
      const v = hash01(i, i * 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(hash01(3, 4)).toBe(hash01(3, 4));
  });
});

describe("台標落點（E4）", () => {
  const start = tagStartRect(1920, 1080, 3.6);
  const target: Rect = { x: 1790.3, y: 20.5, w: 50.4, h: 14 };
  it("起點在螢幕中央偏上，寬度跟高度成比例", () => {
    expect(start.x + start.w / 2).toBeCloseTo(960, 6);
    expect(start.w / start.h).toBeCloseTo(3.6, 10);
  });
  it("落點終點等於真實台標矩形（誤差 0）；起點等於中央矩形", () => {
    expect(tagLerp(1, start, target)).toEqual(target);
    expect(tagLerp(0, start, target)).toEqual(start);
    expect(tagLerp(2, start, target)).toEqual(target);
  });
  it("進入：600ms 起顯示、1000ms 開始縮、1140ms 落地後疊層上沒有台標（最後 60ms 乾淨）", () => {
    expect(ENTER_TAG).toEqual({ showFrom: 600, landFrom: 1000, landTo: 1140 });
    expect(tagRectAt(ENTER_TAG, 599, start, target)).toBeNull();
    expect(tagRectAt(ENTER_TAG, 600, start, target)).toEqual(start);
    expect(tagRectAt(ENTER_TAG, 999, start, target)).toEqual(start);
    const mid = tagRectAt(ENTER_TAG, 1070, start, target)!;
    expect(mid.x).toBeGreaterThan(start.x);
    expect(mid.x).toBeLessThan(target.x);
    expect(mid.h).toBeLessThan(start.h);
    expect(mid.h).toBeGreaterThan(target.h);
    const last = tagRectAt(ENTER_TAG, 1139.999, start, target)!;
    expect(Math.abs(last.x - target.x)).toBeLessThan(0.01);
    expect(Math.abs(last.h - target.h)).toBeLessThan(0.01);
    expect(tagRectAt(ENTER_TAG, 1140, start, target)).toBeNull();
    expect(tagRectAt(ENTER_TAG, 1199, start, target)).toBeNull();
  });
  it("短轉場：0 起顯示、150ms 縮、240ms 落地", () => {
    expect(SWITCH_TAG).toEqual({ showFrom: 0, landFrom: 150, landTo: 240 });
    expect(tagRectAt(SWITCH_TAG, 0, start, target)).toEqual(start);
    expect(tagRectAt(SWITCH_TAG, 239.999, start, target)!.x).toBeCloseTo(target.x, 1);
    expect(tagRectAt(SWITCH_TAG, 240, start, target)).toBeNull();
    expect(tagPlanOf("enter")).toBe(ENTER_TAG);
    expect(tagPlanOf("switch")).toBe(SWITCH_TAG);
    expect(tagPlanOf("exit")).toBeNull();
  });
  it("卡片文字（OSD）在鎖定後淡出，最後 60ms 之前就全消失", () => {
    expect(osdAlpha("enter", 1000)).toBe(1);
    expect(osdAlpha("enter", 1130)).toBe(0);
    expect(osdAlpha("enter", ENTER.total - 60)).toBe(0);
    expect(osdAlpha("switch", 225)).toBe(0);
    expect(osdAlpha("switch", SWITCH.total - 60)).toBe(0);
    expect(osdAlpha("exit", 0)).toBe(0);
  });
});

describe("離開 X1–X3 的亮面塊／亮線／亮點", () => {
  const W = 640;
  const H = 360;
  const block = exitBlockRect(1920, 1080);
  it("面塊＝工作站外框範圍（左右 10px、上 8px、下 10px）", () => {
    expect(block.x * 1920).toBeCloseTo(10, 9);
    expect((block.x + block.w) * 1920).toBeCloseTo(1910, 9);
    expect(block.y * 1080).toBeCloseTo(8, 9);
    expect((block.y + block.h) * 1080).toBeCloseTo(1070, 9);
  });
  it("t=0：整個面塊；置中", () => {
    const g = exitGeometry(0, W, H, block);
    expect(g.kind).toBe("block");
    expect(g.w).toBeCloseTo(block.w * W, 9);
    expect(g.h).toBeCloseTo(block.h * H, 9);
    expect(g.heat).toBe(0);
    expect(g.alpha).toBe(1);
  });
  it("X1（0–150）垂直壓成亮線，寬度不變；ease-in（前半段壓得少）", () => {
    const half = exitGeometry(75, W, H, block);
    const full = exitGeometry(150, W, H, block);
    expect(full.h).toBeCloseTo(EXIT_LINE_H, 9);
    expect(full.w).toBeCloseTo(block.w * W, 9);
    expect(half.w).toBeCloseTo(block.w * W, 9);
    const total = block.h * H - EXIT_LINE_H;
    expect(block.h * H - half.h).toBeLessThan(total / 2);
    expect(full.heat).toBe(1);
    expect(full.y + full.h / 2).toBeCloseTo(H / 2, 9);
  });
  it("X2（150–300）亮線水平收成亮點", () => {
    const start = exitGeometry(150, W, H, block);
    const end = exitGeometry(EXIT.X2[1], W, H, block);
    expect(start.w).toBeCloseTo(block.w * W, 9);
    expect(end.w).toBeCloseTo(EXIT_DOT, 9);
    expect(end.h).toBeCloseTo(EXIT_DOT, 9);
    expect(end.kind).toBe("dot");
    expect(end.x + end.w / 2).toBeCloseTo(W / 2, 9);
    expect(exitGeometry(225, W, H, block).w).toBeGreaterThan(EXIT_DOT);
  });
  it("X3（300–400）亮點淡出；400ms 起沒有東西", () => {
    expect(exitGeometry(EXIT.X3[0], W, H, block).alpha).toBe(1);
    expect(exitGeometry(350, W, H, block).alpha).toBeCloseTo(0.5, 10);
    expect(exitGeometry(EXIT.X3[1] - 1, W, H, block).alpha).toBeLessThan(0.02);
    expect(exitGeometry(EXIT.X3[1], W, H, block).kind).toBe("none");
    expect(exitGeometry(EXIT.X3[1], W, H, block).alpha).toBe(0);
    expect(exitGeometry(EXIT.total, W, H, block).kind).toBe("none");
  });
  it("單調：面塊只會越來越小（t 0→300）", () => {
    let area = Infinity;
    for (let t = 0; t <= 300; t += 5) {
      const g = exitGeometry(t, W, H, block);
      expect(g.w * g.h).toBeLessThanOrEqual(area + 1e-9);
      area = g.w * g.h;
    }
  });
});
