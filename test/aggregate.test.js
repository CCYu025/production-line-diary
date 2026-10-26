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
  emptyFilter,
  hasActiveFilter,
  filterRecords,
  facetCounts,
  sortByDate,
  datePresets,
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

/* ---------------- 紀錄列表篩選 ---------------- */
const FR = (id, o) => ({
  id, date: "2026-10-05", time: "09:00", equipment: "F3", category: "檢測NG", problem: "收料異常",
  severity: "輕微", status: "已解決", action: "", rootCause: null, deleted: false, ...o,
});
const FDATA = [
  FR(1, { date: "2026-10-01", equipment: "F3", category: "檢測NG", problem: "收料撕破", severity: "輕微", status: "已解決" }),
  FR(2, { date: "2026-10-02", equipment: "F4", category: "檢測NG", problem: "收料撕破", severity: "一般", status: "待處理" }),
  FR(3, { date: "2026-10-05", equipment: "F4", category: "夾取異常", problem: "取料失敗", severity: "嚴重", status: "追蹤中", action: "更換吸盤" }),
  FR(4, { date: "2026-10-07", equipment: "原材區1", category: "夾取異常", problem: "取料失敗", severity: "重大", status: "已解決", rootCause: "吸盤老化" }),
  FR(5, { date: "2026-10-07", equipment: "F3", category: "檢測NG", problem: "收料撕破", severity: "輕微", status: "已解決", deleted: true }),
];
const ids = (rows) => rows.map((r) => r.id);

test("emptyFilter 不篩任何東西，且軟刪除的紀錄一律排除", () => {
  const f = emptyFilter();
  assert.equal(hasActiveFilter(f), false);
  assert.deepEqual(ids(filterRecords(FDATA, f)), [1, 2, 3, 4]);
});

test("設備、分類是多選（OR），不同維度之間是 AND", () => {
  const f = { ...emptyFilter(), equipment: ["F3", "F4"] };
  assert.deepEqual(ids(filterRecords(FDATA, f)), [1, 2, 3]);
  f.category = ["檢測NG"];
  assert.deepEqual(ids(filterRecords(FDATA, f)), [1, 2]);
  assert.equal(hasActiveFilter(f), true);
});

test("嚴重度、狀態、問題是單選", () => {
  assert.deepEqual(ids(filterRecords(FDATA, { ...emptyFilter(), severity: "重大" })), [4]);
  assert.deepEqual(ids(filterRecords(FDATA, { ...emptyFilter(), status: "待處理" })), [2]);
  assert.deepEqual(ids(filterRecords(FDATA, { ...emptyFilter(), problem: "取料失敗" })), [3, 4]);
});

test("日期區間含頭尾；單日是 from === to；單邊不設限", () => {
  assert.deepEqual(ids(filterRecords(FDATA, { ...emptyFilter(), from: "2026-10-02", to: "2026-10-05" })), [2, 3]);
  assert.deepEqual(ids(filterRecords(FDATA, { ...emptyFilter(), from: "2026-10-07", to: "2026-10-07" })), [4]);
  assert.deepEqual(ids(filterRecords(FDATA, { ...emptyFilter(), from: "2026-10-05" })), [3, 4]);
  assert.deepEqual(ids(filterRecords(FDATA, { ...emptyFilter(), to: "2026-10-01" })), [1]);
});

test("關鍵字不分大小寫，會搜到處理內容與根本原因", () => {
  assert.deepEqual(ids(filterRecords(FDATA, { ...emptyFilter(), query: "吸盤" })), [3, 4]);
  assert.deepEqual(ids(filterRecords(FDATA, { ...emptyFilter(), query: "f4" })), [2, 3]);
  assert.deepEqual(ids(filterRecords(FDATA, { ...emptyFilter(), query: "老化" })), [4]);
});

test("facetCounts 套用其他條件、但不套用自己這一維", () => {
  const f = { ...emptyFilter(), equipment: ["F3"], category: ["夾取異常"] };
  // 設備這一維忽略「設備」條件，只受分類=夾取異常 限制
  assert.deepEqual(facetCounts(FDATA, f, "equipment"), { F4: 1, 原材區1: 1 });
  // 分類這一維忽略「分類」條件，只受設備=F3 限制（軟刪除的 #5 不算）
  assert.deepEqual(facetCounts(FDATA, f, "category"), { 檢測NG: 1 });
  // 狀態這一維兩個條件都套用，沒有符合的
  assert.deepEqual(facetCounts(FDATA, f, "status"), {});
});

test("facetCounts：日期條件對所有維度都有效", () => {
  const f = { ...emptyFilter(), from: "2026-10-05", to: "2026-10-07" };
  assert.deepEqual(facetCounts(FDATA, f, "equipment"), { F4: 1, 原材區1: 1 });
});

test("sortByDate 預設新到舊，同時間用 id 決勝，且不改動原陣列", () => {
  const rows = FDATA.filter((r) => !r.deleted);
  const before = ids(rows);
  assert.deepEqual(ids(sortByDate(rows)), [4, 3, 2, 1]);
  assert.deepEqual(ids(sortByDate(rows, false)), [1, 2, 3, 4]);
  assert.deepEqual(ids(rows), before);
  const same = [FR(9, {}), FR(8, {})];
  assert.deepEqual(ids(sortByDate(same, false)), [8, 9]);
  assert.deepEqual(ids(sortByDate(same, true)), [9, 8]);
});

test("datePresets：本週從週一算起、本月從 1 號算起", () => {
  const p = Object.fromEntries(datePresets(new Date(2026, 9, 8)).map((x) => [x.id, x])); // 2026-10-08 週四
  assert.deepEqual([p.today.from, p.today.to], ["2026-10-08", "2026-10-08"]);
  assert.deepEqual([p.week.from, p.week.to], ["2026-10-05", "2026-10-08"]);
  assert.deepEqual([p.d7.from, p.d7.to], ["2026-10-02", "2026-10-08"]);
  assert.deepEqual([p.month.from, p.month.to], ["2026-10-01", "2026-10-08"]);
  assert.deepEqual([p.d30.from, p.d30.to], ["2026-09-09", "2026-10-08"]);
  assert.deepEqual([p.all.from, p.all.to], ["", ""]);
});

test("datePresets：週日算在上一週，跨月、跨年也正確", () => {
  const sun = Object.fromEntries(datePresets(new Date(2026, 9, 11)).map((x) => [x.id, x])); // 週日
  assert.equal(sun.week.from, "2026-10-05");
  const jan = Object.fromEntries(datePresets(new Date(2027, 0, 3)).map((x) => [x.id, x])); // 週日
  assert.equal(jan.week.from, "2026-12-28");
  assert.equal(jan.d7.from, "2026-12-28");
  assert.equal(jan.month.from, "2027-01-01");
});
