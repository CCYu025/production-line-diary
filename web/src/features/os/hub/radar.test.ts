import { describe, expect, it } from "vitest";
import type { DiaryRecord } from "@/lib/types";
import {
  anomalyAnnouncement,
  blipPosition,
  BLIP_TOKEN,
  computeBlips,
  hashName,
  newAnomalyTracker,
  observeAnomalies,
  pulseMachines,
  radarWindow,
  RADAR_RADIUS_MAX,
  RADAR_RADIUS_MIN,
} from "./radar";

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
    status: "待處理",
    productCode: null,
    materialCategory: null,
    photos: [],
    updatedAt: null,
    deleted: false,
    deletedAt: null,
    ...over,
  };
}
const NOW = new Date(2026, 10, 1, 14, 0, 0);

describe("radarWindow：本機日期的 7 天", () => {
  it("今天往前 6 天（含）", () => expect(radarWindow(NOW)).toEqual({ from: "2026-10-26", to: "2026-11-01" }));
  it("跨月跨年", () => expect(radarWindow(new Date(2026, 0, 3))).toEqual({ from: "2025-12-28", to: "2026-01-03" }));
});

describe("computeBlips", () => {
  it("每台有 7 天內紀錄的機台一個光點；視窗外、已刪除、空機台不算", () => {
    const b = computeBlips(
      [
        rec({ equipment: "F3" }),
        rec({ equipment: "F3", date: "2026-10-27" }),
        rec({ equipment: "RB2", date: "2026-10-26" }),
        rec({ equipment: "OLD", date: "2026-10-25" }),
        rec({ equipment: "DEL", deleted: true }),
        rec({ equipment: "" }),
      ],
      NOW,
    );
    expect(b.map((x) => x.machine).sort()).toEqual(["F3", "RB2"]);
    expect(b.find((x) => x.machine === "F3")!.count).toBe(2);
  });
  it("顏色取最嚴重的未解決紀錄", () => {
    const key = (records: DiaryRecord[]) => computeBlips(records, NOW)[0]!.colorKey;
    expect(key([rec({ severity: "輕微" })])).toBe("good");
    expect(key([rec({ severity: "一般" })])).toBe("warning");
    expect(key([rec({ severity: "嚴重" })])).toBe("serious");
    expect(key([rec({ severity: "重大" })])).toBe("critical");
    expect(key([rec({ severity: "輕微" }), rec({ severity: "嚴重", status: "追蹤中" }), rec({ severity: "一般" })])).toBe("serious");
  });
  it("已解決的不算：最嚴重的已解決 → 取剩下未解決中最嚴重；全部已解決 → dim", () => {
    expect(computeBlips([rec({ severity: "重大", status: "已解決" }), rec({ severity: "一般" })], NOW)[0]!.colorKey).toBe("warning");
    expect(computeBlips([rec({ severity: "重大", status: "已解決" }), rec({ status: "已解決" })], NOW)[0]!.colorKey).toBe("dim");
  });
  it("已刪除的未解決紀錄不影響顏色", () => {
    expect(computeBlips([rec({ severity: "重大", deleted: true }), rec({ severity: "輕微" })], NOW)[0]!.colorKey).toBe("good");
  });
  it("沒資料＝沒有光點；token 對照", () => {
    expect(computeBlips(undefined, NOW)).toEqual([]);
    expect(computeBlips([], NOW)).toEqual([]);
    expect(BLIP_TOKEN).toEqual({ good: "--good", warning: "--warning", serious: "--serious", critical: "--critical", dim: "--line" });
  });
});

describe("blipPosition：穩定雜湊", () => {
  const names = ["F3", "F1", "F2", "RB2", "CCD異常", "A", "B", "機台一號", "X-100", "Line 7"];
  it("同名稱每次相同", () => {
    for (const n of names) expect(blipPosition(n)).toEqual(blipPosition(n));
    expect(hashName("F3")).toBe(hashName("F3"));
  });
  it("半徑在 0.35..0.9、角度在 0..2π", () => {
    for (let i = 0; i < 500; i++) {
      const p = blipPosition(`機台-${i}`);
      expect(p.radius).toBeGreaterThanOrEqual(RADAR_RADIUS_MIN);
      expect(p.radius).toBeLessThanOrEqual(RADAR_RADIUS_MAX);
      expect(p.angle).toBeGreaterThanOrEqual(0);
      expect(p.angle).toBeLessThan(Math.PI * 2);
    }
  });
  it("相近名稱分散（F1／F2／F3 不重疊）", () => {
    const ps = ["F1", "F2", "F3"].map(blipPosition);
    expect(new Set(ps.map((p) => p.angle.toFixed(3))).size).toBe(3);
  });
});

