import { describe, expect, it } from "vitest";
import type { DiaryRecord } from "@/lib/types";
import { CHANNELS } from "../channels";
import { computeSignals, countSignals, HUB_REFETCH_MS, localDateParts, refetchIntervalFor, signalKey } from "./signals";

let nextId = 1;
function rec(over: Partial<DiaryRecord> = {}): DiaryRecord {
  return {
    id: nextId++,
    date: "2026-11-01",
    shift: "早",
    time: "08:00",
    duration: 5,
    equipment: "F3",
    category: "機械",
    problem: "卡料",
    severity: "輕微",
    action: "",
    rootCause: null,
    status: "已解決",
    productCode: null,
    materialCategory: null,
    photos: [],
    updatedAt: null,
    deleted: false,
    deletedAt: null,
    ...over,
  };
}

// 本機時間 2026-11-01 14:00
const NOW = new Date(2026, 10, 1, 14, 0, 0);

describe("countSignals", () => {
  it("待處理＝狀態待處理且未刪除", () => {
    const c = countSignals([rec({ status: "待處理" }), rec({ status: "待處理", deleted: true }), rec({ status: "追蹤中" }), rec()], NOW);
    expect(c.pending).toBe(1);
  });
  it("今日＝本機今天、未刪除；本月＝本機年月、未刪除", () => {
    const c = countSignals(
      [
        rec(),
        rec(),
        rec({ date: "2026-11-01", deleted: true }),
        rec({ date: "2026-10-31" }),
        rec({ date: "2026-11-30" }),
        rec({ date: "2025-11-01" }),
      ],
      NOW,
    );
    expect(c.today).toBe(2);
    expect(c.month).toBe(3); // 兩筆今天＋11-30（已刪除、10 月、去年都不算）
  });
  it("回收桶＝已刪除筆數", () => {
    expect(countSignals([rec({ deleted: true }), rec({ deleted: true }), rec()], NOW).trash).toBe(2);
  });
  it("機台數＝未刪除紀錄的不重複設備（已刪除的設備不算、空白不算）", () => {
    const c = countSignals(
      [rec({ equipment: "F3" }), rec({ equipment: "F3" }), rec({ equipment: "RB2" }), rec({ equipment: "CCD", deleted: true }), rec({ equipment: "" })],
      NOW,
    );
    expect(c.machines).toBe(2);
  });
  it("本機日期而非 UTC：本機 00:30 仍算當天", () => {
    const early = new Date(2026, 10, 1, 0, 30, 0);
    expect(localDateParts(early)).toEqual({ iso: "2026-11-01", month: "2026-11", short: "11/01" });
    expect(countSignals([rec({ date: "2026-11-01" })], early).today).toBe(1);
  });
});

describe("computeSignals", () => {
  const records = [rec({ status: "待處理" }), rec({ status: "待處理", equipment: "RB2" }), rec({ deleted: true }), rec({ date: "2026-10-20" })];
  const s = computeSignals(records, NOW);

  it("七個頻道都有", () => expect(Object.keys(s)).toEqual(CHANNELS.map((c) => c.id)));
  it("HUD 短標籤", () => {
    expect(s["CH-01"].hudLabel).toBe("待處理 2");
    expect(s["CH-02"].hudLabel).toBe("今日 2");
    expect(s["CH-03"].hudLabel).toBe("READY");
    expect(s["CH-04"].hudLabel).toBe("今日 2");
    expect(s["CH-05"].hudLabel).toBe("本月 2");
    expect(s["CH-06"].hudLabel).toBe("1 筆");
    expect(s["CH-07"].hudLabel).toBe("2 台");
  });
  it("按鈕文字與 accessible name：CH-02 紀錄 · 今日 2", () => {
    expect(s["CH-02"].name).toBe("CH-02 紀錄 · 今日 2");
    expect(s["CH-06"].name).toBe("CH-06 回收桶 · 1 筆");
    expect(s["CH-07"].name).toBe("CH-07 設定 · 2 台");
  });
  it("螢幕文字：CH-04 是 MM/DD ＋ 當日筆數；CH-03 是 READY＋閃爍游標", () => {
    expect(s["CH-04"].caption).toBe("11/01");
    expect(s["CH-04"].big).toBe("2");
    expect(s["CH-03"].big).toBe("READY");
    expect(s["CH-03"].blinkCursor).toBe(true);
    expect(s["CH-02"].blinkCursor).toBe(false);
    expect(s["CH-01"].big).toBe("2");
  });
  it("資料還沒載入：只有名稱，沒有數字（CH-03 螢幕仍是 READY）", () => {
    const n = computeSignals(undefined, NOW);
    expect(n["CH-02"].name).toBe("CH-02 紀錄");
    expect(n["CH-02"].hudLabel).toBeUndefined();
    expect(n["CH-02"].big).toBeNull();
    expect(n["CH-03"].name).toBe("CH-03 新增");
    expect(n["CH-03"].big).toBe("READY");
  });
  it("零筆也是有效數字（不是未載入）", () => {
    const z = computeSignals([], NOW);
    expect(z["CH-02"].name).toBe("CH-02 紀錄 · 今日 0");
    expect(z["CH-07"].hudLabel).toBe("0 台");
  });
  it("signalKey：內容不變鍵不變", () => {
    expect(signalKey(s["CH-02"])).toBe(signalKey(computeSignals(records, new Date(2026, 10, 1, 23, 59))["CH-02"]));
    expect(signalKey(s["CH-02"])).not.toBe(signalKey(computeSignals([], NOW)["CH-02"]));
  });
});

describe("refetchIntervalFor（§4.4：只在 HUB 且分頁可見時輪詢）", () => {
  it("HUB＋可見＝30 秒", () => expect(refetchIntervalFor(true, true)).toBe(HUB_REFETCH_MS));
  it("HUB_REFETCH_MS 是 30 秒", () => expect(HUB_REFETCH_MS).toBe(30_000));
  it("不在 HUB 或分頁隱藏＝停止", () => {
    expect(refetchIntervalFor(false, true)).toBe(false);
    expect(refetchIntervalFor(true, false)).toBe(false);
    expect(refetchIntervalFor(false, false)).toBe(false);
  });
});
