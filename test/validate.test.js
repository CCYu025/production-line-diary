import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseDuration,
  parseId,
  normalizeRecordFields,
  isRealDate,
  isValidTime,
  isSafeFilename,
  pickRecordFields,
  validateRecord,
  RECORD_FIELDS,
} from "../backend/lib/validate.js";

test("isRealDate：格式正確且真實存在", () => {
  for (const ok of ["2026-09-22", "2028-02-29", "2026-12-31", "2000-02-29"]) assert.equal(isRealDate(ok), true, ok);
  for (const bad of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-00-01", "2026-04-31", "1900-02-29", "2026-9-22", "", null, undefined, 20260922]) {
    assert.equal(isRealDate(bad), false, String(bad));
  }
});

test("isValidTime：00:00–23:59", () => {
  for (const ok of ["00:00", "09:05", "23:59"]) assert.equal(isValidTime(ok), true, ok);
  for (const bad of ["24:00", "23:60", "9:00", "09:5", "ab:cd", "", null, 900]) assert.equal(isValidTime(bad), false, String(bad));
});

test("isSafeFilename：單純檔名通過；路徑、.. 、控制字元、非字串都不行", () => {
  for (const ok of ["a.jpg", "S__33923103.jpg", "照片-1.jpg", "with space (1).jpg", "a.b.c.png"]) {
    assert.equal(isSafeFilename(ok), true, ok);
  }
  for (const bad of ["", ".", "..", "../a.jpg", "a/b.jpg", "a\\b.jpg", "a..b.jpg", "x\u0000.jpg", "x\n.jpg", "x\u007f.jpg", "c:a.jpg", "a".repeat(256), 5, null, undefined, {}, []]) {
    assert.equal(isSafeFilename(bad), false, JSON.stringify(bad));
  }
});

test("pickRecordFields：只取白名單裡 body 自己有的欄位", () => {
  const picked = pickRecordFields({
    id: 1, deleted: true, deletedAt: "x", updatedAt: "y", evil: 1, status: "追蹤中", rootCause: null, photos: [],
  });
  assert.deepEqual(picked, { status: "追蹤中", rootCause: null, photos: [] });
  assert.deepEqual(pickRecordFields(undefined), {});
  assert.deepEqual(pickRecordFields([1, 2]), {});
  assert.deepEqual(pickRecordFields("str"), {});
  assert.ok(!RECORD_FIELDS.some((k) => ["id", "deleted", "deletedAt", "updatedAt"].includes(k)));
});

const base = { date: "2026-09-22", time: "09:00", duration: 10, equipment: "F3", problem: "x", shift: "早", severity: "輕微", status: "待處理" };

test("validateRecord：合法資料沒有錯誤；必填缺漏會報錯", () => {
  assert.deepEqual(validateRecord(base, Object.keys(base)), []);
  const full = { full: true };
  assert.ok(validateRecord({ ...base, equipment: "  " }, [], full).length > 0);
  assert.ok(validateRecord({ ...base, problem: "" }, [], full).length > 0);
  assert.ok(validateRecord({ ...base, duration: 0 }, [], full).length > 0);
  assert.ok(validateRecord({ ...base, duration: "abc" }, [], full).length > 0);
  assert.ok(validateRecord({}, [], full).length >= 5, "POST 全部必填欄位都缺");
});

test("validateRecord：enum 與型別只檢查 body 實際帶來的欄位（舊資料的怪值不擋 PUT）", () => {
  const legacy = { ...base, shift: "夜", severity: "舊值" };
  assert.deepEqual(validateRecord(legacy, ["status"]), [], "沒碰 shift/severity 就不檢查");
  assert.ok(validateRecord(legacy, ["shift"]).length > 0);
  assert.ok(validateRecord(legacy, ["severity"]).length > 0);
  assert.ok(validateRecord({ ...base, status: "x" }, ["status"]).length > 0);
  assert.ok(validateRecord({ ...base, equipment: 5 }, ["equipment"]).length > 0);
  assert.ok(validateRecord({ ...base, photos: ["../x"] }, ["photos"]).length > 0);
  assert.ok(validateRecord({ ...base, photos: "a.jpg" }, ["photos"]).length > 0);
  assert.ok(validateRecord({ ...base, photoCaptions: [] }, ["photoCaptions"]).length > 0);
});

test("M1 validateRecord（非 full）：只檢查有帶的欄位，舊資料的怪值不影響", () => {
  const legacy = { ...base, duration: 0, time: "9:30", equipment: "" };
  assert.deepEqual(validateRecord({ status: "已解決" }, ["status"]), []);
  assert.deepEqual(validateRecord({ rootCause: "x" }, ["rootCause"]), []);
  assert.deepEqual(validateRecord({}, []), [], "什麼都沒帶也不報必填缺漏");
  assert.ok(validateRecord({ duration: 0 }, ["duration"]).length > 0);
  assert.ok(validateRecord({ time: "9:30" }, ["time"]).length > 0);
  assert.ok(validateRecord({ equipment: "" }, ["equipment"]).length > 0);
  assert.ok(validateRecord({ problem: "  " }, ["problem"]).length > 0);
  assert.ok(validateRecord(legacy, Object.keys(legacy)).length >= 3, "整筆編輯送出全部欄位時，壞的欄位仍會被要求修正");
});

test("L2 parseDuration：只接受正整數（number 或純數字字串）", () => {
  for (const [input, expected] of [[10, 10], ["25", 25], [1, 1]]) assert.equal(parseDuration(input), expected);
  for (const bad of [0, -5, 1.5, "1.5", "", " 5", "5 ", "0", "1e1", "0x10", [5], ["5"], true, false, null, undefined, NaN, Infinity, {}, 2 ** 60]) {
    assert.equal(parseDuration(bad), null, JSON.stringify(bad));
  }
});

test("L1 parseId：只接受十進位正整數字串", () => {
  assert.equal(parseId("1"), 1);
  assert.equal(parseId("42"), 42);
  for (const bad of ["0x1", "1e0", " 1", "1 ", "01", "0", "-1", "1.0", "", "abc", "9".repeat(30), null, undefined, 1]) {
    assert.equal(parseId(bad), null, JSON.stringify(bad));
  }
});

test("L2 isRealDate：1900 年以前一律拒絕", () => {
  assert.equal(isRealDate("0000-01-01"), false);
  assert.equal(isRealDate("1899-12-31"), false);
  assert.equal(isRealDate("1900-01-01"), true);
});

test("L2 pickRecordFields：photos 重複的檔名只留第一個（保持順序）", () => {
  assert.deepEqual(pickRecordFields({ photos: ["a.jpg", "b.jpg", "a.jpg"] }).photos, ["a.jpg", "b.jpg"]);
  assert.equal(pickRecordFields({ photos: "a.jpg" }).photos, "a.jpg", "不是陣列就原樣交給驗證去擋");
});

test("normalizeRecordFields：只處理有帶的 key，空的選填欄位存 null", () => {
  assert.deepEqual(normalizeRecordFields({ status: "追蹤中" }), { status: "追蹤中" });
  assert.deepEqual(
    normalizeRecordFields({ duration: "12", equipment: " F3 ", rootCause: "  ", productCode: "", category: "", action: null }),
    { duration: 12, equipment: "F3", rootCause: null, productCode: null, category: "其他", action: "" },
  );
});
