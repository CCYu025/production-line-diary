# 產線日誌

## 專案概述

產線設備異常紀錄的可視化儀表板。**單人使用、單機本地執行**，取代原本純 Excel 記錄的方式，
但保留 Excel 匯出能力。核心欄位設計依循 5W1H（見下方「資料設計理念」），資料儲存原則見
[`backend/data/schema.md`](backend/data/schema.md)——那份文件是這個專案的「資料契約」，
改任何欄位之前先讀那份文件。

這個專案是跟 Claude 討論、逐步迭代出來的：從「這樣記錄有沒有意義」開始，中間確認過畫面設計、
資料庫格式、多張照片、修改刪除的作法、儀表板警示的取捨、品號/原料類別怎麼填才不會增加現場負擔，
最後才落地成這個 repo。**這份文件的目的是把那些討論的結論（跟結論背後的理由）留下來**，
讓不管是誰（人或 AI）接手，都不用重新踩一次已經踩過的坑，也不會把已經拿掉的東西加回來。

> **重構進行中**：專案正依 [`docs/refactor-plan.md`](docs/refactor-plan.md) 分階段重構
> （新前端以工作包逐步推進）。任何工作包的改動都必須遵守該文件的 §2（不可破壞的既有決策）
> 與 §5（執行與驗證流程、資料安全）；開工前先讀，並在其 §7 進度表更新對應狀態。

## 快速啟動

需要 **Node.js ≥ 22.12**（`npm test` 的萬用字元路徑與 Vite 7 都要求）。

```bash
npm install
cp .env.example .env   # 改成實際的 DATA_DIR / LEGACY_XLSX_PATH
npm run migrate        # 只有第一次搬遷舊版 Excel 資料時需要
npm start               # 或雙擊 start.bat
npm run dev:web         # 開發新介面：Vite 熱更新（見下方）
```

沒有設定 `.env` 時會用 `backend/data/example/` 的範例資料開機。

- **舊介面（正式版）在 `/`，新介面（React，預覽版）在 `/next/`**，兩者並存直到切換（`docs/refactor-plan.md` 的 WP3d）。
- `npm start`（也就是 `start.bat`）啟動前會跑 `scripts/ensure-web-build.js`：`web/dist` 不存在或比原始碼舊就自動建置
  （建置套件 vite 還沒裝會先 `npm install`）。**建置失敗只印警告、舊介面照常啟動**。`web/dist` 不進版控。
- `npm run dev:web`：Vite dev server（預設 `http://localhost:5173/next/`），把 `/api`、`/photos` 代理到後端
  （`changeOrigin: true`，後端的 Host 檢查才會過）；後端不在 3000 埠時用 `BACKEND_PORT=xxxx npm run dev:web`。
  元件預覽頁 `#/_ui` **只存在於 `dev:web`**（`import.meta.env.DEV`），正式建置不含。
## 架構

| 層 | 技術 |
|---|---|
| 前端（正式） | 純 HTML/CSS/JS，無框架，單一檔案 `frontend/index.html`，在 `/`，直到 WP3d 切換 |
| 前端（新，預覽版） | `web/`：React 18 + Vite 7 + TypeScript（strict）+ Tailwind CSS 4 + shadcn/ui（Radix）+ TanStack Query + hash 路由；`web/dist` 不進版控，由 Express 掛在 `/next/`；字型用 `@fontsource` 自行託管 |
| 後端 | Node.js（ESM）+ Express 5 |
| 資料庫 | JSON 檔（`DATA_DIR/data.json`），**不在這個 repo 裡** |
| 照片 | 檔案系統（`DATA_DIR/照片/`），不是塞進資料庫的 blob |
| 測試 | 後端：Node 內建 `node:test`（`test/`）；新前端：Vitest + Testing Library（jsdom）+ `tsc --noEmit` |
| 執行環境 | Node.js ≥ 22.12；只監聽 `127.0.0.1`，不對外網開放；沒有帳號系統 |

## 關鍵檔案

| 檔案 | 職責 |
|---|---|
| `backend/server.js` | Express 5 app、REST API、multer 照片上傳；`web/dist` 掛在 `/next/`（在 Host／CSRF 之後、JSON 404 之前）。**中介層順序有意義**：先 Host 允許清單（S2）、再 `/api` 非 GET 的 `X-Requested-With` 檢查（S1）、再 `express.json()`，之後才是靜態檔與路由；所有寫入都走 `withStore()`；未知的 `/api/*` 回 JSON 404；最後一層統一錯誤中介層（async 的 rejection 只會回 JSON `{errors}`，不會讓程序結束）。啟動時、之後每小時跑一次孤兒照片清理 |
| `backend/lib/aggregate.js` | 彙總邏輯（純函式）；**前端直接 import 這支檔案**，前後端共用同一套統計邏輯：舊介面走 `/lib/aggregate.js`（static mount），新介面（`web/`）走 Vite／TS alias `@shared`；**一律 import，絕不複製一份**。也放「複製既有紀錄」的 `pickCopyFields()`（複製欄位白名單）與 `commonProblems()`（常見問題歸併），以及紀錄列表的篩選（`emptyFilter()` / `filterRecords()` / `facetCounts()` / `sortByDate()` / `datePresets()`）；另外匯出 `toISODate()`（本地日期字串，報表預設日期用它） |
| `backend/lib/store.js` | `data.json` 讀寫：原子性寫入（先寫暫存檔，再 `renameWithRetry()` rename；遇 EPERM/EBUSY/EACCES 退避重試）；`withStore(dataDir, fn)` 每個資料夾一把 promise 鎖，包住「讀 → 改 → 寫」；每天第一次寫入前自動備份到 `DATA_DIR/backups/data-YYYYMMDD.json`（保留最近 14 份）；讀到壞掉的 JSON 丟 `StoreCorruptError`（絕不覆寫原檔）；容忍開頭的 UTF-8 BOM |
| `backend/lib/photos.js` | 照片檔案生命週期（刪孤兒檔、換日期時搬檔）；所有路徑操作一律經 `resolveInside()`（解析後必須仍在照片資料夾內，否則丟錯），`photoFileExists()` 檢查照片是否在某日期的資料夾裡 |
| `backend/lib/photoCaptions.js` | 圖片說明（`photoCaptions`）的清理：只留 `photos` 還有的檔名、文字去空白並限制 100 字、空白不存 |
| `backend/lib/validate.js` | 輸入驗證（純函式）：`RECORD_FIELDS`（欄位白名單）、`pickRecordFields()`、`validateRecord(rec, supplied, { full })`、`normalizeRecordFields()`，以及 `isRealDate()`／`isValidTime()`／`parseDuration()`／`parseId()`／`isSafeFilename()`。POST 用 `full: true` 全部驗證，PUT 只驗證 body 有帶的欄位 |
| `backend/lib/xlsx.js` | 舊版 Excel 讀取／匯出快照寫入——**注意 UTC getter**，見下方核心不變量 |
| `backend/lib/migrateLogic.js` | 搬遷規則（問題分類對照表、「追蹤中/已解決」判斷） |
| `backend/data/schema.md` | 資料結構完整說明（資料契約） |
| `backend/lib/aggregate.d.ts`、`backend/lib/types.d.ts` | 給 TypeScript 用的型別宣告：`aggregate.d.ts` 對應 `aggregate.js` 的每個匯出，`types.d.ts` 是 `DiaryRecord`／`Meta`／`RecordInput`…（依 `schema.md`）。**改了 `aggregate.js` 的匯出或回傳形狀、或 `schema.md` 的欄位，必須同步改這兩支**；`web/src/lib/shared.test.ts` 會檢查匯出名稱一致（簽章是否一致只有 `tsc` 看得出來） |
| `frontend/index.html` | 舊介面（正式版）：全部畫面與前端邏輯，fetch 這個 repo 自己的 API |
| `web/` | 新介面（預覽版，掛在 `/next/`）。結構：`src/app/`（外殼、路由）、`src/components/`（`ui/` 是 shadcn 風格元件）、`src/features/<view>/`、`src/lib/`、`src/styles/index.css`（設計 token）。`src/lib/api.ts` 是**唯一的 API 層**，每個非 GET 請求（含 multipart 上傳與 DELETE）都帶 `X-Requested-With`，失敗統一丟 `ApiError`（保留伺服器的 `errors[]`）；`src/lib/feedback.ts` 的 `notify`／`toastUndoable` 是**唯一的 toast 入口**（不要直接 import sonner；錯誤訊息是 `role="alert"`）；篩選 ⇄ URL query 用 `src/lib/urlQuery.ts`；**所有「點進紀錄列表」的動作（儀表板圖表／KPI、日曆格子…）一律走 `src/lib/drill.ts` 的 `useDrillTo`／`drillFilter`**；**新增／編輯紀錄表單在 `src/features/records/form/`**：`RecordForm.tsx`（新增與編輯共用）、`usePhotoUploads.ts`（照片上傳／放棄 hook）、`model.ts`（純邏輯：驗證、複製、建立送出資料）、`formReducer.ts`、`CopyPicker.tsx`；通用元件 `components/Combobox.tsx`、`SegmentedControl.tsx`、`PhotoThumb.tsx` |
| `scripts/ensure-web-build.js` | `npm start` 的前置步驟：`web/dist` 不存在或過期才建置（只比檔案的 mtime，不比資料夾的）。**永遠不阻擋舊介面**——任何失敗都只印警告、結束碼 0 |
| `scripts/migrate.js` | 一次性搬遷腳本（CLI，`--force` 才會覆蓋既有資料） |

