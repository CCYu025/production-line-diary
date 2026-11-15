import { describe, expect, it } from "vitest";
import type { DiaryRecord } from "@/lib/types";
import {
  ADVANCE_PER_TURN,
  buildSpiral,
  CARD_MIN_WIDTH,
  cardWidth,
  clampDay,
  cursorAnchor,
  dayNumber,
  dayNumberToDate,
  FULL_CARD_CAP,
  keyToDays,
  lodRanges,
  rangeSize,
  SPIRAL_RADIUS,
  spiralPoint,
  timeFraction,
  wheelToDays,
} from "./spiral";

function rec(id: number, date: string, time: string, extra: Partial<DiaryRecord> = {}): DiaryRecord {
  return {
    id,
    date,
    shift: "早",
    time,
    duration: 10,
    equipment: "F3",
    category: "取料異常",
    problem: "p",
    severity: "一般",
    action: "a",
    rootCause: null,
    status: "已解決",
    productCode: null,
    materialCategory: null,
    photos: [],
    updatedAt: null,
    deleted: false,
    deletedAt: null,
    ...extra,
  };
}

/** 每天 perDay 筆、往回推 days 天的合成紀錄 */
function synth(days: number, perDay: number, end = "2026-11-01"): DiaryRecord[] {
  const out: DiaryRecord[] = [];
  const endDay = dayNumber(end);
  let id = 1;
  for (let d = days - 1; d >= 0; d--) {
    for (let k = 0; k < perDay; k++) out.push(rec(id++, dayNumberToDate(endDay - d), `${String(6 + k).padStart(2, "0")}:00`));
  }
  return out;
}

describe("dayNumber／timeFraction（本地時間字串，不轉 UTC）", () => {
  it("相鄰日期差 1，跨夏令時間的月份也一樣（與時區無關）", () => {
    expect(dayNumber("2026-03-29") - dayNumber("2026-03-28")).toBe(1);
    expect(dayNumber("2026-11-01") - dayNumber("2026-10-31")).toBe(1);
    expect(dayNumberToDate(dayNumber("2026-02-28") + 1)).toBe("2026-03-01");
  });
  it("不存在的日期是 NaN", () => {
    expect(dayNumber("2026-02-30")).toBeNaN();
    expect(dayNumber("abc")).toBeNaN();
  });
  it("23:59 在下一天 00:00 之前（字串順序），一天內時間是 0–1", () => {
    const m = buildSpiral([rec(1, "2026-05-01", "23:59"), rec(2, "2026-05-02", "00:00")]);
    expect(m.items.map((i) => i.id)).toEqual([1, 2]);
    expect(m.items[0]!.t).toBeLessThan(m.items[1]!.t);
    expect(timeFraction("12:00")).toBeCloseTo(0.5, 9);
    expect(timeFraction("9:30")).toBeGreaterThan(0);
    expect(timeFraction("bad")).toBe(0);
  });
});

describe("螺旋位置", () => {
  it("一圈 7 天：同一時刻差 7 天，角度同相、z 前進 4、半徑 6", () => {
    const a = spiralPoint(100, 100, 0);
    const b = spiralPoint(93, 100, 0);
    expect(a.radius).toBe(SPIRAL_RADIUS);
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(SPIRAL_RADIUS, 9);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
    expect(a.z - b.z).toBeCloseTo(ADVANCE_PER_TURN, 9);
  });
  it("最新的在 z = 0，越舊越負", () => {
    const m = buildSpiral(synth(30, 2));
    expect(m.items[m.items.length - 1]!.z).toBeCloseTo(0, 9);
    expect(m.items[0]!.z).toBeLessThan(m.items[10]!.z);
  });
  it("同一天沿徑向往外疊（半徑遞增、順序沿用 chronological）", () => {
    const m = buildSpiral([rec(3, "2026-05-01", "15:00"), rec(1, "2026-05-01", "08:00"), rec(2, "2026-05-01", "08:00")]);
    expect(m.items.map((i) => i.id)).toEqual([1, 2, 3]);
    const radii = m.items.map((i) => i.radius);
    expect(radii[1]).toBeGreaterThan(radii[0]!);
    expect(radii[2]).toBeGreaterThan(radii[1]!);
  });
  it("軟刪除的紀錄不上螺旋；空資料不爆", () => {
    expect(buildSpiral([rec(1, "2026-05-01", "08:00", { deleted: true })]).items).toHaveLength(0);
    expect(buildSpiral([]).weeks).toEqual([]);
  });
  it("寬度代表耗時，有下限：耗時 0 也看得到", () => {
    expect(cardWidth(0)).toBe(CARD_MIN_WIDTH);
    expect(cardWidth(-5)).toBe(CARD_MIN_WIDTH);
    expect(cardWidth(60)).toBeGreaterThan(cardWidth(10));
    expect(cardWidth(1e9)).toBeLessThanOrEqual(3);
  });
});

