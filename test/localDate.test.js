// 報表預設日期曾經用 new Date().toISOString().slice(0,10)（UTC），台灣 00:00–08:00 會變成「昨天」。
// 在 UTC 時區的 CI 上測不出來，所以這裡故意把 TZ 設成 UTC+8。
process.env.TZ = "Asia/Taipei";

import { test } from "node:test";
import assert from "node:assert/strict";
import { toISODate } from "../backend/lib/aggregate.js";

test("toISODate 取本地日期：台灣清晨 00:30 仍是當天，不是 UTC 的前一天", () => {
  const d = new Date(2026, 9, 26, 0, 30); // 2026-10-26 00:30 本地
  assert.equal(d.toISOString().slice(0, 10), "2026-10-25"); // 舊寫法的錯誤結果
  assert.equal(toISODate(d), "2026-10-26");
});

test("toISODate 補零、跨月跨年", () => {
  assert.equal(toISODate(new Date(2027, 0, 1, 7, 59)), "2027-01-01");
  assert.equal(toISODate(new Date(2026, 2, 5, 23, 59)), "2026-03-05");
});