## 資料設計理念（給還沒讀過對話紀錄的人）

- **5W1H**：`problem`=What、`date`/`time`=When、`equipment`=Where、`shift`=Who、
  `rootCause`=Why（最常被跳過的一個）、`action`=How。原始 Excel 只缺 Why，這是加
  `rootCause` 欄位的理由。
- **PDCA 閉環**：`status`（待處理/追蹤中/已解決）存在的理由是讓「記錄過的問題」可以被
  追蹤到「真的解決了沒」，不是記完就結束。
- **4M1E 的痕跡**：`category` 大致對應 Machine/Material/Method 分類，但不是嚴格套用這個框架，
  只是拿來當分類設計的參考起點。

## 核心不變量

這些規則反映已經跟使用者討論過、確認過的決策，**修改前務必重新評估、不要憑直覺改回「看起來更標準」的做法**：

- **`data.json` 是唯一事實來源**；`工作日誌.xlsx` 只是「匯出快照」（`POST /api/export-xlsx` 產生），
  App 從不讀它。**不要改成雙向同步**——把 Excel 當即時資料庫寫入，會在使用者手動開著 Excel 時
  發生檔案鎖定衝突，這是已經評估過、刻意避開的坑。
- **`equipment` / `category` / `productCode` / `materialCategory` 是開放式建議清單**
  （`knownXxx()` 系列函式從現有資料動態算出），**絕對不要改回寫死的 enum**。現場一天內就冒出過
  RB2、CCD異常這種新代號；寫死清單只會一直落後現實。
- **`severity`（4值）/ `status`（3值）是刻意固定的 enum**，不像上面那些欄位一樣開放——
  這兩個是「App 自己定義的管理維度」，不該因為設備變多就跟著開放。
- **`severity` 是「新增當下依耗時規則決定的值」**（`severityFromDuration()`），存進資料的是
  當時的最終結果，不是即時公式算出來顯示用的。改規則不會、也不該動到舊資料。
- **軟刪除**（`deleted`/`deletedAt`）：永久刪除前必須先軟刪除；只有真的執行
  `DELETE /api/records/:id`（永久刪除）時，該筆紀錄專屬的照片才會被清掉。
- **照片是「選檔案當下立刻上傳」，不是「送出表單時才上傳」**。這是修過兩次同一類 bug 之後
  才定案的架構：舊做法在使用者手滑重複送出、或送出失敗又重試時，會把同一批照片重新上傳一次，
  產生 `-1` 結尾的重複檔案、原始檔案變孤兒。**不要為了「簡化程式碼」改回送出時才上傳的模式**。
- **移除照片參照時必須呼叫 `deleteUnreferencedPhoto`**（`PUT`/`DELETE /api/records` 都已經接好），
  確認沒有其他紀錄還參照同一個 `(date, filename)` 才刪除實體檔案。
- **新增／編輯紀錄途中放棄時，必須清掉已經上傳但還沒送出的照片**——這條規則覆蓋兩個畫面：
  新增（`cleanupAbandonedAddPhotos()`，掛在 `#add-form` 的 `reset` 事件和 `goto()` 離開新增畫面時）
  跟編輯（`cleanupAbandonedEditPhotos()`，掛在「取消」、`closeDetail()`、切上一筆/下一筆時）。
  這是實測抓到的真實 bug：使用者中途放棄一次新增（例如填錯日期重來），已經上傳的照片沒被清掉，
  變成硬碟上的孤兒檔；下次選到同一個檔名的照片，multer 的防覆蓋機制會把新上傳的檔案改成
  `-1` 結尾，兩份內容一樣的照片就一起留在資料夾裡，看起來像「同一張照片重複出現」。
  **不要只在「送出成功」時清 `pendingPhotos`/`editState.pending`**，中途放棄的路徑也要清，
  而且是刪實體檔案，不是只清記憶體陣列。
  **有照片「上傳中」或「已上傳、尚未送出／儲存」時，日期欄必須鎖住**（`#f-date`/`#e-date` 設為 disabled，
  旁邊顯示 `.lock-hint`「已上傳照片，要改日期請先移除照片」）：照片是依「選檔當下的日期」存進
  `照片/<日期>/` 資料夾的，之後再改日期，紀錄會指向另一個日期資料夾而破圖，1 小時後還會被
  `sweepOrphanedPhotos` 當孤兒刪掉。鎖定狀態由 `hasLivePhoto()`／`syncDateLock()` 計算，
  在 `renderAddPhotoPreview()`／`renderEditPhotoPreview()` 裡同步，所以任何改變照片清單的路徑
  （移除、清除、放棄、送出成功）都會自動解鎖；已標記 `abandoned` 或上傳失敗的項目不算。
  編輯畫面「既有（保留）照片」的縮圖網址一律用 `editState.origDate`（紀錄原本的日期），不跟著
  `#e-date` 變；改日期要存檔後才由伺服器搬檔（`movePhotosForDateChange`）。
  **關鍵的 race condition，第一版修復漏掉、造成 bug 回歸過一次**：`cleanupAbandonedAddPhotos`/
  `cleanupAbandonedEditPhotos` 只能刪「已經拿到檔名」的照片——如果放棄的當下上傳還在網路
  請求中（`entry.filename` 還是 `null`），這兩個函式看不到最終檔名，沒辦法刪。**必須把該
  entry 標記 `entry.abandoned = true`**，讓 `#f-photo`/`#e-photo` 的 `onchange` 裡那段
  `await api.uploadPhoto(...)` 完成之後自己檢查這個旗標、自己補刪——不能假設「清掉陣列」
  就等於「清掉了這次放棄的所有東西」，那個 entry 物件在 await 期間仍然活著，上傳一旦真的
  完成就會把 filename 寫回去，沒人接手就變孤兒。**用自動化測試驗證這類 bug 時，一定要真的
  讓放棄動作發生在上傳「還沒回應」的當下**（例如在同一個 tick 裡先 dispatch change、緊接著
  不等待就觸發放棄），不能等上傳的 promise resolve 之後才放棄——本地測試伺服器回應太快，
  照著「先上傳完再放棄」的順序測，測不出這個 race window，這正是第一版修復被判定「已修好」
  卻在真實手機網路延遲下復發的原因。
  **一次選多張時（`#f-photo`/`#e-photo` 的 `onchange` 迴圈）也要遵守同一條**：迴圈開頭記住它所屬的
  清單（新增是 `pendingPhotos` 陣列，編輯是 `editState` 與其 `pending` 陣列），只要這個清單被換掉
  （放棄、送出成功、儲存、重新進入編輯）或上一張已被標記 `abandoned`（包含使用者在上傳途中按了該縮圖的
  移除鈕——移除鈕也要標記 `abandoned`），就 `break`，不能再把剩下的檔案推進別的（新的）表單；
  畫面重畫前也要確認容器還在。驗證時要測「一次選 3 張、同一個 tick 立刻放棄」，且確認只發出 1 次上傳請求、
  硬碟上沒留下任何檔案。
