import { test } from "node:test";
import assert from "node:assert/strict";
import {
  severityFromDuration,
  withinRange,
  aggregate,
  knownEquipment,
  knownCategories,
  knownProductCodes,
  knownMaterialCategories,
  COPY_FIELDS,
  pickCopyFields,
  commonProblems,
} from "../backend/lib/aggregate.js";

test("severityFromDuration 依耗時分級", () => {
  assert.equal(severityFromDuration(5), "輕微");
  assert.equal(severityFromDuration(10), "輕微");
  assert.equal(severityFromDuration(11), "一般");
  assert.equal(severityFromDuration(15), "一般");
  assert.equal(severityFromDuration(16), "嚴重");
  assert.equal(severityFromDuration(20), "嚴重");
  assert.equal(severityFromDuration(21), "重大");
});

test("withinRange('all') 永遠回傳 true", () => {
  assert.equal(withinRange("2020-01-01", "all"), true);
  assert.equal(withinRange("2020-01-01", undefined), true);
});

test("withinRange('month') 只認同年同月", () => {
  const now = new Date(2026, 8, 22); // 2026-09-22
  assert.equal(withinRange("2026-09-01", "month", now), true);
  assert.equal(withinRange("2026-09-30", "month", now), true);
  assert.equal(withinRange("2026-08-31", "month", now), false);
  assert.equal(withinRange("2025-09-15", "month", now), false);
});

test("withinRange('week') 只認本週一到現在", () => {
  const now = new Date(2026, 8, 24); // 2026-09-24 是星期四
  assert.equal(withinRange("2026-09-21", "week", now), true); // 週一
  assert.equal(withinRange("2026-09-24", "week", now), true); // 今天
  assert.equal(withinRange("2026-09-20", "week", now), false); // 上週日
  assert.equal(withinRange("2026-09-25", "week", now), false); // 還沒到
});

function rec(overrides) {
  return {
    id: 1,
    date: "2026-09-21",
    shift: "早",
    time: "10:00",
    duration: 10,
    equipment: "F7",
    category: "沾模",
    problem: "半製品附於上模",
    severity: "輕微",
    action: "烘模",
    rootCause: null,
    status: "追蹤中",
    photos: [],
    updatedAt: null,
    deleted: false,
    deletedAt: null,
    ...overrides,
  };
}

test("aggregate 排除已刪除的紀錄", () => {
  const records = [rec({ id: 1 }), rec({ id: 2, deleted: true })];
  const agg = aggregate(records, "all");
  assert.equal(agg.totalEvents, 1);
});

test("aggregate 統計數字與排行正確", () => {
  const records = [
    rec({ id: 1, equipment: "F7", duration: 10, category: "沾模", severity: "輕微", status: "追蹤中" }),
    rec({ id: 2, equipment: "F7", duration: 20, category: "沾模", severity: "嚴重", status: "追蹤中" }),
    rec({ id: 3, equipment: "F4", duration: 20, category: "尺寸異常", severity: "嚴重", status: "已解決", rootCause: "已排除" }),
  ];
  const agg = aggregate(records, "all");

  assert.equal(agg.totalEvents, 3);
  assert.equal(agg.totalMinutes, 50);
  assert.equal(agg.avg, 50 / 3);

  assert.deepEqual(
    agg.equipmentRanked.map((r) => r.label),
    ["F7", "F4"] // F7 累計 30 分鐘排第一
  );
  assert.equal(agg.trackingRows.length, 2);
  assert.equal(agg.rootCauseMissing, 2); // 追蹤中且沒填根本原因的兩筆
});

test("aggregate 的 withPhoto 只算真的有照片檔名的紀錄", () => {
  const records = [rec({ id: 1, photos: ["a.jpg"] }), rec({ id: 2, photos: [] })];
  const agg = aggregate(records, "all");
  assert.equal(agg.withPhoto, 1);
});

test("knownEquipment / knownCategories 回傳去重後排序的清單", () => {
  const records = [
    rec({ equipment: "F7", category: "沾模" }),
    rec({ equipment: "F4", category: "沾模" }),
    rec({ equipment: "F7", category: "尺寸異常" }),
  ];
  assert.deepEqual(knownEquipment(records), ["F4", "F7"]);
  assert.deepEqual(knownCategories(records), ["尺寸異常", "沾模"]);
});

test("knownProductCodes / knownMaterialCategories 忽略 null，回傳去重排序的清單", () => {
  const records = [
    rec({ productCode: "PC-002", materialCategory: null }),
    rec({ productCode: "PC-001", materialCategory: "膠料A" }),
    rec({ productCode: null, materialCategory: null }),
  ];
  assert.deepEqual(knownProductCodes(records), ["PC-001", "PC-002"]);
  assert.deepEqual(knownMaterialCategories(records), ["膠料A"]);
});

test("pickCopyFields 只帶同類事件會一樣的欄位，不帶日期/時間/設備/狀態/照片/品號", () => {
  const src = {
    id: 9, date: "2026-10-02", shift: "早", time: "14:20", duration: 15, equipment: "F7",
    category: "檢測NG", problem: "半製品收料撕破", severity: "一般", action: "烘模", rootCause: "脫模不良",
    status: "已解決", photos: ["a.jpg"], productCode: "ZA063S17A-5", materialCategory: "TV-501",
  };
  assert.deepEqual(pickCopyFields(src), {
    category: "檢測NG", severity: "一般", duration: 15, problem: "半製品收料撕破", action: "烘模", rootCause: "脫模不良",
  });
  assert.deepEqual(Object.keys(pickCopyFields(src)), COPY_FIELDS);
});

test("pickCopyFields 遇到歷史資料的 null/缺值欄位一律給 null，不用猜", () => {
  const out = pickCopyFields({ category: "其他", problem: "x", severity: "輕微", duration: 5, action: "" });
  assert.equal(out.rootCause, null);
  assert.equal(out.action, "");
});

test("commonProblems 依分類＋問題歸併，次數多的在前，取最近一筆當範本，不算軟刪除", () => {
  const rec = (id, date, time, equipment, category, problem, extra = {}) =>
    ({ id, date, time, equipment, category, problem, ...extra });
  const list = [
    rec(1, "2026-09-29", "13:15", "F8", "檢測NG", "撕破"),
    rec(2, "2026-09-30", "09:50", "F4", "檢測NG", "撕破"),
    rec(3, "2026-10-02", "14:20", "F7", "檢測NG", "撕破"),
    rec(4, "2026-10-02", "10:05", "F4", "沾模", "附於上模"),
    rec(5, "2026-10-03", "08:00", "F3", "沾模", "附於上模", { deleted: true }),
    rec(6, "2026-10-01", "11:30", "F3", "模髒", "髒污"),
    rec(7, "2026-10-01", "12:30", "F4", "模髒", "撕破"), // 同問題字樣、不同分類 → 不歸併
  ];
  const out = commonProblems(list);
  assert.equal(out[0].problem, "撕破");
  assert.equal(out[0].category, "檢測NG");
  assert.equal(out[0].count, 3);
  assert.equal(out[0].record.id, 3); // 最近一筆
  const mud = out.find((g) => g.problem === "附於上模");
  assert.equal(mud.count, 1); // 軟刪除那筆不算
  assert.equal(mud.record.id, 4);
  // 次數相同（1 次）時，最近發生的排前面：沾模 10-02 10:05 → 模髒/撕破 10-01 12:30 → 模髒/髒污 10-01 11:30
  assert.deepEqual(out.slice(1).map((g) => g.record.id), [4, 7, 6]);
});
