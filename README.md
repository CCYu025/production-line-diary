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
- 一筆紀錄可以附多張照片
- 可以編輯、軟刪除（回收桶可復原）
- 分類/嚴重度/根本原因/處理狀態等欄位，讓資料照著 5W1H 補齊，而不只是流水帳
- 設備對照設定：F3/F4/G5/G6/F7/F8 目前對應的品號/原料類別，換線時更新一次，
  之後新增紀錄選了設備會自動帶入
- 匯出為 Excel：維持跟原始 Excel 相容的 8 欄格式，方便還不用這個 App 的人也看得懂
- 列印報表：選單日或日期範圍，產生含摘要圖表、完整根本原因/品號/原料類別/照片的
  報表畫面，用瀏覽器內建列印功能另存為 PDF，交辦上級用

## 開發緣起

這個專案是跟 Claude 討論、迭代出來的——從「這樣的紀錄方式有沒有意義」開始，
中間確認過畫面設計、資料庫格式、多張照片、修改刪除的作法、儀表板警示的取捨、
品號/原料類別怎麼填才不會增加現場負擔，最後才落地成這個 repo。
決策理由整理在 [`CLAUDE.md`](CLAUDE.md)（「核心不變量」章節），不是只留在當時的對話裡。

## 快速開始（開發模式）

```bash
npm install
cp .env.example .env   # 改成你自己的 DATA_DIR / LEGACY_XLSX_PATH
npm run migrate        # 只有第一次搬遷舊版 Excel 資料時需要
npm start
```

啟動後會自動開瀏覽器到 `http://localhost:3000`。沒有設定 `.env` 時，
會用 `backend/data/example/` 底下的範例資料開機，方便先看看畫面長怎樣。

## 專案結構

```
backend/
  server.js          Express app：靜態檔案 + REST API，啟動時／每小時跑一次孤兒照片清理
  lib/
    aggregate.js      彙總邏輯（純函式，前後端共用──frontend/index.html 直接 import 這支檔案）
    store.js          data.json 的讀寫
    photos.js          照片檔案生命週期（刪孤兒檔、換日期時搬檔、定期稽核）
    xlsx.js            舊版 Excel 讀取 / 匯出快照寫入
    migrateLogic.js    搬遷規則（分類對照表、追蹤中/已解決判斷）
  data/
    schema.md          資料結構說明（資料契約）
    example/           範例資料，clone 下來就能直接跑
frontend/
  index.html           全部畫面（儀表板/列表/日曆/新增/設定/報表/回收桶），fetch 這個 repo 的 API
scripts/
  migrate.js            一次性搬遷腳本
test/                   node:test，見下方
.github/workflows/ci.yml
```

## 測試

用 Node 內建的 test runner，沒有額外裝測試框架：

```bash
npm run check   # 語法檢查（node --check）
npm test        # node --test
```

CI（`.github/workflows/ci.yml`）在每次 push / PR 到 `main` 時自動跑這兩步；`main` 分支
有 branch protection，只能透過 PR 合併，且 CI 必須綠燈——開發流程細節見
[`CLAUDE.md`](CLAUDE.md)（「Git 工作流程」章節）。

值得一提的一個真實踩過的坑，測試裡有留下迴歸測試（`test/xlsx.test.js`）：
exceljs 把 Excel 的日期/時間格子讀成「UTC 錨定」的 `Date` 物件，一開始誤用本地
`getHours()`，在 UTC+8 的機器上把時間讀成多 8 小時——而且這個 bug 在跑在 UTC
時區的 CI runner 上測不出來（本地時間剛好等於 UTC），所以那支測試特地把
`process.env.TZ` 設成非 UTC，確保不管在哪台機器上跑都測得出來。

## 已知的相依套件安全性提示

`npm audit` 會顯示一個 `uuid`（經由 `exceljs`）的中等風險警告。目前沒有不降版
`exceljs` 就能修的版本，且該漏洞的觸發條件（呼叫 uuid 時手動傳入自訂 buffer）
在這個專案裡完全沒用到，風險評估後決定先不處理；之後 `exceljs` 出新版再升級。

## 資料在哪裡

真實資料**不在**這個 git repo 裡（見 `.gitignore`）：`data.json`、`工作日誌.xlsx`、
照片都留在 `DATA_DIR` 指定的資料夾（你自己電腦上的 OneDrive 同步資料夾），
只有程式碼進版控。
