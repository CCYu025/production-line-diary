// 刻意把時區設成 Asia/Taipei（UTC+8）：預設日期「本地 vs UTC」的差別只有在非 UTC 時區才測得出來，
// CI 跑 UTC 的話永遠測不出（同 test/localDate.test.js；不要移除這一行）。
process.env.TZ = "Asia/Taipei";

import { describe, expect, it } from "vitest";
import { makeRecord } from "@/test/recordsHarness";
import type { DiaryRecord, RankEntry } from "@/lib/types";
import {
  RANK_TOP,
  buildRankTable,
  dayHeader,
  defaultReportRange,
  formatGeneratedAt,
  groupByDay,
  photoGridClass,
  rangeLabel,
  selectReportRecords,
  validateReportRange,
} from "./reportModel";

const row = (label: string, count: number, minutes: number): RankEntry => ({ label, count, minutes });

describe("defaultReportRange（本地日期，不是 UTC）", () => {
  it("台灣 00:30（UTC 還是前一天）預設仍是今天", () => {
    const now = new Date("2026-10-25T16:30:00Z"); // = 台灣 2026-10-26 00:30
    expect(now.getTimezoneOffset()).toBe(-480); // 時區設定有生效，這個測試才有意義
    expect(now.toISOString().slice(0, 10)).toBe("2026-10-25"); // 舊的錯誤寫法會得到昨天
    expect(defaultReportRange(now)).toEqual({ start: "2026-10-26", end: "2026-10-26" });
  });

  it("起迄都是同一天", () => {
    const r = defaultReportRange(new Date(2026, 0, 5, 23, 59));
    expect(r).toEqual({ start: "2026-01-05", end: "2026-01-05" });
  });
});

describe("validateReportRange", () => {
  it("沒選日期、起 > 迄會回錯誤訊息（與舊 UI 相同），其餘 null", () => {
    expect(validateReportRange({ start: "", end: "2026-10-26" })).toBe("請選擇起訖日期");
    expect(validateReportRange({ start: "2026-10-26", end: "" })).toBe("請選擇起訖日期");
    expect(validateReportRange({ start: "2026-10-27", end: "2026-10-26" })).toBe("起始日期不能晚於結束日期");
    expect(validateReportRange({ start: "2026-10-26", end: "2026-10-26" })).toBeNull();
  });
});

describe("selectReportRecords", () => {
  const all: DiaryRecord[] = [
    makeRecord({ id: 1, date: "2026-10-21", time: "10:00" }),
    makeRecord({ id: 2, date: "2026-10-20", time: "23:00" }),
    makeRecord({ id: 3, date: "2026-10-20", time: "08:00" }),
    makeRecord({ id: 4, date: "2026-10-22", time: "09:00", deleted: true, deletedAt: "2026-10-23T00:00:00" }),
    makeRecord({ id: 5, date: "2026-10-19", time: "09:00" }),
    makeRecord({ id: 6, date: "2026-10-23", time: "09:00" }),
  ];

  it("起迄含頭尾、排除軟刪除、依時間由舊到新", () => {
    const got = selectReportRecords(all, { start: "2026-10-20", end: "2026-10-22" });
    expect(got.map((r) => r.id)).toEqual([3, 2, 1]);
  });

  it("範圍內沒有紀錄就是空陣列", () => {
    expect(selectReportRecords(all, { start: "2026-01-01", end: "2026-01-02" })).toEqual([]);
  });
});

describe("rangeLabel／formatGeneratedAt", () => {
  it("單日只顯示一個日期，多日用「～」", () => {
    expect(rangeLabel({ start: "2026-10-26", end: "2026-10-26" })).toBe("2026-10-26");
    expect(rangeLabel({ start: "2026-10-20", end: "2026-10-26" })).toBe("2026-10-20 ～ 2026-10-26");
  });
  it("產出時間是 M/D HH:MM", () => {
    expect(formatGeneratedAt(new Date(2026, 0, 5, 9, 7))).toBe("1/5 09:07");
  });
});

