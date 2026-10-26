import { emptyFilter } from "@shared/aggregate";
import { describe, expect, it } from "vitest";
import { drillFilter, recordsLocation } from "@/lib/drill";
import { makeRecord, sampleRecords } from "@/test/recordsHarness";
import { chronological, dateLabel, isDateRangeReversed, mdLabel, multiOptions, plausibleDate } from "./filterUtils";

describe("日期框的中間值", () => {
  it("plausibleDate：年份 < 1900 的中間值忽略，空字串（清除）算合理", () => {
    expect(plausibleDate("")).toBe(true);
    expect(plausibleDate("2026-10-26")).toBe(true);
    expect(plausibleDate("1900-01-01")).toBe(true);
    for (const v of ["0002-10-26", "0020-10-26", "0202-10-26", "1899-12-31"]) expect(plausibleDate(v)).toBe(false);
  });

  it("起 > 迄只判斷、不改任何一端", () => {
    expect(isDateRangeReversed({ from: "2026-10-26", to: "2026-10-01" })).toBe(true);
    expect(isDateRangeReversed({ from: "2026-10-01", to: "2026-10-26" })).toBe(false);
    expect(isDateRangeReversed({ from: "2026-10-01", to: "" })).toBe(false);
  });
});

describe("日期標籤", () => {
  const now = new Date(2026, 9, 26); // 2026-10-26 週一

  it("不是今年的日期帶年份", () => {
    expect(mdLabel("2026-10-05", now)).toBe("10/05");
    expect(mdLabel("2025-10-05", now)).toBe("2025/10/05");
  });

  it("符合快捷就顯示快捷名稱；單日顯示日期；半開區間用「…」", () => {
    expect(dateLabel({ from: "2026-10-26", to: "2026-10-26" }, now)).toBe("今天");
    expect(dateLabel({ from: "2026-10-20", to: "2026-10-20" }, now)).toBe("10/20");
    expect(dateLabel({ from: "2026-10-01", to: "2026-10-15" }, now)).toBe("10/01–10/15");
    expect(dateLabel({ from: "2026-10-01", to: "" }, now)).toBe("10/01–…");
    expect(dateLabel({ from: "", to: "2026-10-15" }, now)).toBe("…–10/15");
    expect(dateLabel({ from: "", to: "" }, now)).toBe("");
  });
});

describe("multiOptions（設備／分類下拉的選項）", () => {
  const active = [
    makeRecord({ id: 1, equipment: "F3" }),
    makeRecord({ id: 2, equipment: "F3" }),
    makeRecord({ id: 3, equipment: "F3" }),
    makeRecord({ id: 4, equipment: "G5" }),
    makeRecord({ id: 5, equipment: "G5" }),
    makeRecord({ id: 6, equipment: "F4" }),
  ];

  it("= 已知清單 ∪ 資料裡出現過的 ∪ 已選的（沒有紀錄的也在），依全部紀錄的總筆數由多到少", () => {
    const opts = multiOptions("equipment", ["F4", "RB2"], active, ["原材區1"]);
    expect(opts).toEqual(["F3", "G5", "F4", "原材區1", "RB2"]);
  });

  it("總筆數相同時依名稱排序，順序不受目前篩選影響", () => {
    expect(multiOptions("equipment", [], [makeRecord({ id: 1, equipment: "G5" }), makeRecord({ id: 2, equipment: "F3" })], [])).toEqual([
      "F3",
      "G5",
    ]);
  });

  it("軟刪除的紀錄不影響筆數順序（呼叫端只傳有效紀錄）", () => {
    expect(multiOptions("category", [], sampleRecords().filter((r) => !r.deleted), [])[0]).toBe("取料異常");
  });
});

describe("chronological（詳情的上一筆／下一筆順序）", () => {
  it("依 日期＋時間 由舊到新；同一時間用 id 當決勝", () => {
    const list = [
      makeRecord({ id: 3, date: "2026-10-22", time: "10:00" }),
      makeRecord({ id: 2, date: "2026-10-22", time: "10:00" }),
      makeRecord({ id: 1, date: "2026-10-22", time: "09:59" }),
      makeRecord({ id: 4, date: "2026-10-21", time: "23:59" }),
    ];
    expect(chronological(list).map((r) => r.id)).toEqual([4, 1, 2, 3]);
  });

  it("不改動原本的陣列", () => {
    const list = [makeRecord({ id: 2, date: "2026-10-22" }), makeRecord({ id: 1, date: "2026-10-21" })];
    chronological(list);
    expect(list.map((r) => r.id)).toEqual([2, 1]);
  });
});

describe("drillTo：先清掉舊條件再帶入單一值", () => {
  it("設備／分類是陣列；其餘條件全是空的", () => {
    expect(drillFilter("equipment", "F3")).toEqual({ ...emptyFilter(), equipment: ["F3"] });
    expect(drillFilter("category", "缺料")).toEqual({ ...emptyFilter(), category: ["缺料"] });
  });

  it("日期是 from = to（單日）", () => {
    expect(drillFilter("date", "2026-10-24")).toEqual({ ...emptyFilter(), from: "2026-10-24", to: "2026-10-24" });
  });

  it("嚴重度、狀態是單一字串", () => {
    expect(drillFilter("severity", "重大")).toEqual({ ...emptyFilter(), severity: "重大" });
    expect(drillFilter("status", "追蹤中")).toEqual({ ...emptyFilter(), status: "追蹤中" });
  });

  it("產生的網址只有那一個條件", () => {
    expect(recordsLocation(drillFilter("status", "待處理"))).toEqual({ pathname: "/records", search: "?status=%E5%BE%85%E8%99%95%E7%90%86" });
    expect(recordsLocation(drillFilter("date", "2026-10-24")).search).toBe("?from=2026-10-24&to=2026-10-24");
  });
});
