# 產線日誌 重構計畫書

> 建立日期：2026-10-26　｜　狀態：完成待最終驗收　｜　進度見文末〈進度追蹤〉
>
> 這份計畫書是 2026-10-26 專案審查的結論整理。**接手實作的人（或 AI agent）動手前必讀**：
> 本文件 →〈不可破壞的既有決策〉→ 專案根目錄 `CLAUDE.md` →（動到資料時）`backend/data/schema.md`。

---

## 0. 目標與範圍

**目標**：在「功能不增加」的前提下，把這個 App 重構成更穩健、更好維護、介面更成熟專業的應用。

**範圍內**
1. 修正審查發現的正確性問題（照片遺失、根本原因無法修改…）。
2. 後端強化：錯誤處理、寫入序列化、輸入驗證、本機 CSRF／DNS rebinding 防護、資料備份。
3. 前端改寫為 React + Vite + TypeScript + Tailwind CSS + shadcn/ui（Radix），同時落實 UI/UX 翻新。
4. 文件同步（`CLAUDE.md` / `AGENTS.md` / `README.md` / `schema.md`）。

**範圍外（不要做）**
- 不新增任何使用者功能（新報表、新欄位、新圖表、登入、雲端、多人協作、通知…）。
- 不改 `data.json` 的欄位與意義（`schemaVersion` 不動）。
- 伺服器維持只綁 `127.0.0.1`。手機版 UI 仍要做好響應式，但不開放區網存取。
- 不換掉 `window.print()` 報表路線，不引入 puppeteer / jsPDF / html2canvas。

## 1. 決策紀錄（2026-10-26 使用者確認）

| 議題 | 決定 |
|---|---|
| 前端技術 | **React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui（Radix）**，伺服端資料用 TanStack Query，路由用 hash router |
| Git 流程 | **每個工作包開 PR → CI 綠燈 → 獨立驗證 → 合併前文件檢查 → squash merge**（使用者已一次授權本計畫範圍內的 push 與合併） |
| 手機存取 | 維持 `127.0.0.1`，不開放區網 |
| 執行分工 | 實作與驗證由 Sonnet 模型的 subagent 執行；主模型只負責分派、審閱結果、決定下一步 |
| 前端拆模組 | 原計畫的「先把 index.html 拆模組（畫面不變）」**取消**：既然要改寫成 React，中間版本會整個丟掉，改成新舊 UI 並存、最後一次切換（見 Phase 2–3） |
| UI 翻新時機 | 不先「照抄舊 UI 再翻新」，新 React 畫面**直接依〈UI/UX 規格〉實作**，避免做兩次 |
| 後端語言 | 維持 JavaScript（ESM）＋ JSDoc；`backend/lib/aggregate.js` 維持前後端共用（前端 TS 透過 `allowJs`／`checkJs` 或補 `.d.ts` 引用），不改寫成 TS |

## 2. 不可破壞的既有決策（新 UI 必須保留）

這些來自 `CLAUDE.md`〈核心不變量〉，改寫成 React 後**行為必須一致**。實作細節（例如 `.cp-chip`、`composedPath()`、`[hidden]` CSS）會隨舊檔案消失，但它們要解決的**行為**不能消失。

**資料與檔案**
- `data.json` 是唯一事實來源；`.xlsx` 只是匯出快照，從不回讀。
- `equipment` / `category` / `productCode` / `materialCategory` 是開放清單（`knownXxx()` 動態計算），`severity`（4 值）/ `status`（3 值）是固定 enum。
- `severity` 存的是新增當下決定的值（依耗時建議、可手動覆蓋）。
- 軟刪除 → 回收桶 → 永久刪除才清照片；`deleteUnreferencedPhoto` 判斷是否仍被參照（含軟刪除紀錄）。
- **照片選檔當下立刻上傳**，不是送出時上傳；放棄新增／編輯時要清掉已上傳未送出的照片，**上傳途中放棄**也要在上傳完成後補刪（新實作：**不要中止上傳**，等請求結束後檢查「已放棄」再依回傳檔名刪除——中止可能讓伺服器已存好的檔案變成沒人知道檔名的孤兒）。
- `sweepOrphanedPhotos` 的 1 小時安全時間不可縮短。
- `photoCaptions`：`{檔名: 一句話}`，最多 100 字，不進 Excel 匯出。
- 「處理」「根本原因」顯示全文的地方一律 `white-space: pre-wrap`。
- exceljs 用 UTC getter；`migrateLogic.js` 用 `path.win32.basename`。
- `equipmentMap` 是「目前」對照表；紀錄裡的品號／原料類別是建立當下的快照。預設列表 `F3/F4/G5/G6/F7/F8`；原材區、RB2 不自動列入。
- **新增畫面的品號／原料類別是唯讀預覽**（依設備自動帶入），編輯畫面才可改。
- 歷史資料的 `rootCause` / `productCode` / `materialCategory` 為 `null` 是誠實的「不知道」，不回填。