- **編輯表單（`renderSoBodyEdit()`）要跟新增表單對齊**：包含「根本原因」（`#e-rootcause`，清空存 `null`）
  與「處理狀態」（`#e-status`）——不然根本原因一旦填過就再也改不了。耗時只接受正整數：新增與編輯都是
  `min="1" step="1"`；編輯面板不是 `<form>`，瀏覽器不會幫忙驗證，所以 `saveEdit()` 自己檢查，
  **不要改回 `Number(...) || r.duration`**（會讓 0 無聲退回舊值、7.5 直接存進去）。
  報表的預設日期用 `toISODate(new Date())`（本地日期），**不要用 `toISOString().slice(0,10)`**（UTC，
  台灣 00:00–08:00 會變成昨天）；`test/localDate.test.js` 刻意把 `TZ` 設成 Asia/Taipei 才測得出來
  （CI 跑 UTC 測不出），不要移除那行設定。
- **`sweepOrphanedPhotos()`（`backend/lib/photos.js`）是孤兒照片的最後一道防線，跟上面兩個
  client 端 `cleanupAbandoned*` 函式是兩層完全獨立的防護**。client 端的清理再怎麼補，都只能
  是「盡力而為」——關分頁、手機按返回鍵、系統把分頁凍結在背景，這些情況 JS 完全沒機會執行
  任何清理。`sweepOrphanedPhotos` 不依賴 client 端發生了什麼，只看伺服器啟動時（之後每小時
  重跑一次，見 `server.js` 的 `runPhotoSweep`）硬碟上實際的檔案跟 `records` 實際參照的照片
  兩邊對不上、且放了超過 `SWEEP_SAFE_AGE_MS`（1 小時）的部分才清掉。
  **這個安全時間邊界不能拿掉或縮短**：新增紀錄的過程中，照片可能剛上傳完、表單還沒送出，
  這個當下檔案本來就還沒被任何紀錄參照，是正常的中間狀態，不是孤兒；沒有這個緩衝，掃描
  可能會刪到使用者正在填的表單裡已經上傳好、等著送出的照片。
  **判斷「有沒有參照」要看全部 `records`，包含 `deleted:true` 的軟刪除紀錄**——回收桶復原前，
  軟刪除紀錄的照片仍然算「有參照」，不能被掃描當成孤兒清掉，這點跟 `isPhotoReferenced` 的
  邏輯一致，見上面「軟刪除」那條核心不變量。
- **圖片說明（`photoCaptions`）是 `{ 檔名: "一句話" }`，每張照片最多一句**，跟 `photos[]` 一樣只存參照、
  不動照片檔案，所以孤兒清理與換日期搬檔都不受影響；伺服器（`sanitizePhotoCaptions`）會丟掉 `photos`
  沒有的檔名，移除照片時說明自然跟著消失。輸入框直接內嵌在新增／編輯畫面每張縮圖旁（不開彈窗）。
  說明顯示在詳情面板縮圖下方、燈箱與列印報表的照片下方。說明**不會**進 Excel 匯出（那份只是給人看的
  精簡快照）。討論過、沒採用：在照片上標記位置（編號圓點）——功能較強但要處理座標、報表裁切對位、
  拖曳與 Esc 衝突等，使用者實際要的只是「圖片說明」。
- **「處理」「根本原因」是 textarea，內容可能有多行／條列（1. 2. 3.），資料本身就存著換行字元；顯示端必須用
  `white-space:pre-wrap`**（詳情面板的 `.so-block .v.multi`、報表的 `.rr-block .txt`），不然 HTML 會把換行吃成
  空白、條列擠成一行。曾經漏掉過，是使用者從詳情面板與報表截圖發現的。**新增任何會顯示這兩個欄位全文的地方
  都要套同樣的處理**；列表／複製選擇器那種單行截斷顯示（`white-space:nowrap`）不用。
- **exceljs 讀 Excel 日期/時間格子要用 `getUTCHours()` 等 UTC getter，絕對不要用本地
  `getHours()`**。這個 bug 在 UTC+8 的機器上會把時間多讀 8 小時，而且**在跑 UTC 時區的
  GitHub Actions runner 上測不出來**（本地/UTC 剛好相等）——`test/xlsx.test.js` 裡特地把
  `process.env.TZ` 設成非 UTC 才測得出這個迴歸，不要移除那段設定。
- **`migrateLogic.js` 抽檔名要用 `path.win32.basename`，不要用平台相依的
  `path.basename`**。舊版 Excel 裡的照片路徑一定是 Windows 反斜線格式（這台電腦存下來的），
  跟搬遷腳本實際在哪個 OS 上執行無關——這個曾經在本機測試全過、但在 Linux CI 上失敗，CI
  抓到後才修的。
- **`equipmentMap` 跟每筆紀錄自己的 `productCode`/`materialCategory` 是兩回事**：前者是
  「目前」的設備對照表（使用者在「設備對照設定」畫面維護，換線時才更新），後者是紀錄
  **建立當下**從對照表複製過去的副本。換線後舊紀錄不會跟著變，這是刻意的設計，不是 bug。
- **只有 F3/F4/G5/G6/F7/F8 是生產機台**，是 `equipmentMap` 設定畫面的預設列表
  （`PRODUCTION_EQUIPMENT` 常數）。原材區、RB2 是自動化設備裡的個別機構/區塊，沒有自己的
  品號，**不要自動列入設備對照表**——用得到再手動加一列。
- **新增紀錄畫面的品號/原料類別是唯讀預覽，不是可編輯欄位**（`#f-mapping-preview`）。
  原本做過可編輯、可覆蓋的版本，跟使用者討論後確認：換線頻率低（約 2-3 個月一次），
  例外情形很少見，兩個額外的可編輯欄位在每天最常用的畫面上是多餘的複雜度。例外情形
  的正確處理方式是**送出後到編輯畫面**（那裡的欄位仍然可編輯）調整那一筆，或去
  「設備對照設定」更新對照表本身。**不要把這兩個欄位改回可編輯的 input**，除非使用者
  明確說換線頻率已經提高到需要逐筆調整的程度。
- **「複製既有紀錄」是新增畫面的起點，不是新資料模型**。兩個入口（紀錄列表每列的〔複製〕與詳情
  面板的〔複製為新紀錄〕；新增畫面頂端的「從過去紀錄帶入」選擇器，分「最近紀錄」「常見問題」兩個
  分頁）都走同一個 `applyCopy()`，把舊紀錄預填進新增表單，送出時就是一般的新增，沒有任何「來源
  紀錄」關聯欄位。起因：實際資料中近一半紀錄是「同設備＋同分類＋同問題」的重複，同一問題常在同一天
  橫跨多台設備，使用者原本都是找舊紀錄複製貼上。
  **複製哪些欄位由 `aggregate.js` 的 `pickCopyFields()` 白名單決定**（category / severity /
  duration / problem / action / rootCause，有單元測試）。刻意不複製：
  `date`/`time`/`shift`/`equipment`（重設為現在或清空，並標「請確認」，使用者動過該欄位標示就消失，
  **不擋送出**）、`status`（新事件一律從「待處理」開始）、`photos`（每次事件拍自己的現場；也避免
  兩筆紀錄共用同一檔案，牽動換日期搬檔與孤兒清理規則）、`productCode`/`materialCategory`
  （是「建立當下依設備對照表取得的快照」，由新紀錄選的設備重新帶入，不能照抄舊紀錄）。
  `rootCause` 會一起複製（省打字），但橫幅會提醒「沿用舊紀錄內容，請確認是否適用這次事件」——
  不要把它改成預設清空，也不要把「請確認」改成必填擋送出。
  **選擇器的「常見問題」依「分類＋問題」歸併（`commonProblems()`）**，不是只看問題文字：同樣
  的字樣在不同分類下是不同事件。**選擇器的 chip 用 `.cp-chip`，不要改回 `.suggest-chip`**——
  `renderSuggestions()` 會對所有 `.suggest-chip` 重綁 onclick（填進「問題」欄），class 撞到會被覆蓋。
  **下拉清單靠 `composedPath()` 判斷「點在選擇器外」才收起**，不要改成 `e.target.closest()`：
  點分頁會重畫清單，被點的按鈕當下已脫離 DOM，會誤把清單收掉。
  已經上傳照片時套用複製，**不會改日期/時間/班別**（照片依當時日期存放）。
  曾評估但刻意不做：「儲存並複製下一筆」（使用者決定不要）、只靠「問題」欄自動完成的方案
  （只能依問題文字索引，無法複製特定那一筆，也不易被發現）。
