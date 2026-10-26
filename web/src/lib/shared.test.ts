import { describe, expect, it } from "vitest";
import * as shared from "@shared/aggregate";
import { SEVERITY_ORDER, STATUS_ORDER } from "@shared/aggregate";

// 防止 backend/lib/aggregate.d.ts 與 aggregate.js 悄悄對不上：
// 這個物件的 key 必須涵蓋 .d.ts 宣告的每個匯出（少寫一個 TypeScript 會報錯），
// 而且要和 aggregate.js 實際匯出的名稱完全一致。
const declared: Record<keyof typeof shared, true> = {
  SEVERITY_ORDER: true,
  STATUS_ORDER: true,
  knownEquipment: true,
  knownCategories: true,
  knownProductCodes: true,
  knownMaterialCategories: true,
  severityFromDuration: true,
  withinRange: true,
  aggregate: true,
  COPY_FIELDS: true,
  pickCopyFields: true,
  commonProblems: true,
  emptyFilter: true,
  hasActiveFilter: true,
  filterRecords: true,
  facetCounts: true,
  sortByDate: true,
  datePresets: true,
};

describe("@shared/aggregate（前後端共用邏輯）", () => {
  it("型別宣告的匯出 = aggregate.js 實際匯出", () => {
    expect(Object.keys(shared).sort()).toEqual(Object.keys(declared).sort());
  });

  it("可以在瀏覽器端直接使用", () => {
    expect(shared.severityFromDuration(12)).toBe("一般");
    expect(shared.aggregate([], "all").totalEvents).toBe(0);
    expect(SEVERITY_ORDER).toEqual(["輕微", "一般", "嚴重", "重大"]);
    expect(STATUS_ORDER).toEqual(["待處理", "追蹤中", "已解決"]);
  });
});
