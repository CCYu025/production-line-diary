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
- **新增／編輯紀錄途中放棄時，必須清掉已經上傳但還沒送出的照片**——這條規則覆蓋兩個畫面：
  新增（`cleanupAbandonedAddPhotos()`，掛在 `#add-form` 的 `reset` 事件和 `goto()` 離開新增畫面時）
  跟編輯（`cleanupAbandonedEditPhotos()`，掛在「取消」、`closeDetail()`、切上一筆/下一筆時）。
  這是實測抓到的真實 bug：使用者中途放棄一次新增（例如填錯日期重來），已經上傳的照片沒被清掉，
  變成硬碟上的孤兒檔；下次選到同一個檔名的照片，multer 的防覆蓋機制會把新上傳的檔案改成
  `-1` 結尾，兩份內容一樣的照片就一起留在資料夾裡，看起來像「同一張照片重複出現」。
  **不要只在「送出成功」時清 `pendingPhotos`/`editState.pending`**，中途放棄的路徑也要清，
  而且是刪實體檔案，不是只清記憶體陣列。
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
- **「列印報表」（`#view-report`）刻意用瀏覽器內建的 `window.print()` + `@media print`
  CSS，不要改成裝 puppeteer / jsPDF 之類的 PDF 函式庫**。這是評估過三條路線後的決定：
  puppeteer 要多帶一個幾百 MB 的 Chromium 執行檔，對單人單機小工具不成比例；
  pdfkit/jsPDF 這類「畫圖式」函式庫預設字型不支援中文，這個 App 的內容全部是中文，
  不額外嵌入中文字型檔會印出方框或亂碼——這是真實會踩到的坑，不是理論風險。瀏覽器
  列印零新增依賴、零中文字型問題、直接沿用現有 CSS 設計語言，使用者只要多按一次
  「另存為 PDF」。報表內容刻意完整包含根本原因、品號/原料類別、照片——這幾個欄位是
  使用者明確要求「完整包含」的，不要為了排版精簡而省略。**但品號/原料類別是「有值
  才顯示」，不是永遠顯示**：原材區/RB2 這類非生產設備本來就沒有品號可填，顯示成
  「—」看起來像資料漏填，所以 `reportRecordHtml()` 裡這兩個欄位是條件式插入
  （`r.productCode ? rrField(...) : ""`），不要改回無條件顯示。
- **`#report-output` 的報紙式排版（masthead 標題雙線、襯線內文字體、圖表拉直角無陰影、
  紀錄用分隔線取代卡片）是把 App 既有的色彩 CSS 變數（`--ink-1`/`--line`/`--accent` 等）
  在這個容器內重新定義成紙本配色，不是逐一覆寫每個元件**。底下的 `.card`/`.kpi-card`/
  `.hbar-*` 全部沿用同一套變數，改一次全部套用；連帶讓長條圖變成純黑墨水色，不是品牌藍——
  這是刻意的，不是忘了上色。字體：內文/標題用 Noto Serif TC，標籤/數據維持 Noto Sans TC，
  兩者都已經加進同一個 Google Fonts 連結。
- **儀表板跟報表現在各有兩張「設備／分類」相關圖表，維度必須保持不同，不能兩張都算同一件
  事**：儀表板是「設備發生次數」+「問題分類發生次數」（原本的「設備停機時間排行」已經
  拿掉，換成次數），報表是「問題分類發生次數」+「設備發生次數」。**改動任何一張之前，先
  看旁邊那張顯示的是什麼維度**——曾經差點把儀表板的「設備停機時間排行」直接改成「問題
  分類」，結果會跟旁邊既有的「問題分類發生次數」完全重複，是使用者自己發現才擋下來的。
- **儀表板的「每日異常次數趨勢」（原名「每日停機時間趨勢」）現在也是次數，不是分鐘**
  （`renderTrend()` 讀 `agg.trend[].count`，不是 `.minutes`）。這代表**目前整個 App 已經
  沒有任何一張「依維度拆分」的圖表是用分鐘數呈現的**——分鐘數只剩儀表板 KPI 卡片的純量
  總數（「累計停機時間」「平均處理耗時」）跟報表左側「問題分類發生次數」旁邊那張。如果
  之後又要加「哪天/哪個維度停機最久」這種分析，要重新加一張圖，不要想成「把某張圖改回
  分鐘」就好，`aggregate.js` 裡的 `minutes` 欄位都還在，只是目前沒有圖表在用它們。
- **「嚴重度分布」是純手刻 SVG 甜甜圈圖（`stroke-dasharray`/`stroke-dashoffset` 技巧），
  不是 `renderHBarChart()`**——這是目前唯一一張長條圖以外形狀的圖表，圖例沿用
  `.legend-row`/`.legend-item`/`.legend-dot`（原本給「處理狀態總覽」用的 class）。
  `renderHBarChart()` 仍然是設備/分類這幾張長條圖在用，沒有整個換掉，改圖表樣式前先確認
  是在改哪一種。

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

## Claude Code 執行原則

使用者確認實作方向後，直接執行，不需要每一步都詢問「是否繼續」。探索性問題
（「可以怎麼做？」「你覺得呢？」）先用簡短文字回答並給出建議，等使用者確認方向後再動手。

**只在以下情況暫停確認：**
- 會覆蓋或刪除 `DATA_DIR` 裡的真實資料（`data.json`、照片）
- `git push` 到遠端、或建立/修改 GitHub repo
- 修改範圍明顯超出討論內容
- 發現安全性風險，或要改動上方「核心不變量」列出的任何一條
