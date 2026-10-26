import { describe, expect, it } from "vitest";
import { formReducer, initialEditState, initialNewState, isFormDirty } from "./formReducer";
import {
  applyCopyToValues,
  buildRecordInput,
  categorySuggestions,
  equipmentSuggestions,
  formatDateSummary,
  initialNewValues,
  mapServerErrors,
  nowDateTime,
  parseDurationInput,
  reviewFieldsAfterCopy,
  suggestSeverity,
  validateValues,
} from "./model";
import { makeRecord, META } from "./testUtils";

const NOW = new Date(2026, 9, 26, 14, 5); // 本地時間 2026/10/26 14:05

describe("耗時：只接受正整數", () => {
  it.each([
    ["7", 7],
    ["10", 10],
    [" 12 ", 12],
    ["007", 7],
  ])("%j → %j", (input, expected) => {
    expect(parseDurationInput(input)).toBe(expected);
  });

  it.each(["7.5", "0", "-3", "", "abc", "1e2", "1,5"])("%j 不合法", (input) => {
    expect(parseDurationInput(input)).toBeNull();
  });

  it("validateValues 對 7 通過、對 7.5 與 0 回報欄位錯誤", () => {
    const base = { ...initialNewValues(NOW), equipment: "F3", problem: "卡料" };
    expect(validateValues({ ...base, duration: "7" })).toEqual({});
    expect(validateValues({ ...base, duration: "7.5" }).duration).toMatch(/整數/);
    expect(validateValues({ ...base, duration: "0" }).duration).toMatch(/整數/);
    expect(validateValues({ ...base, duration: "" }).duration).toMatch(/請輸入耗時/);
  });

  it("必填欄位：設備、問題；日期／時間要有效", () => {
    const errors = validateValues({ ...initialNewValues(NOW), date: "2026-02-30", time: "" });
    expect(Object.keys(errors).sort()).toEqual(["date", "duration", "equipment", "problem", "time"]);
  });
});

describe("嚴重度建議（severityFromDuration）", () => {
  it.each([
    ["5", "輕微"],
    ["10", "輕微"],
    ["11", "一般"],
    ["15", "一般"],
    ["16", "嚴重"],
    ["20", "嚴重"],
    ["21", "重大"],
  ])("耗時 %s → %s", (d, s) => {
    expect(suggestSeverity(d)).toBe(s);
  });
  it("耗時不合法時不建議（不動目前選擇）", () => {
    expect(suggestSeverity("7.5")).toBeNull();
    expect(suggestSeverity("")).toBeNull();
  });
});

describe("日期時間", () => {
  it("nowDateTime 用本地時間", () => {
    expect(nowDateTime(NOW)).toEqual({ date: "2026-10-26", time: "14:05" });
    // 本地 00:30（台灣時間凌晨）仍是當天，不是 UTC 的前一天
    expect(nowDateTime(new Date(2026, 9, 26, 0, 30))).toEqual({ date: "2026-10-26", time: "00:30" });
  });
  it("摘要格式：2026/10/26 14:05・早班", () => {
    expect(formatDateSummary({ date: "2026-10-26", time: "14:05", shift: "早" })).toBe("2026/10/26 14:05・早班");
  });
});

describe("複製既有紀錄（白名單 pickCopyFields）", () => {
  const source = makeRecord({
    id: 7,
    date: "2026-09-01",
    time: "03:15",
    shift: "晚",
    equipment: "G5",
    status: "已解決",
    photos: ["x.jpg"],
    photoCaptions: { "x.jpg": "說明" },
    productCode: "P-SRC",
    materialCategory: "M-SRC",
  });
  const current = { ...initialNewValues(NOW), equipment: "F4", date: "2026-10-01", time: "01:00", shift: "中" as const };

  it("只複製 category / severity / duration / problem / action / rootCause；狀態重設、設備清空、日期時間回到現在", () => {
    const v = applyCopyToValues(current, source, { lockDateTime: false, now: NOW });
    expect(v).toMatchObject({
      category: "沾模",
      severity: "一般",
      duration: "12",
      problem: "半成品沾黏模具",
      action: "清潔模具後重啟",
      rootCause: "脫模劑濃度不足",
      status: "待處理",
      equipment: "",
      productCode: "",
      materialCategory: "",
      date: "2026-10-26",
      time: "14:05",
      shift: "早",
    });
  });

  it("已上傳照片（lockDateTime）時，日期／時間／班別完全不動", () => {
    const v = applyCopyToValues(current, source, { lockDateTime: true, now: NOW });
    expect([v.date, v.time, v.shift]).toEqual(["2026-10-01", "01:00", "中"]);
    expect(v.problem).toBe("半成品沾黏模具");
  });

  it("日期被鎖住時不對日期標「請確認」（使用者根本改不了）", () => {
    expect(reviewFieldsAfterCopy(false)).toEqual(["date", "shift", "time", "duration", "equipment"]);
    expect(reviewFieldsAfterCopy(true)).toEqual(["shift", "time", "duration", "equipment"]);
  });

  it("沒有根本原因的來源：複製成空字串（不是 null 字樣）", () => {
    const v = applyCopyToValues(current, makeRecord({ id: 8, rootCause: null, action: "" }), { lockDateTime: false, now: NOW });
    expect(v.rootCause).toBe("");
    expect(v.action).toBe("");
  });
});

