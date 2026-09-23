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
