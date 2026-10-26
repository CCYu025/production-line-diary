// 前端（web/ 建置出來的 web/dist）怎麼被伺服器送出去：
//   - `/` 直接是新介面（Vite base "/"，hash 路由，所以只有 `/` 一個入口頁，不需要 SPA fallback）
//   - 舊網址 `/next/…` 是切換之前的預覽網址，使用者可能存了書籤：一律轉址到 `/…`
//     （瀏覽器轉址時會自動帶上原本網址的 #hash，所以 /next/#/report?… 會落在 /#/report?…）
//   - web/dist 不存在（建置失敗、沒建置）時，`/` 回一張「介面建置失敗」頁面並說明怎麼處理——
//     絕不回空白頁或預設的「Cannot GET /」。API 與照片不受影響，照常運作。

import express from "express";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

export const BUILD_FAILED_TITLE = "介面建置失敗";

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * 「介面建置失敗」頁面（獨立的一頁 HTML，不依賴任何建置產物）。
 * `detail` 是 scripts/ensure-web-build.js 留下的錯誤摘要（可能是空字串，例如根本沒執行過建置）。
 */
export function buildFailedPageHtml(detail = "") {
  const detailBlock = detail.trim()
    ? `<h2>錯誤訊息</h2><pre>${escapeHtml(detail.trim())}</pre>`
    : `<p class="muted">沒有找到建置的錯誤紀錄（可能是還沒建置過）。</p>`;
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${BUILD_FAILED_TITLE}｜產線日誌</title>
<style>
  :root{ color-scheme: light dark; --bg:#f9f9f7; --fg:#0b0b0b; --muted:#52514e; --line:#c3c2b7; --crit:#b42a2a; --code:#ffffff; }
  @media (prefers-color-scheme: dark){ :root{ --bg:#0d0d0d; --fg:#ffffff; --muted:#c3c2b7; --line:#383835; --crit:#ff8a8a; --code:#1a1a19; } }
  body{ margin:0; background:var(--bg); color:var(--fg); font:16px/1.7 "Noto Sans TC","Segoe UI",system-ui,sans-serif; }
  main{ max-width:720px; margin:0 auto; padding:32px 20px 64px; }
  h1{ margin:0 0 8px; font-size:24px; color:var(--crit); }
  h2{ margin:28px 0 8px; font-size:17px; }
  p{ margin:8px 0; }
  .muted{ color:var(--muted); }
  ol{ padding-left:22px; } li{ margin:6px 0; }
  code,pre{ font-family:"IBM Plex Mono",ui-monospace,Consolas,monospace; font-size:14px; }
  code{ background:var(--code); border:1px solid var(--line); border-radius:6px; padding:1px 6px; }
  pre{ background:var(--code); border:1px solid var(--line); border-radius:10px; padding:12px 14px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; max-height:320px; }
</style>
</head>
<body>
<main>
  <h1>${BUILD_FAILED_TITLE}</h1>
  <p>伺服器有啟動，<strong>你的資料與照片都沒有受影響</strong>，只是網頁介面（<code>web/dist</code>）沒有建置成功，所以畫不出畫面。</p>
  <h2>怎麼處理</h2>
  <ol>
    <li>看啟動伺服器的那個黑色視窗（或 <code>npm start</code> 的輸出），裡面有建置失敗的原因。</li>
    <li>在專案資料夾執行 <code>npm install</code>，再執行 <code>npm run build</code>。</li>
    <li>建置成功後<strong>重新整理這一頁</strong>即可（不用重啟伺服器）；也可以關掉視窗後再雙擊 <code>start.bat</code>。</li>
  </ol>
  <p class="muted">還是不行：確認 Node.js 版本 ≥ 22.12（<code>node -v</code>），或把下面的錯誤訊息交給維護的人。</p>
  ${detailBlock}
</main>
</body>
</html>
`;
}

/**
 * 把前端掛到 app 上。順序有意義：先處理舊的 /next/ 轉址，再送 dist 的靜態檔，最後 `/` 沒有建置產物時回失敗頁。
 * `express.static` 是每次請求才解析檔案路徑，所以伺服器啟動時 dist 還不存在、之後才建置完，也不用重啟。
 */
export function mountWebUi(app, { distDir, errorLogFile }) {
  app.use("/next", (req, res) => {
    // req.url 是 /next 之後的部分（含 query）。去掉開頭所有斜線再補一個，避免 /next//evil.com 轉成 //evil.com
    res.redirect(302, `/${req.url.replace(/^\/+/, "")}`);
  });

  app.use(
    express.static(distDir, {
      // 入口頁每次都要重新驗證：重建後檔名帶 hash 的 assets 換了，快取舊的 index.html 會指到不存在的檔案
      setHeaders(res, filePath) {
        if (path.basename(filePath) === "index.html") res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );

  // 走到這裡表示 static 沒有送出 index.html（dist 不存在或不完整）
  app.get(["/", "/index.html"], (req, res) => {
    let detail = "";
    try {
      if (errorLogFile && existsSync(errorLogFile)) detail = readFileSync(errorLogFile, "utf8");
    } catch {
      // 讀不到錯誤紀錄就算了，頁面照樣顯示處理步驟
    }
    res.status(503).set("Cache-Control", "no-store").type("html").send(buildFailedPageHtml(detail));
  });
}
