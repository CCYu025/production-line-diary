import { test } from "node:test";
import assert from "node:assert/strict";
import { categorize, buildRecords } from "../backend/lib/migrateLogic.js";

test("categorize 認得目前實際出現過的問題文字", () => {
  assert.equal(categorize("膠料堆疊取料失敗"), "取料異常");
  assert.equal(categorize("膠料歪斜"), "取料異常");
  assert.equal(categorize("缺料"), "缺料");
  assert.equal(categorize("厚度下限"), "尺寸異常");
  assert.equal(categorize("厚度上限"), "尺寸異常");
  assert.equal(categorize("半製品附於上模"), "沾模");
  assert.equal(categorize("撕破"), "材料損傷");
  assert.equal(categorize("膠片破損"), "材料損傷");
  assert.equal(categorize("CCD異常"), "設備異常");
  assert.equal(categorize("夾具右端機率空抓"), "設備異常");
});

test("categorize 對認不出來的問題文字歸類為「其他」，不會丟例外", () => {
  assert.equal(categorize("從沒見過的全新故障描述"), "其他");
});

function legacyRow(overrides) {
  return {
    date: "2026-09-21",
    shift: "早",
    time: "10:00",
    duration: 10,
    equipment: "F7",
    problem: "半製品附於上模",
    action: "洗模",
    photoPath: null,
    ...overrides,
  };
}

test("buildRecords：同一天同問題 >=3 次標記追蹤中，否則已解決", () => {
  const rows = [
    legacyRow({ time: "10:00" }),
    legacyRow({ time: "11:00" }),
    legacyRow({ time: "12:00" }),
    legacyRow({ time: "13:00", problem: "缺料", equipment: "F3" }), // 只出現一次
  ];
  const records = buildRecords(rows);
  const recurring = records.filter((r) => r.problem === "半製品附於上模");
  const single = records.find((r) => r.problem === "缺料");

  assert.equal(recurring.length, 3);
  assert.ok(recurring.every((r) => r.status === "追蹤中"));
  assert.equal(single.status, "已解決");
});

test("buildRecords：id 從 1 重新連續編號，跟原始 Excel 列順序無關", () => {
  const rows = [legacyRow(), legacyRow(), legacyRow()];
  const records = buildRecords(rows);
  assert.deepEqual(records.map((r) => r.id), [1, 2, 3]);
});

test("buildRecords：rootCause 一律是 null，不會替使用者瞎猜根本原因", () => {
  const records = buildRecords([legacyRow()]);
  assert.equal(records[0].rootCause, null);
});

test("buildRecords：photoPath 只取檔名，不保留這台電腦專屬的絕對路徑", () => {
  const records = buildRecords([
    legacyRow({ photoPath: "C:\\Users\\tomof\\OneDrive\\桌面\\20260918_工作日誌\\照片\\20260921\\S__1.jpg" }),
  ]);
  assert.deepEqual(records[0].photos, ["S__1.jpg"]);
});

test("buildRecords：沒有照片欄位時 photos 是空陣列", () => {
  const records = buildRecords([legacyRow({ photoPath: null })]);
  assert.deepEqual(records[0].photos, []);
});