- **紀錄列表的篩選依「選項的性質」分層，不要改回「每個選項一顆標籤」**。原本設備、分類、狀態全是標籤，
  設備與分類是開放清單、會一直長，三排標籤越來越雜亂，而且完全沒辦法篩日期。現在：
  **固定值**（狀態 3 值、嚴重度 4 值，見上面的 enum 不變量）常駐成分段按鈕、帶筆數；
  **開放清單**（設備、分類）收進可搜尋的**多選**下拉、每項帶筆數；**日期**是 `from`～`to` 區間
  （快捷＋兩個原生日期輸入，單日就是 `from === to`，日曆格子點進來也是這樣）。**不要在 change 處理裡替日期框設 `min`/`max` 或無條件寫回 `value`、也不要在起 > 迄時自動改另一端**：Chrome 會因此重置打到一半的輸入（月份打 11 第二位被吃掉），中間值還會把另一端誤改。逐位改年份時每打一位都會觸發 change（0002 → 0020 → 0202 → 2026），`onchange` 靠 `plausibleDate()` 忽略年份 < 1900 的中間值，不要拿掉。
  `filterState` 的形狀與比對邏輯都在 `aggregate.js`（`emptyFilter()` / `filterRecords()`，有單元測試），
  前端不要再各寫一份：設備、分類是**陣列**，不是字串。儀表板圖表、KPI 卡片、日曆格子點進列表一律走
  `drillTo(key, value)`（先清掉舊條件再帶入單一值）。
  **下拉裡的筆數用 `facetCounts()`：套用「其他所有條件」、但不套用自己這一維**——否則選了 F3 之後，
  設備下拉會只剩 F3 一項，沒辦法加選第二台。下拉選項的順序依「全部紀錄中的總筆數」，不依目前篩選後
  的筆數，才不會一勾選就整串跳動。**選項清單仍是動態的**（`META` ∪ 資料裡出現過的 ∪ 已選的），
  不要寫死。列表**預設新到舊**（點「日期」表頭或排序按鈕切換）；關鍵字搜尋涵蓋根本原因，與新增畫面的
  複製選擇器一致。篩選列固定（`position:sticky`）在頂端，窄螢幕（≤720px）改成不固定、下拉變成貼底的面板。
  下拉要靠 `composedPath()` 判斷「點在外面」才收起，理由同複製選擇器。
  狀態、嚴重度、關鍵字不另外顯示成「已套用條件」小標籤（分段按鈕與搜尋框本來就看得到）。
  詳情面板的「上一筆／下一筆」照全部紀錄的時間順序走（`chronological(activeData())`），不跟著列表的篩選或排序方向——這是刻意維持的既有行為。
  曾評估但刻意不做：左側篩選面板（會跟側邊欄搶空間）、可儲存的檢視（儀表板點擊帶入已經扮演這個角色）。
- **歷史資料的 `rootCause` / `productCode` / `materialCategory` 一律是 `null`**，
  來源舊 Excel 根本沒記錄過這些欄位。**不要事後用猜的回填**，`null` 是誠實的「不知道」。
- **儀表板故意沒有「重複發生警示卡」**。原本做過一版（只顯示單一最高頻問題、門檻寫死 3 次），
  跟使用者討論後確認它的資訊跟「問題分類排行」圖表、「追蹤中事件」KPI 完全重複，沒有提供
  圖表本身看不到的新分析價值，所以拿掉了，只把「一鍵篩選追蹤中紀錄」這個有用的行為併回
  KPI 卡片本身可以點擊。**不要因為「業界常見」就加回類似的東西**，除非能具體說清楚它提供了
  現有圖表看不到的資訊。
- **不要把資料庫格式改成 CSV**。討論過、有明確結論：`photos` 是陣列欄位，CSV 裝不下
  多值欄位，硬塞會需要土法分隔符號解析，是資料損毀的常見來源。`工作日誌.xlsx` 已經是
  「給人看的簡化匯出」，不需要再犧牲 `data.json` 的完整性去換一份功能更弱的格式。
- **`[hidden]{ display:none !important; }` 這條 CSS 規則不能拿掉**。這個原型最早是在
  claude.ai Artifact 平台上開發的，那個平台會自動注入這條規則；搬成獨立跑的 App 之後如果
  拿掉，畫面切換的每個區塊會全部疊在一起顯示，而且不容易從程式碼看出來——是實際打開瀏覽器
  操作才抓到的 bug。
- **這是單人、單機、本地執行的 App**：沒有帳號系統、伺服器只綁 `127.0.0.1`。除非使用者
  明確要求，不要加雲端部署、登入系統、多人協作功能。
- **「列印報表」（`#view-report`）刻意用瀏覽器內建的 `window.print()` + `@media print`
  CSS，不要改成裝 puppeteer / jsPDF 之類的 PDF 函式庫**。這是評估過三條路線後的決定：
  puppeteer 要多帶一個幾百 MB 的 Chromium 執行檔，對單人單機小工具不成比例；
  pdfkit/jsPDF 這類「畫圖式」函式庫預設字型不支援中文，這個 App 的內容全部是中文，
  不額外嵌入中文字型檔會印出方框或亂碼——這是真實會踩到的坑，不是理論風險。瀏覽器
  列印零新增依賴、零中文字型問題、直接沿用現有 CSS 設計語言，使用者只要多按一次
  「另存為 PDF」。**列印時必須把 `position:fixed` 的浮層（`.slideover`/`.scrim`/`.toast`/`.lightbox`）`display:none`**
  （`@media print` 裡已有）：它們平常收在畫面外，但列印時每一頁都會重複，詳情面板 `.slideover` 左邊的 1px 邊線
  會剛好印在每頁右緣，變成貫穿整頁的直線（使用者從 PDF 預覽發現的）；**之後新增 fixed 浮層也要加進這條**。
  報表內容刻意完整包含根本原因、品號/原料類別、照片——這幾個欄位是
  使用者明確要求「完整包含」的，不要為了排版精簡而省略。**但品號/原料類別是「有值
  才顯示」，不是永遠顯示**：原材區/RB2 這類非生產設備本來就沒有品號可填，顯示成
  「—」看起來像資料漏填，所以 `reportRecordHtml()` 裡這兩個欄位是條件式插入
  （`r.productCode ? rrFact(...) : ""`），不要改回無條件顯示。
- **`#report-output` 的報紙式排版（masthead 標題雙線、襯線內文字體、KPI 卡片拉直角無陰影、
  紀錄用分隔線取代卡片）是把 App 既有的色彩 CSS 變數（`--ink-1`/`--line`/`--accent` 等）
  在這個容器內重新定義成紙本配色，不是逐一覆寫每個元件**。底下的 `.kpi-card`，以及
  儀表板用的 `.card`/`.hbar-*`，沿用同一套變數，改一次全部套用；連帶讓報表裡的細條變成純黑墨水色，不是品牌藍——
  這是刻意的，不是忘了上色。字體：內文/標題用 Noto Serif TC，標籤/數據維持 Noto Sans TC，
  兩者都已經加進同一個 Google Fonts 連結。