describe("formReducer", () => {
  it("改耗時會連動建議嚴重度；手動選過嚴重度後就不再覆蓋", () => {
    let s = initialNewState(NOW);
    s = formReducer(s, { type: "set", field: "duration", value: "12" });
    expect(s.values.severity).toBe("一般");
    s = formReducer(s, { type: "set", field: "duration", value: "25" });
    expect(s.values.severity).toBe("重大");
    s = formReducer(s, { type: "set", field: "severity", value: "輕微" });
    s = formReducer(s, { type: "set", field: "duration", value: "30" });
    expect(s.values.severity).toBe("輕微");
    s = formReducer(s, { type: "applySuggestedSeverity" });
    expect(s.values.severity).toBe("重大");
    expect(s.severityTouched).toBe(false);
  });

  it("編輯模式不會因為改耗時而動到嚴重度", () => {
    let s = initialEditState(makeRecord({ id: 1, duration: 5, severity: "嚴重" }));
    s = formReducer(s, { type: "set", field: "duration", value: "60" });
    expect(s.values.severity).toBe("嚴重");
  });

  it("套用複製：展開日期區塊、標 5 個「請確認」、動過就消失、不擋任何東西", () => {
    let s = initialNewState(NOW);
    s = formReducer(s, { type: "applyCopy", record: makeRecord({ id: 2 }), lockDateTime: false, now: NOW });
    expect(s.dateOpen).toBe(true);
    expect(s.review).toEqual(["date", "shift", "time", "duration", "equipment"]);
    expect(s.copy).toMatchObject({ id: 2, equipment: "F3" });
    s = formReducer(s, { type: "set", field: "equipment", value: "F4" });
    s = formReducer(s, { type: "set", field: "duration", value: "9" });
    expect(s.review).toEqual(["date", "shift", "time"]);
  });

  it("複製帶入後的嚴重度跟著耗時連動（severityTouched 重置）", () => {
    let s = initialNewState(NOW);
    s = formReducer(s, { type: "applyCopy", record: makeRecord({ id: 2, severity: "一般", duration: 12 }), lockDateTime: false, now: NOW });
    s = formReducer(s, { type: "set", field: "duration", value: "3" });
    expect(s.values.severity).toBe("輕微");
  });

  it("清除帶入：只清掉帶入的欄位與標記，日期／設備保留", () => {
    let s = initialNewState(NOW);
    s = formReducer(s, { type: "applyCopy", record: makeRecord({ id: 2 }), lockDateTime: false, now: NOW });
    s = formReducer(s, { type: "set", field: "equipment", value: "F4" });
    s = formReducer(s, { type: "undoCopy" });
    expect(s.copy).toBeNull();
    expect(s.review).toEqual([]);
    expect(s.values).toMatchObject({ problem: "", action: "", rootCause: "", category: "", duration: "", severity: "輕微", equipment: "F4" });
  });

  it("清除（reset）：日期與時間回到「現在」，不是空白", () => {
    let s = initialNewState(new Date(2026, 9, 26, 8, 0));
    s = formReducer(s, { type: "set", field: "date", value: "2025-01-01" });
    s = formReducer(s, { type: "set", field: "time", value: "" });
    s = formReducer(s, { type: "reset", now: NOW });
    expect(s.values.date).toBe("2026-10-26");
    expect(s.values.time).toBe("14:05");
    expect(isFormDirty(s)).toBe(false);
  });

  it("dirty：改過欄位或帶入過才算", () => {
    let s = initialNewState(NOW);
    expect(isFormDirty(s)).toBe(false);
    s = formReducer(s, { type: "set", field: "problem", value: "x" });
    expect(isFormDirty(s)).toBe(true);
  });

  it("編輯時改欄位會清掉該欄位的錯誤", () => {
    let s = initialNewState(NOW);
    s = formReducer(s, { type: "setErrors", errors: { problem: "請描述發生的問題", duration: "x" } });
    s = formReducer(s, { type: "set", field: "problem", value: "卡料" });
    expect(s.errors).toEqual({ duration: "x" });
  });
});

