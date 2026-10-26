# 產線日誌

產線設備異常紀錄的可視化儀表板。單人使用、單機本地執行，不需要雲端、不需要帳號。

**接手這個專案（不管是人還是 AI）先讀 [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md)**——
兩份內容一樣，只是給不同 AI 工具讀的慣例檔名。裡面是「核心不變量」：這個專案討論過、
確認過、也踩過坑的決策，附完整理由，不是只有程式碼看不出「為什麼」的部分。

資料格式的完整規格見 [`backend/data/schema.md`](backend/data/schema.md)——那份文件是這個專案的「資料契約」：
就算這個 App 停用或重寫，只要那份文件和 `data.json` 還在，資料就還讀得懂。

## 這是什麼

延續原本用 Excel（日期/班別/時間/耗時/設備/問題/處理/照片）記錄產線異常的習慣，
但加上：

- 自動彙整成儀表板（設備/分類排行、嚴重度分布、處理狀態總覽、每日趨勢）
- 點圖表可以直接篩選出對應的紀錄清單
- 紀錄列表可依狀態、嚴重度、日期區間、設備（可複選）、分類（可複選）與關鍵字篩選，下拉選項附筆數；預設新到舊
- 日曆檢視：依日期顯示當天的異常次數（顏色越深次數越多），點一天直接帶出當天紀錄
- 一筆紀錄可以附多張照片，每張可加一句圖片說明（詳情、燈箱與列印報表都會顯示）
- 複製既有紀錄：很多事件是曾經發生過的，可從紀錄列表／詳情面板按〔複製〕，或在新增畫面頂端「從過去紀錄帶入」
  （最近紀錄／常見問題），把舊紀錄的分類、問題、處理、根本原因預填進來，只需再改日期、時間、設備等少數欄位
- 可以編輯、軟刪除（回收桶可復原）
- 分類/嚴重度/根本原因/處理狀態等欄位，讓資料照著 5W1H 補齊，而不只是流水帳
- 設備對照設定：F3/F4/G5/G6/F7/F8 目前對應的品號/原料類別，換線時更新一次，
  之後新增紀錄選了設備會自動帶入
- 匯出為 Excel：維持跟原始 Excel 相容的 8 欄格式，方便還不用這個 App 的人也看得懂
- 列印報表：選單日或日期範圍，產生報紙排版風格的報表畫面（襯線字體、分隔線、直角無陰影），
  每筆紀錄為邊欄式版面（上方刊頭條放時間・設備・分類，左側其餘事實、右側標題＝問題＋處理＋根本原因＋依張數排成格的編號照片，
  跨多天會依日期分組），內容含摘要排行表（問題分類／設備，只列前 5 名，含占比與累計耗時）、根本原因、品號/原料類別（設備沒有才不顯示）、照片，用瀏覽器
  內建列印功能另存為 PDF，交辦上級用；也可以「開新視窗」把報表獨立開在一個沒有側邊選單
  的分頁，方便直接整頁截圖

## 開發緣起

這個專案是跟 Claude 討論、迭代出來的——從「這樣的紀錄方式有沒有意義」開始，
中間確認過畫面設計、資料庫格式、多張照片、修改刪除的作法、儀表板警示的取捨、
品號/原料類別怎麼填才不會增加現場負擔，最後才落地成這個 repo。
決策理由整理在 [`CLAUDE.md`](CLAUDE.md)（「核心不變量」章節），不是只留在當時的對話裡。

## 快速開始（開發模式）

需要 **Node.js ≥ 22.12**。

```bash
npm install
cp .env.example .env   # 改成你自己的 DATA_DIR / LEGACY_XLSX_PATH
npm run migrate        # 只有第一次搬遷舊版 Excel 資料時需要
npm start              # 或雙擊 start.bat
```

啟動後會自動開瀏覽器到 `http://localhost:3000`。沒有設定 `.env` 時，
會用 `backend/data/example/` 底下的範例資料開機，方便先看看畫面長怎樣。

**新介面預覽版**：專案正在把前端改寫成 React（`web/`），先放在 `http://localhost:3000/next/` 試用，
`/` 仍是目前每天在用的舊介面。`npm start` 會在 `web/dist` 不存在或過期時自動建置（失敗只警告、舊介面照常啟動）。
要改新介面：先照上面啟動後端，另開一個終端機執行 `npm run dev:web`（Vite 熱更新，預設 `http://localhost:5173/next/`，
自動代理 `/api` 與 `/photos`；後端不在 3000 埠時用 `BACKEND_PORT=xxxx npm run dev:web`）。重構進度見 [`docs/refactor-plan.md`](docs/refactor-plan.md)。

## 專案結構