- **儀表板跟報表現在各有兩張「設備／分類」相關圖表（報表是排行表），維度必須保持不同，不能兩張都算同一件
  事**：儀表板是「設備發生次數」+「問題分類發生次數」（原本的「設備停機時間排行」已經
  拿掉，換成次數），報表是「問題分類」+「設備」兩張排行表（維度同上，只是呈現改成表格，見下面那條）。**改動任何一張之前，先
  看旁邊那張顯示的是什麼維度**——曾經差點把儀表板的「設備停機時間排行」直接改成「問題
  分類」，結果會跟旁邊既有的「問題分類發生次數」完全重複，是使用者自己發現才擋下來的。
- **儀表板的「每日異常次數趨勢」（原名「每日停機時間趨勢」）現在也是次數，不是分鐘**
  （`renderTrend()` 讀 `agg.trend[].count`，不是 `.minutes`），**日曆檢視（`renderCalendar()`，
  顏色深淺跟格子裡的數字、圖例「較少／較多」）也是同一個道理，改成次數了**。這代表**目前
  整個 App 已經沒有任何一張「依維度拆分」的圖表／熱度圖是用分鐘數呈現的**——分鐘數只剩
  儀表板與報表 KPI 卡片的純量總數（「累計時間」「平均處理耗時」），**例外：報表排行表的「累計耗時」欄**
  （每個分類／設備的事件耗時加總，使用者看過方案預覽後選定的），**以及跨多天報表的日期分組標題上的「累計 X 分」**。如果
  之後又要加「哪天/哪個維度停機最久」這種分析，要重新加一張圖，不要想成「把某張圖改回
  分鐘」就好，`aggregate.js` 裡的 `minutes` 欄位都還在，只是目前沒有「圖表」在用它們（報表排行表以表格形式用到）。
- **「嚴重度分布」是純手刻 SVG 甜甜圈圖（`stroke-dasharray`/`stroke-dashoffset` 技巧），
  不是 `renderHBarChart()`**——這是目前唯一一張長條圖以外形狀的圖表，圖例沿用
  `.legend-row`/`.legend-item`/`.legend-dot`（原本給「處理狀態總覽」用的 class）。
  `renderHBarChart()` 仍然是**儀表板**設備/分類這幾張長條圖在用（報表已經不用，見下一條），
  改圖表樣式前先確認是在改哪一種。
- **報表統計區是兩張「排行表」（`reportRankHtml()`／`.rank-tb`），不要改回橫條圖卡片**：依次數排序（同次數比累計
  耗時）、只列前 5 名、其餘併成「其他 n 項」，欄位是名次／項目／細條／次數／占比／累計耗時。改掉橫條圖的原因：
  粗黑圓角條在報紙風格裡突兀又耗墨；條長只跟「最大那列」比，單日報表每項都是 1 次時會全部拉滿而失去資訊；
  項目沒有上限，「全部」範圍會拉出 15～17 列。**排行表用 grid 排版，不要改成 `<table>`**——實測 `<table>`
  的 `width:100%` 在 `#report-output`（`container-type:inline-size`）裡會被算成紙張最大寬度 880px，
  把表格撐出欄位外。**窄版面靠容器查詢（`@container`），不是 `@media`**：內容寬度 < 660px（App 內視窗縮小、
  手機）兩張表改上下排，< 380px 連細條也省掉；A4 列印的內容寬度約 688px，剛好夠並排。`agg.equipmentRanked`
  預設是依分鐘排序，所以 `reportRankHtml()` 自己重排，不要直接拿來用。討論過、沒採用：方塊點陣（一格＝一次，
  只有次數一個資訊）、本期重點（一句話摘要＋比例條，高度固定但看不到完整排行）。
- **報表每筆紀錄是「邊欄式」版面（`reportRecordHtml()`／`.report-record`），不要改回「資料欄＋照片疊成
  單欄」**：最上面是橫跨全寬的**「刊頭條」`.rr-strip`**（時間［日期小字＋時間大字］・設備・分類三格並排，21～22px
  粗體；時間、設備、分類是每筆紀錄最重要的辨識資訊，舊版放在標題上方一行 12.5px 灰色小字，掃讀時會漏掉，
  使用者看過三個方案預覽後選了刊頭條，不要縮回小字）；下面是兩欄（`.rr-cols`）：左側 148px 邊欄放其餘事實
  （班別、耗時、處理狀態、嚴重度、有值才顯示的品號／原料類別），右側主欄依序是**標題＝問題**（讀報表的人要先
  知道發生了什麼事，不是日期＋設備）、處理、根本原因、照片格。**照片依張數排成 1／2／3 欄的格子（`.rr-photos.n1`…`.n6`），圖說前面一律有
  「圖N」編號**——舊版把照片全部疊成右側單欄，照片多（資料裡有 4～6 張的紀錄）時單筆紀錄會超過一頁 A4、
  左欄也大片留白。`紀錄明細` 區段標題一律有；**日期分組標題（`.report-day`，含當天筆數與累計分鐘）只有
  報表跨多天才加**，單日報表封面已寫日期，不要加。`@media (max-width:560px)` 邊欄會改成橫排，照片格最多 2 欄。
  討論過、沒採用：上文下圖（最高）、主圖式（第一張放大、其餘縮成一列，視覺強但只有 2 張照片時版面不均）。
- **報表的「開新視窗（方便截圖）」（`openReportWindow()`）用 `window.open("")` +
  `document.write()` 把已經算好的 `#report-output` HTML 複製一份到新分頁，不要改成裝
  html2canvas 之類的函式庫把報表轉成圖片**。理由跟拒絕 puppeteer/jsPDF 一樣：那類函式庫
  轉中文字型、照片、CSS 細節常常跑版或模糊，維護成本遠高於這裡真正需要的東西。新分頁沒有
  側邊選單，是刻意的——拿掉其他 UI 之後，瀏覽器或系統內建的整頁截圖工具才截得乾淨，不用
  自己裁切。**寫進新分頁的 HTML 一定要帶 `<base href="{location.origin}/">`**，不然照片
  的相對路徑 `/photos/...` 解析基準不確定，可能整份報表沒有圖。`window.open` 可能被瀏覽器
  彈出視窗封鎖擋掉，`win` 會是 `null`——一定要檢查後 toast 提示使用者，不要靜默失敗。
  **新視窗的排版必須跟 App 內一樣，靠兩件事維持**：(1) `#report-output` 固定
  `width:100%; max-width:960px; margin:0 auto`（960 = `.app` 的 1240 − 側邊欄 224 −
  main 左右 padding 56，也就是 App 內報表本來就最寬的寬度）——新視窗沒有側邊欄，不鎖寬度
  就會被拉滿整個視窗，邊欄／主欄的比例整個跑掉；(2) 新視窗的 `<body>` 要用固定的灰底
  `#e9e7df`，不能吃 App 的 `--page`（暗色模式下會變黑底）。列印時 `max-width:none`，
  不要拿掉，不然列印寬度會被 960 卡住。改 `.app` 的 `max-width` 或側邊欄寬度時，記得一起
  檢查這個 960。同一套做法也用在 `personal-work-diary` 專案，兩邊要保持一致。
- **所有會寫入 `data.json` 的路由，一律走 `withStore(dataDir, async (store) => …)`（`backend/lib/store.js`），
  不要自己手寫 `loadStore → 改 → saveStore`**。`withStore` 是每個資料夾一條 promise 鎖，把「讀 → 改 → 寫」
  包成不能被插隊的一個單位。沒有鎖時，兩個同時進來的請求會讀到同一份舊資料、後寫的蓋掉先寫的（紀錄遺失），
  而且 `nextId()` 會算出重複的 id（`test/api.test.js` 有 20 個並發 POST 的迴歸測試）。所以 `nextId()` 一定要在
  鎖內算；要寫入時在回呼裡呼叫 `store.save()`；回呼丟例外（例如 `HttpError` 的 404／400）就不會寫入，也不會
  卡住排在後面的請求。**搬照片、刪孤兒檔這類檔案動作放在鎖內、`store.save()` 成功「之後」做**，而且只記 log
  （`bestEffort()`）、不重丟錯誤——資料都已經存好了，不要把這個請求變成 500 害使用者重送。純讀取（GET）
  可以直接用 `loadStore()`，不必排隊（`saveStore` 是原子 rename，讀到的永遠是完整的一份）。