describe("buildRecordInput", () => {
  const filled = { ...initialNewValues(NOW), equipment: " F3 ", problem: " 卡料 ", duration: "7", rootCause: "  " };

  it("新增：品號／原料類別是設備對照表的快照；空白根本原因存 null；沒填分類存「其他」", () => {
    const input = buildRecordInput(filled, { mode: "new", equipmentMap: META.equipmentMap, photos: [] });
    expect(input).toMatchObject({
      equipment: "F3",
      problem: "卡料",
      duration: 7,
      rootCause: null,
      category: "其他",
      productCode: "P-300",
      materialCategory: "膠料A",
      status: "待處理",
      photos: [],
      photoCaptions: {},
    });
  });

  it("新增：設備沒有對照時品號／原料類別是 null；即使表單值裡有舊值也忽略", () => {
    const input = buildRecordInput({ ...filled, equipment: "F4", productCode: "手改" }, { mode: "new", equipmentMap: META.equipmentMap, photos: [] });
    expect(input.productCode).toBeNull();
    expect(input.materialCategory).toBeNull();
    const unknown = buildRecordInput({ ...filled, equipment: "新機台" }, { mode: "new", equipmentMap: META.equipmentMap, photos: [] });
    expect(unknown.productCode).toBeNull();
  });

  it("編輯：品號／原料類別用表單輸入的值，清空存 null", () => {
    const edited = buildRecordInput({ ...filled, productCode: " X-1 ", materialCategory: "" }, { mode: "edit", equipmentMap: META.equipmentMap, photos: [] });
    expect(edited.productCode).toBe("X-1");
    expect(edited.materialCategory).toBeNull();
  });

  it("圖片說明：只留有檔名且非空的，最多 100 字", () => {
    const input = buildRecordInput(filled, {
      mode: "new",
      photos: [
        { filename: "a.jpg", caption: "  說明  " },
        { filename: "b.jpg", caption: "   " },
        { filename: "c.jpg", caption: "字".repeat(150) },
      ],
    });
    expect(input.photos).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(input.photoCaptions).toEqual({ "a.jpg": "說明", "c.jpg": "字".repeat(100) });
  });

  it("耗時不合法時直接丟錯（不可能送出 7.5）", () => {
    expect(() => buildRecordInput({ ...filled, duration: "7.5" }, { mode: "new", photos: [] })).toThrow();
  });
});

describe("伺服器 errors[] 對應到欄位", () => {
  it("開頭是欄位名稱的訊息 → 欄位旁；其他 → 整體錯誤", () => {
    const { fields, general } = mapServerErrors([
      "duration 須為正整數（分鐘）",
      "date 須為真實存在的日期（1900 年以後），格式 YYYY-MM-DD",
      "照片與日期不一致：a.jpg",
    ]);
    expect(fields.duration).toBe("耗時 須為正整數（分鐘）");
    expect(fields.date).toMatch(/^日期 須為真實存在的日期/);
    expect(general).toEqual(["照片與日期不一致：a.jpg"]);
  });
  it("photoCaptions / photos 都掛在照片欄位", () => {
    const { fields } = mapServerErrors(["photos 含有不合法的檔名", "photoCaptions 須為物件"]);
    expect(fields.photos).toContain("照片 含有不合法的檔名");
    expect(fields.photos).toContain("圖片說明 須為物件");
  });
});

describe("建議清單 = 預設 ∪ 資料 ∪ 對照表", () => {
  it("設備包含預設值、資料裡的、對照表的，且去重排序", () => {
    const list = equipmentSuggestions(META);
    expect(list).toEqual(expect.arrayContaining(["F3", "F4", "F7", "原材區1", "原材區2", "示範機台A"]));
    expect(new Set(list).size).toBe(list.length);
  });
  it("分類包含預設值與資料裡的新分類", () => {
    const list = categorySuggestions({ ...META, categories: ["CCD異常"] });
    expect(list).toEqual(expect.arrayContaining(["CCD異常", "沾模", "其他"]));
  });
  it("meta 還沒載入時也有預設建議", () => {
    expect(equipmentSuggestions(undefined)).toContain("F3");
  });
});
