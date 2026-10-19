import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizePhotoCaptions, MAX_CAPTION_LENGTH } from "../backend/lib/photoCaptions.js";

test("只保留 photos 還有參照的檔名", () => {
  const out = sanitizePhotoCaptions({ "a.jpg": "裂痕", "gone.jpg": "已移除的照片" }, ["a.jpg"]);
  assert.deepEqual(out, { "a.jpg": "裂痕" });
});

test("文字去頭尾空白並限制長度", () => {
  const out = sanitizePhotoCaptions({ "a.jpg": "  " + "字".repeat(MAX_CAPTION_LENGTH + 30) + "  " }, ["a.jpg"]);
  assert.equal(out["a.jpg"].length, MAX_CAPTION_LENGTH);
});

test("空白說明不留 key；非字串的值被丟掉", () => {
  assert.deepEqual(sanitizePhotoCaptions({ "a.jpg": "   ", "b.jpg": 123, "c.jpg": null }, ["a.jpg", "b.jpg", "c.jpg"]), {});
});

test("非物件輸入回傳 {}", () => {
  assert.deepEqual(sanitizePhotoCaptions(undefined, ["a.jpg"]), {});
  assert.deepEqual(sanitizePhotoCaptions(["a"], ["a.jpg"]), {});
  assert.deepEqual(sanitizePhotoCaptions("oops", ["a.jpg"]), {});
});
