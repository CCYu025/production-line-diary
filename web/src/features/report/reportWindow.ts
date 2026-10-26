/*
 * 「開新視窗（方便截圖）」：把已經算好的報表 HTML 複製一份到新分頁，新分頁沒有側欄、沒有其他畫面干擾，
 * 瀏覽器或系統內建的整頁截圖工具才截得乾淨，不用自己裁切。
 * **不要改成 html2canvas 之類的函式庫把報表轉成圖片**：那類函式庫對中文字型、照片、CSS 細節常常轉壞，
 * 維護成本遠高於這裡真正需要的東西（理由同拒絕 puppeteer／jsPDF）。
 *
 * 新視窗的排版必須跟 App 內一樣，靠這幾件事維持：
 *   1. `<base href="{origin}/">`：照片是 `/photos/…` 的站內路徑，沒有 base 的話 document.write 出來的頁面
 *      解析基準不確定，可能整份報表沒有圖；樣式表與字型的網址也是站內絕對路徑（/next/assets/…），靠它載入。
 *   2. 複製目前頁面的所有樣式表（<link rel="stylesheet"> 與 dev 模式的 <style>），和 App 內用同一份 CSS。
 *   3. #report-output 固定 width:100%; max-width:960px; margin:0 auto（在 report.css）——新視窗沒有側欄，
 *      不鎖寬度就會被拉滿整個視窗，刊頭條與邊欄／主欄的比例整個跑掉；列印時 max-width:none（同檔案），不要拿掉。
 *   4. <body> 用固定灰底 #e9e7df，不能吃 App 的 --page（暗色模式下會變黑底）。
 *   5. 報表包在 <div id="root"> 裡：report.css 的列印規則用 `body > :not(#root)` 隱藏 portal 浮層。
 * `window.open` 可能被瀏覽器的彈出視窗封鎖擋掉（回傳 null）——呼叫端一定要檢查並 toast 提示，不要靜默失敗。
 */

export const REPORT_WINDOW_TITLE = "設備紀錄表";
/** 新視窗的固定灰底（不隨深色模式變） */
export const REPORT_WINDOW_BG = "#e9e7df";

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** 組出新視窗的完整 HTML。`headStyles` 是要帶過去的 <link rel="stylesheet"> 與 <style> 的 outerHTML。 */
export function buildReportWindowHtml({
  reportHtml,
  origin,
  headStyles,
}: {
  reportHtml: string;
  origin: string;
  headStyles: string;
}): string {
  return (
    `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<base href="${escapeAttr(origin)}/">` +
    `<title>${REPORT_WINDOW_TITLE}</title>${headStyles}` +
    // 灰底與外距；列印時回到白底、不要外距（頁面邊界由 @page 負責）
    `<style>body{margin:0;padding:24px;background:${REPORT_WINDOW_BG}}@media print{body{padding:0}}</style>` +
    `</head><body><div id="root">${reportHtml}</div></body></html>`
  );
}

/** 目前頁面上要帶到新視窗的樣式（外部樣式表連結＋行內 <style>）。 */
export function collectHeadStyles(doc: Document = document): string {
  return Array.from(doc.querySelectorAll<HTMLElement>('link[rel="stylesheet"], style'))
    .map((el) => el.outerHTML)
    .join("");
}

/**
 * 開新視窗並寫入報表。被彈出視窗封鎖時回傳 false（呼叫端要 toast）。
 * `open` 參數只為了測試可替換。
 */
export function openReportWindow(
  reportHtml: string,
  deps: { open?: typeof window.open; location?: Location; doc?: Document } = {},
): boolean {
  const open = deps.open ?? window.open.bind(window);
  const loc = deps.location ?? window.location;
  const win = open("", "_blank");
  if (!win) return false;
  win.document.write(
    buildReportWindowHtml({ reportHtml, origin: loc.origin, headStyles: collectHeadStyles(deps.doc ?? document) }),
  );
  win.document.close();
  return true;
}