**複製既有紀錄**
- 兩個入口（列表／詳情的〔複製〕、新增畫面頂端「從過去紀錄帶入」含「最近紀錄／常見問題」兩分頁、搜尋、方向鍵＋Enter）共用同一套邏輯，複製欄位由 `pickCopyFields()` 白名單決定。
- 日期／時間／班別／耗時／設備標「請確認」，動過就消失，**不擋送出**；狀態重設為「待處理」；不複製照片；品號／原料依新設備重新帶入；根本原因會複製並在橫幅提醒。
- 已上傳照片時套用複製，不改日期／時間／班別。
- 「常見問題」依「分類＋問題」歸併（`commonProblems()`）。

**紀錄列表篩選**
- 固定值（狀態、嚴重度）是常駐分段按鈕帶筆數；開放清單（設備、分類）是可搜尋的**多選**下拉帶筆數；日期是 from～to 區間（快捷＋兩個日期框）。
- 筆數用 `facetCounts()`（套用其他條件、不套用自己這一維）；選項順序依全部紀錄總筆數；選項清單動態（META ∪ 資料 ∪ 已選）。
- 日期框：不在 change 時設 `min`/`max`、不自動改另一端；起 > 迄只提示、列表為空；`plausibleDate()` 忽略年份 < 1900 的中間值。
- 預設新到舊；關鍵字搜尋涵蓋根本原因；篩選列 sticky。
- 儀表板圖表／KPI／日曆格點進列表一律「先清掉舊條件再帶入單一值」（`drillTo`）。
- 詳情面板的上一筆／下一筆依**全部紀錄的時間順序**，不跟列表篩選。

**儀表板與報表**
- 沒有「重複發生警示卡」，不要加回（詳情面板的「重複發生 ×N」標籤保留）。
- 依維度拆分的圖表都用**次數**；分鐘只出現在 KPI 純量、報表排行表「累計耗時」欄、跨日報表日期分組標題。
- 儀表板「設備發生次數」與「問題分類發生次數」維度不同，不可重複；嚴重度是甜甜圈圖。
- 報表：`window.print()`；列印時隱藏所有 fixed 浮層；報紙風格（襯線字、雙線刊頭、直角無陰影、紙本配色，以變數重新定義達成）；統計區是兩張 grid 排行表（前 5 名＋其他、名次／項目／細條／次數／占比／累計耗時，容器查詢 < 660px 上下排、< 380px 省細條）；每筆紀錄是「刊頭條（時間・設備・分類）＋左邊欄事實＋右主欄（標題＝問題、處理、根本原因、照片格 n1–n6、圖N 編號與圖說）」；品號／原料類別有值才顯示；日期分組標題只在跨多天時出現。
- 「開新視窗」：複製已算好的報表 HTML 到新分頁，帶 `<base href>`、報表寬度 `max-width:960px` 置中、背景固定 `#e9e7df`、列印時 `max-width:none`；被彈出視窗封鎖要 toast 提示。

**其他**
- 單人、單機、只綁 `127.0.0.1`、沒有帳號系統。
- 真實資料永不進 repo。

## 3. 工作分解

每個工作包＝一個分支＝一個 PR。

### Phase 1 — 現行版本的正確性修正與後端強化

App 每天在用，重構期間舊 UI 仍是正式版，所以 bug 先修在現行 `frontend/index.html`，新 UI 之後也要帶著這些修正。