- **`data.json` 讀不懂時絕對不能被覆寫；寫入失敗要有退路**。`loadStore()` 遇到不是合法 JSON 的檔案會丟
  `StoreCorruptError`，路由回 500、檔案位元組完全不動、也不留 `.tmp`（因為「讀」就失敗了，永遠走不到「寫」）；
  回給前端的訊息是固定的中文，不含伺服器上的絕對路徑（路徑與原因只進伺服器 log）。**`renameWithRetry()`
  的退避重試（`EPERM`/`EBUSY`/`EACCES`，50→800ms 共 5 次）不要拿掉**：`DATA_DIR` 在 OneDrive 同步資料夾裡，
  同步、防毒、檔案總管預覽都會短暫鎖住檔案，Windows 的 `rename` 因此偶發失敗。開頭有 UTF-8 BOM 的
  `data.json`（用記事本等工具另存時常見）讀得進來，存回去時不帶 BOM。**每天（電腦本地日期，不是 UTC）第一次
  寫入前**，現有的 `data.json` 會原樣複製到 `DATA_DIR/backups/data-YYYYMMDD.json`，只保留最新 14 份；
  備份失敗只記 log、不擋住這次寫入（`backupBeforeFirstSaveOfDay()`）。
- **輸入驗證集中在 `backend/lib/validate.js`；POST 與 PUT 的驗證範圍「刻意不同」，不要把 PUT 改成驗證整筆紀錄**。
  POST 是全新的資料，`validateRecord(..., { full: true })` 全部必填欄位都檢查；PUT 只驗證「這次 body 有帶的欄位」，
  也只寫入那些欄位（`normalizeRecordFields()` 只處理有帶的 key）。原因：舊資料裡有「讀得出來但現在不合法」的值
  （搬遷寫入的 `duration` 0、`"9:30"` 這種沒補零的時間、空的 `equipment`／`problem`），詳情面板的「快速切換狀態」
  與「快速填寫根本原因」送的只有 `{status}`／`{rootCause}`，若連沒碰的欄位也驗證，這些舊紀錄就永遠改不了狀態；
  整筆編輯表單會送全部欄位，所以使用者存檔時仍會被要求修正壞值。規則：`shift` ∈ 早／中／晚、`severity` ∈
  `SEVERITY_ORDER`、`status` ∈ `STATUS_ORDER`（缺省才套預設，帶了就必須合法）；`date` 是真實存在的日期且年份 ≥ 1900
  （`2026-02-30`、`0000-01-01` 都不行）；`time` 是補零的 `HH:MM`（00:00–23:59）；`duration` 是正整數（數字或純數字字串，
  小數、布林、陣列、0 都不行）；`photos[]` 每個都是安全檔名、重複的只留第一個；路由的 `:id` 只收十進位正整數
  （`0x1`、`1e0`、` 1` 不會命中紀錄 1，一律 404）。**PUT 只取 `RECORD_FIELDS` 白名單欄位**，body 裡的
  `id`／`deleted`／`deletedAt`／`updatedAt` 與任意欄位一律忽略；設備對照表的欄位只接受文字或空值。
- **照片檔名必須是單純、安全的檔名，所有照片路徑操作一律經 `resolveInside()`／`photoFileExists()`
  （`backend/lib/photos.js`），不要在別處臨時 `path.join(photosDir, …)`**。`isSafeFilename()` 擋掉含 `/`、`\`、`:`、
  `..`、控制字元的名稱（`photos[]` 與 `DELETE /api/photos/:date/:filename` 都驗證）；`resolveInside()` 是第二道、
  縱深防禦：把路徑解析成絕對路徑後，確認仍在照片資料夾裡，否則丟錯、不做任何檔案動作。上傳時檔名裡連續的 `..`
  會先收成單一個 `.`，避免出現「上傳成功卻存不進紀錄」的檔名。
- **V4：新加入紀錄的照片，必須已經存在於「該紀錄日期」的照片資料夾（`assertPhotosExist()`），否則回 400
  「照片與日期不一致」**——POST 檢查全部照片，PUT 只檢查不在舊紀錄裡的（原本就有的照片會跟著換日期搬檔）。
  這是前端「有照片就鎖日期欄」的**伺服器端後盾**：照片是依選檔當下的日期存進資料夾的，日期後來被改掉卻照常存檔
  就會破圖、1 小時後還會被孤兒清理刪掉。**前後兩層都要留著**，不要因為其中一層存在就拿掉另一層。
- **S1（本機 CSRF 防護）：所有非 GET 的 `/api/*` 請求都必須帶 `X-Requested-With: production-line-diary`，
  否則 403**。理由：自訂 header 會讓瀏覽器對跨站請求先送 CORS preflight，而這個伺服器永遠不回應 preflight，
  所以別的網站（即使使用者正好開著）送不出會改資料的請求；沒有它，任何網頁都能用不需 preflight 的簡單請求（例如表單 POST 到 `/api/records/:id/delete`）偷偷改資料。
  **前端的 api 層必須永遠帶這個 header，含 multipart 照片上傳與 DELETE**：目前是 `frontend/index.html` 的
  `CSRF` 常數；新 React 前端的 `web/src/lib/api.ts` 也一樣。用 `curl` 手動呼叫寫入 API 時也要加
  `-H 'X-Requested-With: production-line-diary'`。
- **S2（擋 DNS rebinding）：每個請求的 `Host` 主機名稱必須是 `localhost`／`127.0.0.1`／`[::1]`，否則 403，
  不要放寬**。惡意網站可以把自己的網域解析成 127.0.0.1，讓瀏覽器把本機服務當成同源讀取；這種請求的 Host 會是
  惡意網域。**只檢查主機名稱、不檢查 port**——測試與 `PORT` 環境變數會換 port，而 rebinding 攻擊靠的是換主機名稱，
  port 不是防線。這層中介層掛在最前面，連靜態檔與照片都受它保護，不只 `/api`。
- **新舊前端並存期間（WP2 起，到 WP3d 切換為止）**：
  - **共用邏輯用 import，不複製**：`backend/lib/aggregate.js` 由舊介面（`/lib`）與新介面（`@shared` alias）共用；型別宣告 `aggregate.d.ts`／`types.d.ts` 要跟著改（漂移測試 `web/src/lib/shared.test.ts`）。
  - **測試分開跑**：`npm test` 只跑後端 `test/**/*.test.js`（`node:test`）；新前端用 `npm run test:web`（Vitest）、`npm run typecheck`、`npm run build`；CI 五個指令（check／test／typecheck／test:web／build）都要綠燈。
  - **建置失敗不能拖垮舊介面**：`scripts/ensure-web-build.js` 失敗只警告、結束碼 0；`/next/` 只是預覽版，每天在用的是 `/`。
  - **字型自行託管，不連 Google Fonts**（`@fontsource`，只打包用到的字重）——這是離線／內網也要能用的本機工具。
  - **文字色 token 對比度 ≥ 4.5:1**（淺色、深色都是；`ink-muted` 曾經只有約 3.4:1）。`web/src/test/contrast.test.ts` 直接讀 `index.css` 的色票把關，調色票時不要把它改回難讀的顏色。
  - **`#/_ui` 元件預覽只在 `import.meta.env.DEV`**（`npm run dev:web`）存在，正式建置不含。
  - **紀錄列表的網址慣例（`#/records?…`，新 UI 的單一事實來源是網址）**：篩選條件用 `equipment`／`category`（重複的 key，值**不 trim**：紀錄裡存 `"F3 "` 就要用 `"F3 "` 篩到它，與舊介面一致）、`severity`、`status`、`problem`、`from`、`to`、`q`（只有 `q` 會 trim）；排序 `sort=asc`（預設新到舊不寫）；詳情面板 `open=<id>`（無效或不存在的值載入後會被拿掉）；儀表板範圍 `range=month|week`（`all` 不寫）。**預設值一律不寫進網址**。開詳情面板用 push（瀏覽器上一頁關閉面板），詳情內上一筆／下一筆、搜尋打字、切換排序用 replace；上一筆／下一筆依**全部有效紀錄的時間順序**（`chronological(activeData)`），不跟列表篩選。對外的入口網址：新增 `#/records/new`、複製 `#/records/new?copy=<id>`、編輯 `#/records/<id>/edit`（表單在 `src/features/records/form/`，列表與詳情只負責導過去）。
  - **所有「drill 進列表」都走 `web/src/lib/drill.ts`**（`drillFilter(key, value)`：先清掉舊條件再帶入單一值，日期是 from = to；`useDrillTo()` 導到 `/records?…`）。儀表板、日曆都用它，不要各寫一份。
  - **新介面表單的照片與複製規則（行為與舊介面一致，實作集中在 `web/src/features/records/form/usePhotoUploads.ts` 與 `model.ts`）**：照片選檔當下立刻上傳；**放棄**（清除／取消／離開頁面／元件卸載）統一走 `abandonAll()`——換一個全新的 session、刪掉已上傳未送出的檔案、立刻清掉縮圖並解鎖日期；**絕對不要用 AbortController 中止上傳**：中止可能讓伺服器已存好的檔案變成沒人知道檔名的孤兒，正確做法是讓請求跑完、回應回來後發現已放棄就用回傳的檔名 DELETE；一次選多張的迴圈在 session 被換掉或上一張已被放棄（含使用者在上傳途中移除該縮圖）時就停止，不會把檔案推進新的表單；有上傳中／已上傳未送出的照片時日期欄鎖住並顯示「已上傳照片，要改日期請先移除照片」（上傳失敗的不算）；上傳中不能送出。「清除」之後日期／時間回到現在（舊介面是空白，是 bug）。複製既有紀錄：欄位白名單是 `aggregate.js` 的 `pickCopyFields()`，在 `form/model.ts` 的 `applyCopyToValues()`／`reviewFieldsAfterCopy()` 套用——狀態重設為待處理、設備清空、不複製照片、日期／時間／班別／耗時／設備標「請確認」（動過就消失、不擋送出）；**已上傳照片時套用複製不改日期／時間／班別**（此時也不標日期「請確認」）。新增畫面品號／原料類別是設備對照表的唯讀預覽，送出時帶快照；編輯畫面才可改。
  - **舊資料欄位可能缺漏**（搬遷來的紀錄可能沒有 `photos`／`photoCaptions`）：新 UI 讀這些欄位一律先 `?? []`／`?.`，不要假設一定存在。
  - **新介面只是 `/next/` 的預覽版，直到 WP3d 才切換為 `/`**；每個工作包完成都要更新 `docs/refactor-plan.md` §7 進度表。