describe("buildRankTable（排行表：前 5 名＋其他）", () => {
  it("依次數排序，同次數比累計耗時；名次補零；占比四捨五入", () => {
    const rows = [row("B", 2, 10), row("A", 2, 30), row("C", 5, 1), row("D", 1, 99)];
    const t = buildRankTable(rows, 10);
    expect(t.top.map((r) => r.label)).toEqual(["C", "A", "B", "D"]);
    expect(t.top.map((r) => r.rank)).toEqual(["01", "02", "03", "04"]);
    expect(t.top.map((r) => r.pct)).toEqual([50, 20, 20, 10]);
    expect(t.rest).toBeNull();
    expect(t.totalItems).toBe(4);
    expect(t.restItems).toBe(0);
  });

  it("超過 5 項：只列前 5 名，其餘併成「其他 n 項」（次數、耗時、占比加總，沒有名次與細條）", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`項${i}`, 8 - i, (i + 1) * 10));
    // 次數 8,7,6,5,4,3,2,1 → 前 5 = 8+7+6+5+4 = 30；其他 = 3+2+1 = 6 次、(6+7+8)*10 = 210 分
    const t = buildRankTable(rows, 36);
    expect(RANK_TOP).toBe(5);
    expect(t.top).toHaveLength(5);
    expect(t.top[4]?.label).toBe("項4");
    expect(t.rest).toMatchObject({ label: "其他 3 項", count: 6, minutes: 210, pct: 17, rank: "", barPct: null, isRest: true });
    expect(t.totalItems).toBe(8);
    expect(t.restItems).toBe(3);
  });

  it("細條寬度跟最大那列比，至少 6%", () => {
    const t = buildRankTable([row("大", 100, 1), row("小", 1, 1)], 101);
    expect(t.top.map((r) => r.barPct)).toEqual([100, 6]);
  });

  it("單日報表每項都是 1 次：細條全部一樣長、占比平分", () => {
    const t = buildRankTable([row("a", 1, 5), row("b", 1, 9)], 2);
    expect(t.top.map((r) => r.label)).toEqual(["b", "a"]); // 同次數 → 累計耗時大的在前
    expect(t.top.map((r) => r.barPct)).toEqual([100, 100]);
    expect(t.top.map((r) => r.pct)).toEqual([50, 50]);
  });

  it("沒有資料／總數為 0 不會除以零", () => {
    expect(buildRankTable([], 0)).toMatchObject({ top: [], rest: null, totalItems: 0 });
    expect(buildRankTable([row("x", 0, 0)], 0).top[0]?.pct).toBe(0);
  });

  it("不改動傳進來的陣列（aggregate 的 equipmentRanked 是依分鐘排序，這裡自己重排）", () => {
    const rows = [row("a", 1, 100), row("b", 9, 1)];
    buildRankTable(rows, 10);
    expect(rows.map((r) => r.label)).toEqual(["a", "b"]);
  });
});

describe("groupByDay／dayHeader", () => {
  const recs = [
    makeRecord({ id: 1, date: "2026-10-26", duration: 10 }),
    makeRecord({ id: 2, date: "2026-10-26", duration: 15 }),
    makeRecord({ id: 3, date: "2026-10-27", duration: 7 }),
  ];
  it("相鄰同日期分一組，保持順序", () => {
    const g = groupByDay(recs);
    expect(g.map((x) => [x.date, x.records.map((r) => r.id)])).toEqual([
      ["2026-10-26", [1, 2]],
      ["2026-10-27", [3]],
    ]);
  });
  it("日期標題：M/D（週X）＋筆數＋累計分鐘", () => {
    const [first, second] = groupByDay(recs);
    expect(dayHeader(first!)).toEqual({ title: "10/26（週一）", summary: "2 筆・累計 25 分" });
    expect(dayHeader(second!)).toEqual({ title: "10/27（週二）", summary: "1 筆・累計 7 分" });
  });
});

describe("photoGridClass", () => {
  it("1–6 張對應 n1…n6，超過 6 張仍用 n6，沒有照片是 null", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 12].map(photoGridClass)).toEqual([null, "n1", "n2", "n3", "n4", "n5", "n6", "n6", "n6"]);
  });
});