#### WP1a `fix/correctness`（前端為主）

| # | 問題 | 修正要求 | 驗收 |
|---|---|---|---|
| B1 | 新增畫面先選照片再改日期 → 照片在舊日期資料夾、紀錄指向新日期 → 破圖，1 小時後被當孤兒刪除 | 已有上傳中／已上傳照片時**鎖定日期欄**（disabled＋提示「已上傳照片，要改日期請先移除照片」）；編輯畫面同理（有「本次新上傳」照片時鎖定日期）。伺服器端防線見 WP1b 的 V4 | 先選照片 → 日期欄不可改；移除全部照片後可改；編輯畫面同 |
| B2 | 根本原因填過就無法修改；編輯表單沒有根本原因與處理狀態 | 編輯表單加入「根本原因」textarea 與「處理狀態」select；詳情面板快速填寫根本原因的行為保留 | 已有根本原因的紀錄可在編輯畫面修改、清空（清空存 `null`） |
| B3 | 報表預設日期用 `toISOString()`（UTC），台灣 00:00–08:00 預設成昨天 | 改用本地日期 | 加測試或以 `TZ=Asia/Taipei` 模擬清晨時間驗證 |
| B8 | 新增畫面耗時 `min=5 step=5`，輸入 7 被瀏覽器擋；編輯畫面沒限制 | 兩邊一致：`min=1 step=1` | 新增輸入 7 可送出 |

#### WP1b `fix/backend-hardening`（後端）