describe("新異常偵測", () => {
  const r = (id: number, over: Partial<DiaryRecord> = {}) => rec({ id, ...over });

  it("第一次載入不算：只設基準", () => {
    const t = observeAnomalies(newAnomalyTracker(), [r(1), r(2), r(3)], true);
    expect(t.fresh).toEqual([]);
    expect(t.tracker.baseline).toBe(3);
  });
  it("還在抓（settled=false）或沒資料：不動、不設基準", () => {
    const t0 = newAnomalyTracker();
    expect(observeAnomalies(t0, undefined, true)).toEqual({ tracker: t0, fresh: [] });
    expect(observeAnomalies(t0, [r(1)], false)).toEqual({ tracker: t0, fresh: [] });
  });
  it("進入時的舊快取被新抓的資料取代：基準取抓完的那份（不把進入前就存在的紀錄當新異常）", () => {
    let t = newAnomalyTracker();
    t = observeAnomalies(t, [r(1), r(2)], false).tracker; // 舊快取、還在抓
    const done = observeAnomalies(t, [r(1), r(2), r(3)], true); // 抓完
    expect(done.fresh).toEqual([]);
    expect(done.tracker.baseline).toBe(3);
  });
  it("基準之後出現的（id 大於基準）未刪除紀錄＝新異常；只報一次", () => {
    let t = observeAnomalies(newAnomalyTracker(), [r(1), r(2)], true).tracker;
    const a = observeAnomalies(t, [r(1), r(2), r(3, { equipment: "F3", severity: "嚴重" })], true);
    expect(a.fresh.map((x) => x.id)).toEqual([3]);
    t = a.tracker;
    const b = observeAnomalies(t, [r(1), r(2), r(3)], true);
    expect(b.fresh).toEqual([]);
  });
  it("新出現但已刪除的不算；id 沒超過基準的不算（編輯舊紀錄）", () => {
    const t = observeAnomalies(newAnomalyTracker(), [r(5)], true).tracker;
    expect(observeAnomalies(t, [r(5), r(6, { deleted: true })], true).fresh).toEqual([]);
    expect(observeAnomalies(t, [r(5, { severity: "重大" })], true).fresh).toEqual([]);
  });
  it("空資料庫開始：基準 0，第一筆新紀錄算新異常", () => {
    const t = observeAnomalies(newAnomalyTracker(), [], true).tracker;
    expect(t.baseline).toBe(0);
    expect(observeAnomalies(t, [r(1)], true).fresh.map((x) => x.id)).toEqual([1]);
  });
  it("離開再進入 HUB＝新的 tracker：進入前新增的紀錄變成基準，不算新異常", () => {
    const first = observeAnomalies(newAnomalyTracker(), [r(1)], true).tracker;
    expect(first.baseline).toBe(1);
    const again = observeAnomalies(newAnomalyTracker(), [r(1), r(2)], true);
    expect(again.fresh).toEqual([]);
  });
});

describe("公告字串與脈衝", () => {
  it("一筆：新紀錄：F3（嚴重）", () => {
    expect(anomalyAnnouncement([rec({ equipment: "F3", severity: "嚴重" })])).toBe("新紀錄：F3（嚴重）");
  });
  it("多筆：取最嚴重的一筆加總數", () => {
    expect(anomalyAnnouncement([rec({ equipment: "A", severity: "輕微" }), rec({ equipment: "F3", severity: "重大" }), rec({ equipment: "B", severity: "一般" })])).toBe(
      "新紀錄 3 筆：F3（重大）等",
    );
  });
  it("沒有新異常＝null", () => expect(anomalyAnnouncement([])).toBeNull());
  it("pulseMachines：去重、只含有光點的機台", () => {
    const blips = computeBlips([rec({ equipment: "F3" })], new Date(2026, 10, 1));
    expect(pulseMachines([rec({ equipment: "F3" }), rec({ equipment: "F3" }), rec({ equipment: "ZZ", date: "2020-01-01" })], blips)).toEqual(["F3"]);
  });
});
