// 這支測試曾經因為時區問題整個失真：exceljs 把 Excel 的日期/時間格子讀成
// 「UTC 錨定」的 Date 物件，一開始誤用本地 getHours() 讀出來的時間會多 8 小時
// （在 UTC+8 的機器上實測到、但 GitHub Actions 預設跑在 UTC，本地/UTC getter
// 讀出來的結果會「剛好一樣」而測不出這個 bug）。所以這裡故意把 TZ 設成非 UTC，
// 確保不管在哪台機器、哪個 CI runner 上跑，這個迴歸都測得出來。
process.env.TZ = "Asia/Taipei";

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeSnapshotXlsx, readLegacyXlsx, toDateStr, toTimeStr } from "../backend/lib/xlsx.js";

test("toTimeStr 用 UTC 讀時間格子，不會被執行環境的時區帶偏（曾經在 UTC+8 機器上多算 8 小時）", () => {
  const cellValue = new Date(Date.UTC(2026, 8, 21, 10, 40, 0)); // exceljs 對「10:40」時間格子的典型讀法
  assert.equal(toTimeStr(cellValue), "10:40");
});

test("toDateStr 用 UTC 讀日期格子", () => {
  const cellValue = new Date(Date.UTC(2026, 8, 21, 0, 0, 0));
  assert.equal(toDateStr(cellValue), "2026-09-21");
});

test("writeSnapshotXlsx 寫出的檔案，readLegacyXlsx 讀得回來（往返一致）", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pld-xlsx-test-"));
  try {
    const records = [
      {
        id: 1,
        date: "2026-09-21",
        shift: "早",
        time: "10:40",
        duration: 10,
        equipment: "F7",
        category: "沾模",
        problem: "半製品附於上模",
        action: "烘模",
        photos: ["S__1.jpg", "S__2.jpg"],
        deleted: false,
      },
      {
        id: 2,
        date: "2026-09-21",
        shift: "早",
        time: "11:00",
        duration: 20,
        equipment: "F4",
        category: "尺寸異常",
        problem: "厚度上限",
        action: "",
        photos: [],
        deleted: false,
      },
      {
        id: 3,
        date: "2026-09-20",
        shift: "早",
        time: "09:00",
        duration: 5,
        equipment: "F3",
        category: "缺料",
        problem: "不應出現：已刪除",
        action: "",
        photos: [],
        deleted: true,
      },
    ];

    const outFile = path.join(dir, "工作日誌.xlsx");
    await writeSnapshotXlsx(records, outFile);

    const rows = await readLegacyXlsx(outFile);
    assert.equal(rows.length, 2, "已刪除的紀錄不該出現在匯出快照裡");

    // writeSnapshotXlsx 依 date+time 排序
    assert.equal(rows[0].date, "2026-09-21");
    assert.equal(rows[0].time, "10:40");
    assert.equal(rows[0].duration, 10);
    assert.equal(rows[0].equipment, "F7");
    assert.equal(rows[0].problem, "半製品附於上模");
    assert.equal(rows[0].photoPath, "S__1.jpg、S__2.jpg");

    assert.equal(rows[1].time, "11:00");
    assert.equal(rows[1].photoPath, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