describe("LOD（5,000 筆）", () => {
  const model = buildSpiral(synth(1000, 5)); // 5,000 筆，約 143 週
  it("完整卡片 ≤ 1,500；小方點在 8–52 週；其餘是刻度線；範圍不重疊", () => {
    expect(model.items.length).toBe(5000);
    for (const cursor of [model.maxDay, model.maxDay - 180, model.minDay + 20]) {
      const r = lodRanges(model, cursor);
      expect(rangeSize(r.full)).toBeLessThanOrEqual(FULL_CARD_CAP);
      for (let i = r.full[0]; i < r.full[1]; i++) expect(Math.abs(model.items[i]!.day - cursor)).toBeLessThanOrEqual(8 * 7);
      for (const [a, b] of [r.dotsBefore, r.dotsAfter] as const) {
        for (let i = a; i < b; i++) expect(Math.abs(model.items[i]!.day - cursor)).toBeLessThanOrEqual(52 * 7);
      }
      expect(r.dotsBefore[1]).toBe(r.full[0]);
      expect(r.dotsAfter[0]).toBe(r.full[1]);
      for (let w = r.ticksBefore[0]; w < r.ticksBefore[1]; w++) expect(cursor - model.weeks[w]!.startDay).toBeGreaterThan(52 * 7 - 7);
      for (let w = r.ticksAfter[0]; w < r.ticksAfter[1]; w++) expect(model.weeks[w]!.startDay - cursor).toBeGreaterThan(52 * 7 - 1);
    }
  });
  it("每天 11 筆的極端密度：上限把多出的收成小方點", () => {
    const dense = buildSpiral(synth(400, 11));
    const r = lodRanges(dense, dense.maxDay - 100, { cap: 800 });
    expect(rangeSize(r.full)).toBe(800);
    expect(rangeSize(r.dotsBefore) + rangeSize(r.dotsAfter)).toBeGreaterThan(0);
  });
  it("20,000 筆也成立", () => {
    const big = buildSpiral(synth(3500, 6));
    expect(big.items.length).toBe(21000);
    expect(rangeSize(lodRanges(big, big.maxDay).full)).toBeLessThanOrEqual(FULL_CARD_CAP);
  });
});

describe("游標", () => {
  it("滾輪向下＝往過去一天，Shift 一週；PageUp／PageDown", () => {
    expect(wheelToDays(100, false)).toBe(-1);
    expect(wheelToDays(-100, false)).toBe(1);
    expect(wheelToDays(100, true)).toBe(-7);
    expect(wheelToDays(0, false)).toBe(0);
    expect(keyToDays("PageUp", false)).toBe(1);
    expect(keyToDays("PageDown", true)).toBe(-7);
    expect(keyToDays("a", false)).toBe(0);
  });
  it("夾在資料範圍內", () => {
    const m = buildSpiral(synth(10, 1));
    expect(clampDay(m.maxDay + 50, m)).toBe(m.maxDay);
    expect(clampDay(m.minDay - 50, m)).toBe(m.minDay);
  });
});

describe("cursorAnchor（終端板錨點）", () => {
  const m = buildSpiral([rec(1, "2026-05-01", "08:00"), rec(2, "2026-05-01", "15:00"), rec(3, "2026-05-04", "09:00")]);
  it("游標那天有卡片：用那天第一張卡片（最早那筆）的位置", () => {
    const d = dayNumber("2026-05-01");
    const a = cursorAnchor(m, d);
    const first = m.items.find((it) => it.day === d)!;
    expect(a.card).toBe(true);
    expect([a.x, a.y, a.z]).toEqual([first.x, first.y, first.z]);
    expect(first.id).toBe(1);
  });
  it("那天沒有卡片：用螺旋上那一天的固定錨點（最內圈、與 z 軸位置一致）", () => {
    const d = dayNumber("2026-05-02");
    const a = cursorAnchor(m, d);
    expect(a.card).toBe(false);
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(SPIRAL_RADIUS, 9);
    const p = spiralPoint(d + 0.4, m.originT, 0);
    expect([a.x, a.y, a.z]).toEqual([p.x, p.y, p.z]);
  });
  it("沒有紀錄時也不丟錯", () => {
    expect(cursorAnchor(buildSpiral([]), 0).card).toBe(false);
  });
});
