// 圖片說明：紀錄的 photoCaptions 是 { 檔名: "說明文字" }，每張照片最多一句說明。
// 跟 photos[] 一樣只存「參照」（檔名），不動照片檔案本身。
//
// 這支只負責清理前端送來的資料：只留下 photos[] 還有參照的檔名、文字去頭尾空白並
// 限制長度、空字串不留 key。整筆沒有任何說明就回傳 {}，這樣舊資料（沒有 photoCaptions
// 欄位）跟新資料長得一樣，不需要搬遷。

export const MAX_CAPTION_LENGTH = 100;

export function sanitizePhotoCaptions(captions, photos) {
  const result = {};
  if (!captions || typeof captions !== "object" || Array.isArray(captions)) return result;
  const keep = new Set(Array.isArray(photos) ? photos : []);
  for (const [filename, text] of Object.entries(captions)) {
    if (!keep.has(filename) || typeof text !== "string") continue;
    const clean = text.trim().slice(0, MAX_CAPTION_LENGTH);
    if (clean) result[filename] = clean;
  }
  return result;
}