```
backend/
  server.js          Express 5 app：Host 允許清單與 X-Requested-With 檢查（本機安全）→ 靜態檔案 + REST API → JSON 404 與統一錯誤處理；啟動時／每小時跑一次孤兒照片清理
  lib/
    aggregate.js      彙總邏輯（純函式，前後端共用──舊介面經 /lib 直接 import，新介面經 @shared alias import，不複製）
    aggregate.d.ts    aggregate.js 的 TypeScript 型別宣告（改 aggregate.js 要同步改）
    types.d.ts        DiaryRecord / Meta / RecordInput…型別（依 schema.md）
    store.js          data.json 的讀寫：withStore 寫入鎖、原子寫入（rename 重試）、每日備份、壞檔不覆寫
    validate.js       輸入驗證（欄位白名單、日期／時間／耗時／檔名規則；POST 全驗、PUT 只驗有帶的欄位）
    photos.js          照片檔案生命週期（刪孤兒檔、換日期時搬檔、定期稽核），所有路徑操作都限制在照片資料夾內
    photoCaptions.js   圖片說明（photoCaptions）的清理（只留還有參照的檔名、限制長度）
    xlsx.js            舊版 Excel 讀取 / 匯出快照寫入
    migrateLogic.js    搬遷規則（分類對照表、追蹤中/已解決判斷）
  data/
    schema.md          資料結構說明（資料契約）
    example/           範例資料，clone 下來就能直接跑
frontend/
  index.html           舊介面（正式版，網址 /）：全部畫面（儀表板/列表/日曆/新增/設定/報表/回收桶），fetch 這個 repo 的 API
web/                   新介面（預覽版，網址 /next/）：React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui
  src/app/             外殼（側欄／底部分頁列）、hash 路由
  src/components/      共用元件（ui/ 是 shadcn 風格元件）
  src/features/        各頁面（儀表板／紀錄列表／詳情面板（WP3a）、日曆／回收桶／設備對照設定（WP3c）、新增／編輯紀錄表單（WP3b）已實作；只有列印報表（WP3d）仍是空殼）
  src/lib/             api.ts（型別化 API client）、TanStack Query、URL query helper、toast
  src/styles/          設計 token（淺色／深色）
docs/
  refactor-plan.md      重構計畫書（分階段工作包、必須保留的行為、進度表）
scripts/
  migrate.js            一次性搬遷腳本
  ensure-web-build.js   npm start 前置：web/dist 不存在或過期時自動建置（失敗只警告，不擋舊介面）
test/                   後端 node:test，見下方
.github/workflows/ci.yml
```

## 測試

後端用 Node 內建的 test runner，沒有額外裝測試框架；新前端用 Vitest：

```bash
npm run check      # 後端語法檢查（node --check）
npm test           # 後端 node:test（test/**/*.test.js）
npm run typecheck  # 新前端 tsc --noEmit
npm run test:web   # 新前端 Vitest
npm run build      # 新前端 vite build
```

CI（`.github/workflows/ci.yml`）在每次 push / PR 到 `main` 時自動跑這五步；`main` 分支
有 branch protection，只能透過 PR 合併，且 CI 必須綠燈——開發流程細節見
[`CLAUDE.md`](CLAUDE.md)（「Git 工作流程」章節）。

值得一提的一個真實踩過的坑，測試裡有留下迴歸測試（`test/xlsx.test.js`）：
exceljs 把 Excel 的日期/時間格子讀成「UTC 錨定」的 `Date` 物件，一開始誤用本地
`getHours()`，在 UTC+8 的機器上把時間讀成多 8 小時——而且這個 bug 在跑在 UTC
時區的 CI runner 上測不出來（本地時間剛好等於 UTC），所以那支測試特地把
`process.env.TZ` 設成非 UTC，確保不管在哪台機器上跑都測得出來。

## 已知的相依套件安全性提示

`npm audit` 目前只剩 `uuid`（經由 `exceljs`）的 2 個中等風險警告（`exceljs` 與它依賴的 `uuid`）。
唯一的「修法」是把 `exceljs` 降到 3.4.0（破壞性變更），而該漏洞的觸發條件（呼叫 uuid 時手動傳入自訂 buffer）
在這個專案裡完全沒用到，風險評估後決定先不處理；之後 `exceljs` 出新版再升級。
（先前的 `body-parser`、`multer` 警告已分別靠升級 Express 5、`multer` 2.5 消除。）

## 資料在哪裡

真實資料**不在**這個 git repo 裡（見 `.gitignore`）：`data.json`、`工作日誌.xlsx`、
照片都留在 `DATA_DIR` 指定的資料夾（你自己電腦上的 OneDrive 同步資料夾），
只有程式碼進版控。

程式每天第一次寫入前，會自動把當時的 `data.json` 備份到 `DATA_DIR/backups/data-YYYYMMDD.json`（保留最近 14 份）；
`data.json` 如果被改壞（不是合法 JSON），App 會回報錯誤並拒絕寫入，絕不會覆蓋原檔。

## 安全性

- 伺服器只綁 `127.0.0.1`，不對區網或外網開放；沒有帳號系統。
- 每個請求的 `Host` 必須是 `localhost`／`127.0.0.1`／`[::1]`，否則回 403（擋 DNS rebinding）。
- 所有會寫入的 API（非 GET 的 `/api/*`）都必須帶 `X-Requested-With: production-line-diary` 標頭，否則回 403（擋別的網站偷偷送請求）。
  **用 `curl` 或自己寫腳本呼叫寫入 API 時別忘了加**，例如：
  `curl -X POST localhost:3000/api/records/1/delete -H 'X-Requested-With: production-line-diary'`。