## 測試方法

```bash
npm run check      # 後端 node --check 語法檢查
npm test           # 後端 node:test（test/**/*.test.js），目前 156 個測試
npm run typecheck  # 新前端 tsc --noEmit（strict）
npm run test:web   # 新前端 Vitest（jsdom + Testing Library），目前 398 個測試（25 個檔案）
npm run build      # 新前端 vite build → web/dist
```

CI（`.github/workflows/ci.yml`）在每次 push/PR 到 `main` 時自動跑這五步。

手動驗證（改動 `frontend/index.html` 或 API 之後建議實際跑一次，不要只看程式碼）：

1. `npm start` 或雙擊 `start.bat`，瀏覽器應自動開到 `http://localhost:3000`
2. 儀表板：KPI 卡片數字、圖表排行、每日趨勢都應該對得上目前的資料
3. 紀錄列表：點圖表長條、日曆格子、KPI 卡片都能正確帶入篩選條件
   列表篩選：設備／分類下拉可複選、每項有筆數（選了 F3 之後設備下拉仍看得到別台設備），日期快捷與自訂區間（逐位打字不會被中間值打斷；起 > 迄時顯示提示、列表為空，不會自動改另一端），
   狀態／嚴重度分段按鈕、已套用條件小標籤可個別移除、「清除全部」；預設新到舊、可切換；捲動時篩選列固定在頂端；
   窄螢幕下拉變成貼底面板；點下拉外面會收起
4. 新增紀錄：選設備後如果 `equipmentMap` 有對應資料，品號/原料類別應自動帶入；選照片後
   應該立刻看到縮圖預覽（代表已經上傳，不是等送出才傳），每張縮圖旁有「圖片說明」輸入框；
   送出後詳情面板縮圖下方、燈箱都看得到說明；編輯畫面可修改或清空既有說明
   日期鎖定：選照片後日期欄變灰不能改並出現提示，移除全部照片後恢復；一次選 3 張後立刻按「清除」或切到別的畫面，
   去 `DATA_DIR/照片/<日期>/` 確認沒有留下任何檔案
   複製既有紀錄：列表按〔複製〕、詳情面板按〔複製為新紀錄〕、新增畫面頂端選擇器（切分頁／搜尋／
   方向鍵＋Enter）都應預填表單，日期/班別/時間/耗時/設備標「請確認」、改過就消失，狀態為「待處理」、
   沒有照片；送出後橫幅與標示都消失
5. 編輯紀錄：處理／根本原因打多行（1. 2. 3.）存檔後，詳情面板與列印報表都要保留換行；移除一張照片、存檔後，去 `DATA_DIR/照片/<日期>/` 確認檔案真的被刪掉，不是
   只從畫面上消失
   編輯畫面另外驗證：根本原因、處理狀態可修改（根本原因清空存成 null）；耗時填 7.5、0、空白、-3 都會被擋下並顯示提示；
   改日期後既有照片的縮圖仍看得到，存檔後照片搬到新日期資料夾；一次選好幾張後按「取消」並立刻重新進入編輯，
   不會殘留縮圖或孤兒檔
6. 日曆檢視：每格的數字是當天的異常「次數」，顏色深淺跟次數成正比（不是停機分鐘）
7. 列印報表：選日期後「產生報表」，確認統計區兩張排行表（單日、一週、全部各看一次：只列前 5 名、其他併成一列、
   窗口縮小時改上下排不撐出欄位）、每筆紀錄上方有刊頭條（時間・設備・分類三格，窄版時間獨佔第一列）、
   下方左邊欄右主欄、跨多天時有日期分組標題、根本原因／照片都有出來且圖說前有「圖N」、有說明的照片下方
   有圖片說明、沒設定品號的設備不顯示品號/原料類別；「列印／另存 PDF」預覽的頁面右緣不能有貫穿整頁的直線；按「開新視窗」（瀏覽器若擋彈出視窗要先允許），新視窗要是灰底置中的
   紙張，排版跟 App 內一樣
8. 後端防護與驗證（改動 `backend/server.js`、`store.js`、`validate.js`、`photos.js` 之後必跑；一律用範例資料的複本當
   `DATA_DIR`，埠號設成 3000 以外）：
   - 舊資料寬容：在 `data.json` 放一筆 `duration: 0`、`time: "9:30"`、`equipment: ""` 的紀錄，詳情面板的「快速切換狀態」與
     「快速填寫根本原因」都能成功、其他欄位原封不動；但按「編輯紀錄」整筆存檔會被擋下並顯示清楚的錯誤訊息，改正後才存得進去
   - 本機 CSRF：`curl -i -X POST localhost:3102/api/records -H 'Content-Type: application/json' -d '{}'`（沒帶
     `X-Requested-With`）回 403；加上 `-H 'X-Requested-With: production-line-diary'` 後才進到驗證（400）
   - DNS rebinding：`curl -i localhost:3102/api/records -H 'Host: evil.com'` 回 403
   - 未知路由：`curl -i localhost:3102/api/xxx` 回 JSON 404（`{"errors":[…]}`），不是 HTML 錯誤頁
   - 壞檔不覆寫：把 `data.json` 截斷成一半的 JSON，所有 `/api` 都回 500 與固定的中文訊息（不含路徑），
     `data.json` 位元組完全沒變、資料夾裡沒有 `.tmp` 檔；修復後恢復正常
   - 每日備份：當天第一次寫入後出現 `backups/data-YYYYMMDD.json`（內容是寫入前的版本），同一天再寫不會覆蓋它
   - 並發寫入：同時送多筆新增（例如 `for i in $(seq 20); do curl … & done`），全部成功、id 不重複、沒有遺失
