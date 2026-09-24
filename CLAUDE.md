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

## 快速啟動

```bash
npm install
cp .env.example .env   # 改成實際的 DATA_DIR / LEGACY_XLSX_PATH
npm run migrate        # 只有第一次搬遷舊版 Excel 資料時需要
npm start               # 或雙擊 start.bat
```

沒有設定 `.env` 時會用 `backend/data/example/` 的範例資料開機。

## 架構

| 層 | 技術 |
|---|---|
| 前端 | 純 HTML/CSS/JS，無框架，單一檔案 `frontend/index.html` |
| 後端 | Node.js（ESM）+ Express |
| 資料庫 | JSON 檔（`DATA_DIR/data.json`），**不在這個 repo 裡** |
| 照片 | 檔案系統（`DATA_DIR/照片/`），不是塞進資料庫的 blob |
| 測試 | Node 內建 `node:test`，沒有額外裝框架 |
| 執行環境 | 只監聽 `127.0.0.1`，不對外網開放；沒有帳號系統 |

## 關鍵檔案

| 檔案 | 職責 |
|---|---|
| `backend/server.js` | Express app、REST API、multer 照片上傳 |
| `backend/lib/aggregate.js` | 彙總邏輯（純函式）；**前端直接 import 這支檔案**（`/lib` 有 static mount），前後端共用同一套統計邏輯 |
| `backend/lib/store.js` | `data.json` 讀寫，原子性寫入（先寫暫存檔再 rename） |
| `backend/lib/photos.js` | 照片檔案生命週期（刪孤兒檔、換日期時搬檔） |
| `backend/lib/xlsx.js` | 舊版 Excel 讀取／匯出快照寫入——**注意 UTC getter**，見下方核心不變量 |
| `backend/lib/migrateLogic.js` | 搬遷規則（問題分類對照表、「追蹤中/已解決」判斷） |
| `backend/data/schema.md` | 資料結構完整說明（資料契約） |
| `frontend/index.html` | 全部畫面與前端邏輯，fetch 這個 repo 自己的 API |
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

## 測試方法

```bash
npm run check   # node --check 語法檢查
npm test        # node --test，目前 55+ 個測試
```

CI（`.github/workflows/ci.yml`）在每次 push/PR 到 `main` 時自動跑這兩步。

手動驗證（改動 `frontend/index.html` 或 API 之後建議實際跑一次，不要只看程式碼）：

1. `npm start` 或雙擊 `start.bat`，瀏覽器應自動開到 `http://localhost:3000`
2. 儀表板：KPI 卡片數字、圖表排行、每日趨勢都應該對得上目前的資料
3. 紀錄列表：點圖表長條、日曆格子、KPI 卡片都能正確帶入篩選條件
4. 新增紀錄：選設備後如果 `equipmentMap` 有對應資料，品號/原料類別應自動帶入；選照片後
   應該立刻看到縮圖預覽（代表已經上傳，不是等送出才傳）
5. 編輯紀錄：移除一張照片、存檔後，去 `DATA_DIR/照片/<日期>/` 確認檔案真的被刪掉，不是
   只從畫面上消失
6. 瀏覽器 console 應該沒有錯誤

## 敏感檔案清單

| 檔案 | 原因 |
|---|---|
| `.env` | 含實際的 `DATA_DIR` 路徑（這台電腦專屬），已在 `.gitignore` |
| `backend/data/data.json` | 真實產線資料，只留在 `DATA_DIR`，從不進這個 repo |
| `backend/data/example/` | **例外**：這是刻意保留的範例/示範資料，本來就該 commit |

## Claude Code 執行原則

使用者確認實作方向後，直接執行，不需要每一步都詢問「是否繼續」。探索性問題
（「可以怎麼做？」「你覺得呢？」）先用簡短文字回答並給出建議，等使用者確認方向後再動手。

**只在以下情況暫停確認：**
- 會覆蓋或刪除 `DATA_DIR` 裡的真實資料（`data.json`、照片）
- `git push` 到遠端、或建立/修改 GitHub repo
- 修改範圍明顯超出討論內容
- 發現安全性風險，或要改動上方「核心不變量」列出的任何一條
