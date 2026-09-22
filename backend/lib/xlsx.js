// 讀「舊版」8 欄工作日誌（給一次性搬遷用），以及把現在的 data.json 匯出成
// 同樣 8 欄格式的 Excel 快照（給「匯出為 Excel」按鈕用）。
// 兩個方向刻意分開：匯出永遠只吐使用者熟悉的原始欄位，
// 完整欄位（分類/嚴重度/根本原因/狀態…）只活在 data.json 裡，見 schema.md。

import ExcelJS from "exceljs";

const LEGACY_HEADERS = ["日期", "班別", "時間", "耗時", "設備", "問題", "處理", "照片"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

// exceljs 把 Excel 的日期/時間格子讀成「UTC 錨定」的 Date 物件——
// 也就是 Excel 儲存格顯示的 10:40，物件的 UTC 時分是 10:40，而不是這台電腦時區的 10:40。
// 這台機器在 UTC+8，如果誤用本地 getHours()，讀出來的時間會整整多 8 小時
// （已經在搬遷真實資料時實測踩到過這個坑，所以在這裡留下這段說明，不要改回本地 getter）。
export function toDateStr(value) {
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  }
  const s = String(value ?? "").trim();
  const m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`;
  return s;
}

export function toTimeStr(value) {
  if (value instanceof Date) {
    return `${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}`;
  }
  const s = String(value ?? "").trim();
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return `${pad2(Number(m[1]))}:${m[2]}`;
  return s;
}

/**
 * 讀取舊版 8 欄 Excel，回傳原始列資料（不做任何分類/嚴重度推論 — 那是
 * scripts/migrate.js 的責任，這裡只負責「把 Excel 格子變成乾淨的字串/數字」）。
 */
export async function readLegacyXlsx(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const [, date, shift, time, duration, equipment, problem, action, photoPath] = row.values;
    if (!date && !problem) return; // 跳過完全空白的列
    rows.push({
      date: toDateStr(date),
      shift: String(shift ?? "").trim(),
      time: toTimeStr(time),
      duration: Number(duration) || 0,
      equipment: String(equipment ?? "").trim(),
      problem: String(problem ?? "").trim(),
      action: String(action ?? "").trim(),
      photoPath: photoPath ? String(photoPath).trim() : null,
    });
  });
  return rows;
}

/**
 * 把目前的紀錄陣列匯出成使用者熟悉的 8 欄格式快照。
 * 照片欄只填檔名清單（用頓號分隔），不還原成絕對路徑——絕對路徑是這台電腦専用的，
 * 換一台電腦或分享出去就會失效，寫死它反而是個坑。
 */
export async function writeSnapshotXlsx(records, outFilePath) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("工作日誌表");
  ws.addRow(LEGACY_HEADERS);
  ws.getRow(1).font = { bold: true };
  ws.columns = [
    { width: 12 },
    { width: 6 },
    { width: 8 },
    { width: 6 },
    { width: 10 },
    { width: 22 },
    { width: 30 },
    { width: 30 },
  ];

  const sorted = [...records]
    .filter((r) => !r.deleted)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  for (const r of sorted) {
    ws.addRow([
      r.date,
      r.shift,
      r.time,
      r.duration,
      r.equipment,
      r.problem,
      r.action || "",
      (r.photos || []).join("、"),
    ]);
  }

  await wb.xlsx.writeFile(outFilePath);
}