9. 新介面（`/next/`，改動 `web/` 之後必跑；先 `npm run build` 或用 `npm start` 自動建置，一樣用範例資料的複本當 `DATA_DIR`）：
   - 視窗寬 375／900／1280 各看一次，每個各看淺色與深色（改系統偏好）；都不能出現橫向捲動（含 320 寬）
   - 側欄：1280 完整側欄；900 收合成圖示列，滑過圖示出現 tooltip；375 只有頂部標題與底部分頁列（中央突出的「新增」）；
     品牌「產線日誌」不會換行成直排
   - 鍵盤：Tab 走得到所有導覽項目與按鈕、焦點環清楚可見；手機「更多」面板開啟時焦點在第一個項目、
     按 Esc／關閉鈕關閉後焦點回到「更多」按鈕、選了連結或按瀏覽器上一頁關閉後焦點在主內容（不是掉到 body）
   - 儀表板空殼：筆數正確；關掉後端再重新整理資料會看到錯誤狀態與重試鈕，重啟後按重試恢復
   - 側欄／「更多」的「匯出 Excel」：進行中 toast → 成功 toast；連點只送出一個請求
   - 安全：`curl -i localhost:<埠>/next/ -H 'Host: evil.com'` 回 403；`web/dist` 裡找不到元件預覽頁（`#/_ui` 只在 `dev:web`）
   - 新增／編輯表單：選 3 張照片後在第一張還在上傳時按「清除」（或點側欄連結離開並選「離開」）——Network 只該看到 1 次上傳請求（慢速網路下可在 DevTools 調成 Slow 3G），
     回應回來後有一次 DELETE，`DATA_DIR/照片/<日期>/` 沒有留下任何檔案；選照片後日期欄鎖住並出現提示、移除後解鎖；
     已上傳照片時用頂端選擇器帶入舊紀錄，日期／時間／班別不變；清除後日期時間回到現在；有未送出內容時離開（側欄連結、瀏覽器上一頁）會先詢問，選「繼續填寫」焦點回到原欄位；
     列表〔複製〕與詳情〔複製為新紀錄〕→ `#/records/new?copy=<id>` 預填；詳情〔編輯〕→ `#/records/<id>/edit`，存檔後回到 `#/records?open=<id>` 且詳情已更新；新增成功 toast 的〔查看〕開啟該筆詳情
   - 舊介面 `/` 完全不受影響（上面第 1–8 項照舊可用）
10. 瀏覽器 console 應該沒有錯誤

## 敏感檔案清單

| 檔案 | 原因 |
|---|---|
| `.env` | 含實際的 `DATA_DIR` 路徑（這台電腦專屬），已在 `.gitignore` |
| `backend/data/data.json` | 真實產線資料，只留在 `DATA_DIR`，從不進這個 repo |
| `backend/data/example/` | **例外**：這是刻意保留的範例/示範資料，本來就該 commit |

## 驗證由獨立 agent 執行

自己寫的程式自己驗證，會照自己的假設去測，漏掉的正是自己沒想到的情境。實例：照片孤兒檔的
race condition，第一版修復就是這樣被判定「已修好」、後來在真實手機網路下復發。所以**驗證類
工作交給獨立的 agent**（`.claude/agents/verifier.md`；沒有時用 general-purpose agent，交接內容
一樣）。這是個人使用的小工具，規則刻意保持輕量：

- **要交給獨立 agent**：功能／畫面改動的實測、找 bug 的 review、確認修復真的有效、合併前的
  文件有沒有漏更新。
- **不用**：`npm run check`、`npm test`（跟 CI 等價，自己跑就好）、錯字之類純文件修正、單純問答。
- **時機**：實作完成、開 PR 之前驗證；合併時只確認驗證對應的是最新的 commit（驗證之後又改了
  程式碼，就重驗改動的部分）。**例外**：「合併前的文件檢查」是使用者說「合併」時才做，純文件的
  PR 也一樣要做。
- **交接**：給驗收條件（使用者的決定）、改了哪些檔案、怎麼啟動（`DATA_DIR` 指到**複製出來**的
  資料，不碰真實資料）、相關的核心不變量。**不給**自己的實作理由，也不給「我驗過 X 了」的結論。
  worktree 只含已 commit 的內容、沒有 `node_modules`／`.env`：先 commit，並請驗證者先 `npm install`。
- **驗證者只讀不改**，用 `isolation: "worktree"` 隔離；回報每項驗收條件的通過／失敗與證據、
  發現的問題與重現步驟、**沒驗證到的部分**。目標是想辦法弄壞它，不是照清單打勾。
- 發現問題 → 修好後找**新的** agent 重驗；不同意驗證結果時交給使用者判斷，不自己裁定。
- 限制：同一個模型有相關的盲點，CI 仍是最終依據；手機上的操作手感要使用者自己試。

## Git 工作流程

這個 repo 是**公開**的（考慮過作品集/履歷用途後決定公開，commit 歷史查過一輪，
確認真實資料/`.env`/照片從來沒進過版控才改的）。`main` 分支有開 branch protection：
不能直接 push，只能透過 PR 合併，而且 CI（`test` job）要綠燈才能合併
（`required_approving_review_count: 0`——因為只有一個人維護，不需要真的有人 approve，
但仍然強制走 PR + CI 檢查這個流程，連 repo 管理者自己也繞不過去，`enforce_admins: true`）。

**每次改動的標準流程：**

```bash
git checkout -b <類型>/<簡短描述>   # 例如 fix/photo-orphan-cleanup
# ...改動、commit...
git push -u origin <分支名>
gh pr create --title "..." --body "..."
gh pr checks --watch   # 等 CI 跑完
gh pr merge --squash --delete-branch
```

- **Squash merge**：合併後 `main` 上只留一個乾淨的 commit，開發過程中的中間 commit
  不會留在 `main` 的歷史裡。`delete-branch` 讓合併後自動清掉分支，不用手動清。
- 不需要等待任何人 review——`required_approving_review_count` 是 0，PR 開了、CI 過了
  就能合併，PR 的作用是留下「這次改動的完整說明」，不是卡審核流程。
- 真的需要緊急直接改 `main`（理論上不會發生，因為 `enforce_admins` 也擋住了）：
  沒有繞過的後門，一律走 PR。

### 合併前的文件檢查

文件常常落後程式碼，事後才另開 PR 補（要多走一次 PR + CI）。所以**使用者說「合併」時，
執行 `gh pr merge` 之前先做這一步**，需要補的內容直接進同一個 PR：

1. 對照這個 PR 的完整 diff（`git diff main...HEAD`），逐項判斷下列文件是否需要更新
   （這一步屬於驗證工作，交給獨立 agent 做，見〈驗證由獨立 agent 執行〉）：
   - `CLAUDE.md`：「核心不變量」、「關鍵檔案」表、「手動驗證」步驟、測試數量的說明
   - `AGENTS.md`：跟 `CLAUDE.md` 同步更新（兩份只有「測試方法」與最後一節的標題不同）
   - `README.md`：功能列表與快速啟動
   - `backend/data/schema.md`：只有動到欄位或資料結構時才需要
2. 回報兩份清單：「已更新」與「不需更新（理由）」。不能只說「文件沒問題」——要讓使用者
   看得出每一份都真的檢查過。
3. 需要補的內容 commit 到同一個 PR 分支、push、等 CI 綠燈，再合併。
4. 檢查中如果發現還要改程式碼（不只是文件），先暫停問使用者，不要順手改。

## AI 協作原則

使用者確認實作方向後，直接執行，不需要每一步都詢問「是否繼續」。探索性問題
（「可以怎麼做？」「你覺得呢？」）先用簡短文字回答並給出建議，等使用者確認方向後再動手。

**只在以下情況暫停確認：**
- 會覆蓋或刪除 `DATA_DIR` 裡的真實資料（`data.json`、照片）
- `git push` 到遠端、或建立/修改 GitHub repo
  （例外：使用者說「合併」時，視同授權把**純文件**的補充 commit push 到該 PR 分支；
  要動到程式碼的修改仍然要先問）
- 修改範圍明顯超出討論內容
- 發現安全性風險，或要改動上方「核心不變量」列出的任何一條