| # | 項目 | 要求 |
|---|---|---|
| H1 | async 例外 | 升級 **Express 5**（async handler 的 rejection 會進錯誤處理）＋統一錯誤中介層，回 `500 {errors:[訊息]}`；伺服器不可因單一請求失敗而結束 |
| H2 | 寫入序列化 | `store.js` 提供 `withStore(dataDir, async (store) => …)`：在同一把 promise 鎖內完成「讀 → 改 → 寫」；所有會寫入的路由都改用它。`nextId` 在鎖內計算 |
| H3 | Windows／OneDrive 鎖檔 | `rename` 遇 `EPERM`/`EBUSY`/`EACCES` 時退避重試（例如 5 次、50→800ms），仍失敗才丟錯；`data.json` 解析失敗時回 500 並 log，不可覆寫原檔 |
| H4 | 輪替備份 | 每天第一次寫入前把現有 `data.json` 複製到 `DATA_DIR/backups/data-YYYYMMDD.json`，保留最近 14 份；寫進 `schema.md` |
| V1 | enum 驗證 | `severity`、`status`、`shift` 必須是允許值（缺省時才用預設）；`PUT` 不再把任意 body 欄位合併進紀錄，只取白名單欄位 |
| V2 | 日期／時間 | `date` 必須是真實存在的日期（拒絕 `2026-02-30`）；`time` 00:00–23:59 |
| V3 | 照片檔名與路徑 | `photos[]` 每個元素必須是安全檔名（無 `/`、`\`、`..`、控制字元）；`DELETE /api/photos/:date/:filename` 驗證 `date` 格式與檔名；`photos.js` 內所有路徑操作 `path.resolve` 後確認仍在照片資料夾內（縱深防禦） |
| V4 | 照片存在性 | `POST`/`PUT` 時，新加入的照片檔必須存在於該紀錄日期的資料夾，否則 400（訊息說明「照片與日期不一致」）——B1 的伺服器端防線 |
| S1 | 本機 CSRF | 所有非 GET 的 `/api/*` 需帶 `X-Requested-With: production-line-diary`（自訂 header 會觸發 CORS preflight，跨站網頁送不出來）；前端 `api` 統一加上 |
| S2 | DNS rebinding | `Host` 主機名稱必須是 `localhost`／`127.0.0.1`／`[::1]`（不綁 port），否則 403 |

每一項都要有 `node:test` 測試（`test/api.test.js`、`test/store.test.js`、`test/photos.test.js`）。

### Phase 2 — 新前端基礎建設

#### WP2 `feat/web-foundation`

- 新目錄 `web/`：Vite + React 18 + TypeScript（strict）+ Tailwind CSS + shadcn/ui；`web/src/` 依功能分資料夾（`app/`、`components/ui/`、`features/<view>/`、`lib/`）。
- 共用邏輯：直接 import `backend/lib/aggregate.js`（Vite alias `@shared`），補型別宣告；**不要複製一份到前端**。
- `lib/api.ts`：型別化 API client（帶 `X-Requested-With` header、統一錯誤處理）；TanStack Query 管理資料與失效更新。
- 型別 `Record` / `Store` / `Meta` 依 `schema.md` 定義。
- **新舊並存**（WP2–WP3c 期間；WP3d 已切換，`/` 現在是新 UI、`/next/` 轉址到 `/`）：伺服器在 `web/dist` 存在時把新 UI 掛在 `/next/`，`/` 仍是舊 UI，直到 WP3d 切換。
- 設計系統（見〈UI/UX 規格〉§U0）：把現有 CSS 變數（淺色／深色）移植成 Tailwind 語意 token；間距、圓角、字級統一成尺度；字型改用 `@fontsource`（Noto Sans TC、Noto Serif TC、IBM Plex Mono）自行託管，不連 Google Fonts。
- App 外殼：桌面側欄、手機底部分頁列（§U1）、hash 路由（`#/dashboard`、`#/records?…`、`#/records/new`、`#/calendar`、`#/report`、`#/trash`、`#/settings`），篩選條件同步到 URL query，上一頁可用。
- 全域元件：Toast（成功／錯誤兩種樣式，`aria-live`）、確認對話框、可撤銷操作的 toast。
- 指令：`npm run build`（建置 web）、`npm run typecheck`、`npm run test:web`（Vitest）；`npm test` 仍跑 `test/` 下的後端測試（明確指定目錄，避免吃到 web 測試）；`npm start`／`start.bat` 在 `web/dist` 不存在或過期時自動建置，**clone 下來雙擊 `start.bat` 仍要能直接用**。
- CI 加上 typecheck、build、web 測試。
- 本 PR 的畫面只需要外殼＋各頁面空殼＋資料成功載入的證明。

### Phase 3 — 新 UI 實作（掛在 `/next/`，最後切換）

| 工作包 | 分支 | 內容 |
|---|---|---|
| WP3a | `feat/web-dashboard-records` | 總覽儀表板、紀錄列表（含完整篩選）、詳情面板（檢視、狀態快速切換、根本原因快速填寫、軟刪除＋復原 toast、上一筆／下一筆、燈箱） |
| WP3b | `feat/web-record-form` | 新增／編輯共用的 `RecordForm`、照片上傳 hook（立即上傳、放棄清理、上傳中鎖日期）、圖片說明、設備對照唯讀預覽、複製既有紀錄（兩入口）、建議 chips 合併 |
| WP3c | `feat/web-calendar-trash-settings` | 日曆檢視、回收桶（復原／永久刪除用確認對話框）、設備對照設定、匯出 Excel |
| WP3d | `feat/web-report-cutover` | 列印報表（忠實移植版面與所有報表規則）、開新視窗；**切換**：`/` 改為新 UI、移除 `/next/` 與舊 `frontend/index.html`、`/lib` static mount 視需要保留或移除；同步更新 `CLAUDE.md`／`AGENTS.md`／`README.md` |

## 4. UI/UX 規格（新 UI 依此實作）

**U0 設計系統**
- 色彩：沿用現有色票語意（`page / surface / surface-raised / ink-1 / ink-2 / ink-muted / line / accent / good / warning / serious / critical`、`seq-*`），淺色與深色兩套，跟隨系統。
- **對比**：`ink-muted` 在淺色背景須達 4.5:1（現值約 3.4:1，需調深），深色同理。
- 字級：內文最小 14px，輔助說明最小 12px；數字用等寬字型（tabular-nums）。
- 觸控目標最小 44×44px（手機）；所有可點元素可用鍵盤操作、有可見焦點環。
- 圓角尺度 `sm 6 / md 10 / lg 14`；間距 4 的倍數；**不使用行內 style 寫視覺樣式**。
- 語意分離：**嚴重度用顏色**（輕微綠、一般黃、嚴重橘、重大紅）；**處理狀態用形狀＋中性色**（待處理 ○、追蹤中 ◐、已解決 ●），不再與嚴重度共用紅色。

**U1 導覽**
- 桌面（≥ 1024px）：左側欄。頂端品牌，下方一顆主要按鈕「＋ 新增紀錄」；群組：〔檢視〕儀表板／紀錄列表／日曆；〔輸出〕列印報表／匯出 Excel（動作按鈕，不是頁面）；〔管理〕設備對照設定／回收桶（帶數量徽章）。
- 平板（768–1023px）：側欄收合成圖示列（tooltip 標示名稱）。
- 手機（< 768px）：頂部只放頁面標題；**底部分頁列**：儀表板／列表／（中央突出）＋新增／日曆／更多（報表、匯出、設定、回收桶）。品牌字不可換行成直排。

**U2 總覽儀表板**
- 範圍切換（全部／本月／本週）放頁首右側。
- KPI 分兩級：**主要（可行動）**——待處理、追蹤中（含「n 筆待補根本原因」），較大、可點進列表；**次要**——累計事件數、累計時間、平均處理耗時、照片建檔率，較小的一列。不可出現單張孤立卡片換行（固定欄數，手機 2 欄）。
- 圖表維持現有四張＋每日趨勢（維度與次數規則見 §2），長條、圖例、日曆格可用鍵盤觸發篩選。
- 空資料、載入中（骨架）、載入失敗（含重試按鈕）狀態。

**U3 紀錄列表**
- 篩選列行為見 §2；用 shadcn Popover／Command 實作多選下拉。
- 桌面表格欄位：「日期時間」（日期＋時間＋班別合併一格）／設備／分類／**問題（彈性寬度、最多兩行）**／耗時／嚴重度／狀態／操作（複製）。照片數改成問題欄內的小圖示。800px 寬不應出現橫向捲動。
- 手機：改成**卡片清單**——第一行問題（粗體），第二行設備・分類・日期時間，右上狀態，左側嚴重度色條。
- 整列可用鍵盤開啟詳情。

**U4 詳情面板**
- 桌面右側 Sheet（寬 480px）、手機全螢幕；具焦點鎖定、Esc 關閉、關閉後焦點回到觸發元素；關閉／上一筆／下一筆是真正的 `<button>`。
- 版面：**標題＝問題** → 嚴重度、狀態、重複發生、已編輯時間標籤 → 事實格（日期、時間、班別、耗時、設備、分類、品號／原料有值才顯示）→ 處理 → 根本原因（空白時顯示快速填寫）→ 照片（**沒有照片就不顯示佔位框**，只顯示一行「未附照片」）。
- 操作列固定在面板底部：編輯／複製為新紀錄／刪除。刪除直接移到回收桶並顯示「已移到回收桶〔復原〕」toast。

**U5 新增／編輯表單（共用 RecordForm）**
- 欄位順序：**設備 → 問題 → 問題分類 → 耗時（嚴重度自動建議、可覆蓋）→ 處理 → 根本原因 → 處理狀態 → 照片**。
- 日期／時間／班別預設「現在」，收合成一行摘要「2026/10/26 14:05・早班〔修改〕」，點修改展開；複製帶入時展開並標「請確認」。
- 頂端「從過去紀錄帶入」選擇器保留；**問題欄下方的建議 chips 與頂端「常見」chips 合併成一處**（頂端）。
- 設備、分類用可輸入的 Combobox（可選既有、可直接輸入新值）。
- 手機：送出列固定在底部（清除／新增紀錄）。
- 錯誤訊息顯示在欄位旁，而不是只有 toast。

**U6 日曆**：月曆格子顏色依次數（`seq` 色階），格子可鍵盤操作；手機格子內只顯示數字。

**U7 回收桶**：表格（手機卡片），復原直接執行並 toast；永久刪除用確認對話框（說明無法復原、照片一併刪除）。

**U8 設備對照設定**：可編輯表格列，未儲存變更時顯示提示，離開頁面前提醒。

**U9 列印報表**：版面規則見 §2，**畫面要與現行報表一致**（這是使用者逐項選定過的設計），只換實作方式。

**U10 回饋**：成功 toast 綠色勾、錯誤 toast 紅色並停留較久；長時間動作（匯出、上傳）有進行中狀態。

## 5. 執行與驗證流程（每個工作包）

1. **實作 agent**（Sonnet）：從最新 `origin/main` 開分支，在**自己的 git worktree** 工作（`git worktree add <暫存路徑> -b <分支> origin/main`），完成後跑 `npm run check`、`npm test`（Phase 2 起加 `typecheck`、`build`、`test:web`），commit、push、開 PR、等 CI 綠燈，回報。
2. **獨立驗證 agent**（Sonnet，依 `.claude/agents/verifier.md` 規則）：只讀不改，checkout 該分支到自己的 worktree，用**複製出來的範例資料**當 `DATA_DIR`、不衝突的 port，實際開瀏覽器（桌面＋375px 手機）照驗收條件想辦法弄壞它，回報通過／失敗與證據、沒驗證到的部分。
3. 發現問題 → 修正 agent 修 → **新的**驗證 agent 重驗修正部分。
4. **合併前文件檢查**（獨立 agent）：對照 PR diff 逐份檢查 `CLAUDE.md`、`AGENTS.md`（兩份同步）、`README.md`、`schema.md`，回報「已更新／不需更新（理由）」，需要補的 commit 進同一個 PR。
5. squash merge、刪分支，更新本文件〈進度追蹤〉。

**資料安全（所有 agent 必須遵守）**
- 真實資料夾 `C:\Users\tomof\OneDrive\桌面\20260918_工作日誌` **禁止讀寫、禁止當 `DATA_DIR`**。主 checkout 的 `.env` 指向它，所以**不要在主 checkout 執行 `npm start`／`npm run dev`**；啟動 App 一律明確設定 `DATA_DIR=<暫存資料夾中複製的 backend/data/example>`、`NO_OPEN_BROWSER=1`、非 3000 的 port。
- 驗證結束關掉自己啟動的伺服器、移除自己的 worktree。

## 6. 風險與回退

| 風險 | 對策 |
|---|---|
| 改寫 React 時遺漏既有行為 | §2 清單逐項列入驗收條件；WP3d 切換前做一次完整的 `CLAUDE.md` 手動驗證清單 |
| 新 UI 半成品影響每日使用 | 新 UI 只掛在 `/next/`，WP3d 才切換；任何時候 revert 單一 PR 即可回到前一狀態 |
| 建置步驟讓 `start.bat` 失效 | WP2 驗收條件：全新 clone → 雙擊 `start.bat` 可直接使用 |
| 字型自託管體積大 | 只打包用到的字重；中文字型使用 @fontsource 的 unicode-range 分包 |
| PR 之間文件衝突 | 序列合併；後合併者 rebase 解決 |

## 7. 進度追蹤

| 工作包 | 分支 | PR | 狀態 |
|---|---|---|---|
| 計畫書 | `docs/refactor-plan` | — | 已完成 |
| WP1a 正確性修正 | `fix/correctness` | #31 | 已完成 |
| WP1b 後端強化 | `fix/backend-hardening` | #32 | 已完成 |
| WP2 新前端基礎 | `feat/web-foundation` | #33 | 已完成 |
| WP3a 儀表板／列表／詳情 | `feat/web-dashboard-records` | #36 | 已完成 |
| WP3b 紀錄表單 | `feat/web-record-form` | #35 | 已完成 |
| WP3c 日曆／回收桶／設定 | `feat/web-calendar-trash-settings` | #34 | 已完成 |
| WP3d 報表＋切換 | `feat/web-report-cutover`（報表）、`feat/web-cutover`（切換） | #37、#38 | 已完成 |

**WP3d 切換紀錄**：`/` 改為新 UI（Vite `base: "/"`），`/next/…` 轉址到 `/…`，`frontend/index.html` 與 `/lib` 靜態路徑已移除。
建置失敗時（不再有舊介面可退）：`npm start` 印出明確錯誤、寫 `.web-build-error.log`、仍啟動伺服器，`/` 顯示「介面建置失敗」頁；修好後 `npm run build` 重新整理即可。
`CLAUDE.md`／`AGENTS.md`／`README.md` 已改寫為最終架構（核心不變量指向新介面的位置）。
