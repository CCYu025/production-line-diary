# 產線日誌 Cyber-Terminal 主題 設計規格書

> 狀態：**P0 已合併（PR #40）；P1 實作＋獨立驗證完成、待設計審查與合併（分支 `feat/cyber-p1-static`，PR #41）；P2–P3 尚未實作**（2026-10-28）。
> 風格：終端機為骨架、賽博龐克霓虹為強調色的混合風格（「Cyber-Terminal」）。
> 本文件是之後實作與驗收的唯一依據；實作時若要偏離，先改這份文件再改程式碼。

---

## 0. 目標與範圍

**目標**：在現有介面上加一套**可選用（opt-in）**的「Cyber-Terminal」主題，所有點擊／切換都有動態回饋，
讓操作有科技感，但**不改變任何既有功能、資料、流程與文字內容**。

**三條總原則**

1. **標準主題零差異**：沒選 cyber 時，畫面（淺色、深色）與目前逐像素一致；唯一允許的程式碼層改動是把樣式「接上」主題的掛勾，不改視覺。
2. **動畫不增加等待時間**：任何動畫都不能延後資料出現、不能擋住輸入、不能讓使用者多等一次點擊。動畫中途再點，立刻以新的操作為準。
3. **報表與列印不受影響**：列印報表（`#report-output`）、開新視窗的報表、`@media print` 的輸出，在 cyber 主題下與標準主題完全相同。

**不在範圍內（明確不做）**

| 不做 | 理由 |
|---|---|
| ⌘K 命令選單、新快捷鍵 | 新功能 |
| 音效 | 現場環境不適合，且是新行為 |
| WebGL／three.js／粒子背景 | 手機效能與耗電，不成比例 |
| 長按確認、拖曳刪除等改變操作方式的手勢 | 改變既有操作流程 |
| 把中文標籤改成英文（如「儀表板」→「DASHBOARD」） | 改變文字內容；測試與螢幕閱讀器都依賴現有文字 |
| 顯示不存在的系統狀態（「ONLINE」、CPU、訊號強度等裝飾數據） | 假資訊會誤導使用者；狀態列只能顯示 App 已經知道的事 |

---

## 1. 待確認的決策

實作前需要使用者拍板。每項都附推薦值；未特別回覆即依推薦值實作。
**2026-10-28：使用者未另外指定，D1–D4 全部採用推薦值，開始開發。**

**2026-10-28 P0 設計審查**裁定：(1) 報表 `#report-output` 內以 `cyber.css` 隔離還原四個嚴重度 token（`--good`／`--warning`／`--serious`／`--critical` = 標準淺色值），`report.css` 不改，標準深色既有的漏洞不碰；(2) 開機不閃：`index.html` 用同步 inline script，`theme.ts` 仍是唯一的寫回來源；(3) 列印還原全部色彩 token 與 `--r-*` 並設 `color-scheme: light`，cyber 列印 ≡ 標準淺色列印；(4) 平板圖示列的切換維持現狀（`aria-pressed`＋圖示色＋tooltip）；(5) 「更多」面板切換主題後維持開啟；(6) 套用 `?theme=` 後以 `history.replaceState` 只移除 `theme` 參數，多分頁以 `storage` 事件同步（只 apply、不寫回）；(7) 品牌 logo 的 `text-white` 留到 P1（P1 以 `data-fx` 掛 logo，cyber 下圖示用 `--accent-ink`；P0 不改，以免動到標準深色），平板分隔線與群組 `hr` 一致。另核准：`useThemePreference` 以 DOM 為準、動態 token 共用於 `:root`、`initTheme` 獨立、cyber 暫時蓋過 `light｜dark` 強制指定並在切回標準時還原。

**2026-10-28 P1 設計裁定**：(1) 掃描線改用 `body::after`（不新增 DOM），點陣畫在 cyber 的 `body` `background-image`；(2) 切角面板的切角、底色與框線畫在 `::before`（`clip-path` 在偽元素上），L 形角框畫在 `::after`，**可聚焦的元素本身不加 `clip-path`**，切角斜邊的框線用 45° 漸層補連續；(3) 手機底部中央「新增」圓鈕（`data-fx="fab"`）維持實心，側欄「新增紀錄」照 `primary` 規格（透明底＋青框）；(4) 為 P1 追加的 `data-fx` 掛勾（第 3.3 節表）已隨 `8b675ff` 加入；(5) 裝飾前綴的範圍：`>` 只在桌面側欄（≥ 1024），頁面標題 `~/` 在 ≥ 768 套在 `<h1>`、< 768 套在手機頂欄的標題，**頁面標題的尾端游標延到 P3**，toast 前綴改用 sonner 屬性選擇器；(6) 文字光暈 `--text-glow` 只用在 `kpi-num` 與 ≥ 20px 的 `page-title`（手機頂欄標題 18px，不加）；(7) P1 不寫任何 `@keyframes`／`transition`（FX 全屬 P2／P3）；(8) 焦點環不另寫規則（見第 5.6 節）。

**2026-10-28 P1 設計審查**裁定（PR #41 退回一輪修正，本段為修正後的最終做法）：(1) **分段按鈕選中態改空心終端風**——`accent-wash` 底＋1px `accent` 內框（`box-shadow: inset 0 0 0 1px`，不改尺寸）＋`accent-text` 字，保留 `[ ]`，括號**貼著文字**、與文字固定間距 4px（桌面括號是按鈕的 `::before`／`::after` 排進內容前後，手機是標籤 `<span>` 兩側的絕對定位），選中與未選中時文字位置不跳動；嚴重度色條因此在深底上清楚可辨；(2) 回收桶「永久刪除」按鈕不動 variant，加**純屬性 `data-fx-tone="danger"`**（標準主題 0 差異），cyber 下 critical 字與框、hover 為 `--glow-critical`、絕不出現青框；(3) **按鈕框線一律用 `inset box-shadow`**，hover 光暈與內框合併在同一個 `box-shadow` 宣告，不新增實體 `border`，cyber 與標準的按鈕尺寸（rect 寬高）必須相同；(4) 切角面板的角框在兩個切角處改成**連續的「折角括號」**（兩段直邊線＋中間 45° 斜線）；(5) 平板圖示列（768–1023）目前頁左側加 2px `accent` 內側直條（靜態，不是 `nav-indicator`）；(6) 日曆格 `:focus-visible` 在焦點環外側墊 `--page` 色的外暈，並用 `z-index` 蓋在相鄰格上，使焦點環對相鄰第 3 級格 ≥ 3:1；(7) 掃描線色 `--ink-1` 核准；手機頂欄 18px 標題不加光暈（維持 ≥ 20px 才加）；(8) **色盲不在 P1 處理**（嚴重度本來就有文字標籤，狀態用形狀）；(9) 側欄連結、列表列、趨勢柱的焦點環被 `overflow` 裁掉是標準主題既有狀況，**不在 cyber 範圍**（§9.2 B3 的判定以「cyber 沒有比標準主題更差」為準）；(10) 上面 P1 設計裁定的偏離第 1–7 項已核准；多選選項語意（`role="option"`＋sr-only「（已選）」）不變，`[x]`／`[ ]` 只是 `aria-hidden` 的視覺。

| # | 決策 | 推薦 | 其他選項 |
|---|---|---|---|
| D1 | 切換入口（**這是整份規格唯一新增的介面元素**） | 桌面側欄最底部、平板圖示列最底部、手機「更多」面板最後一列：一顆「介面主題：標準／CYBER」切換按鈕 | (b) 只能用網址 `?theme=cyber` 開啟，不加任何按鈕 |
| D2 | 選擇記在哪裡 | `localStorage`（每台裝置各自記住；讀寫失敗時當作「標準」） | 不記憶，每次重開都回標準 |
| D3 | cyber 與系統淺色／深色的關係 | cyber 永遠是深色，不跟隨系統 | — |
| D4 | 開機畫面（FX-01）出現頻率 | 每個瀏覽器分頁第一次載入出現一次（`sessionStorage`），且只在資料**還在載入**時出現 | 每次載入都出現；完全不做 |

---

## 2. 不可破壞的既有決策（紅線）

以下規則全部來自 `CLAUDE.md` 與 `docs/refactor-plan.md` §2／§4，cyber 主題必須全部遵守：

1. **列印報表畫面不變**：`report.css` 在 `#report-output` 內把語意 token 重新定義成紙本配色，cyber 的 token 不會漏進去；但 cyber 的**元件層樣式與動畫**（第 3.3 節的 `data-fx` 掛勾）**絕不能**加在 `features/report/ReportDocument.tsx` 的任何元素上。
2. **文字對比 ≥ 4.5:1**：`web/src/test/contrast.test.ts` 要擴充成同時檢查 cyber 色票（見第 9 節）。
3. **嚴重度用顏色、處理狀態用形狀**：cyber 的嚴重度維持綠、黃、橘、紅四色；狀態維持 ○ ◐ ●。裝飾用的洋紅色（`accent-2`）**不能**拿來表示任何資料狀態。
4. **手機觸控目標 ≥ 44px、所有可點元素可用鍵盤操作、焦點環可見、面板與對話框鎖焦點且關閉後焦點回到觸發元素**：cyber 的切角（`clip-path`）會把外框裁掉，所以焦點環不能用 `outline` 畫在被裁切的元素上（見第 5.6 節）。
5. **字型自行託管、不連 Google Fonts**：cyber **不新增任何字型檔**，只用現有的 IBM Plex Mono（英數）＋ Noto Sans TC（中文）。
6. **螢幕閱讀器與測試讀到的文字不變**：所有裝飾字元（`>`、`[ ]`、`//`、`ERR:`…）用 CSS 產生並設成不朗讀（第 5.2 節），或加 `aria-hidden`；數字亂碼效果只做在視覺層。
7. **所有 toast 走 `lib/feedback.ts`**：cyber 只改 toast 的樣式，不改 `notify`／`toastUndoable` 的呼叫方式。
8. **元件不寫死色碼、不用行內 style 寫視覺樣式**：cyber 的顏色全部是 token；唯一的例外沿用現狀（長條圖寬度等由資料決定的尺寸）。
9. **`prefers-reduced-motion: reduce` 一律生效**：`index.css` 現有的全域規則保留，cyber 的 JS 動畫也要另外檢查這個設定（第 6.1 節）。
10. **Combobox 按 Enter 不送出表單、換頁後焦點移到主內容**等互動細節：動畫不能改變事件處理順序與焦點目標。

---

## 3. 架構

### 3.1 主題啟用機制

- 主題狀態只放在 `<html data-theme="cyber">` 這一個屬性上。現有的 `data-theme="light|dark"` 強制指定機制保留不動。
- 新增 `web/src/lib/theme.ts`：
  - `getThemePreference(): "standard" | "cyber"`、`setThemePreference(v)`。存取 `localStorage` 的 key 為 `pld.theme`，**每次讀寫都包 try/catch**，失敗時一律回傳 `"standard"`。
  - `applyTheme(v)`：設定或移除 `document.documentElement.dataset.theme`，同時更新 `<meta name="color-scheme">`（cyber 時為 `dark`）。
- `web/src/app/main.tsx` 在 `createRoot` **之前**同步呼叫 `applyTheme(getThemePreference())`，避免先閃一下標準主題。
- 網址 `?theme=cyber`／`?theme=standard`（hash 前的 query）可以覆寫並寫回偏好，方便測試與 D1 選項 (b)。套用後以 `history.replaceState` 把網址的 `theme` 參數移除（保留其他 query 與 `#hash` 路由，不觸發導覽），重新整理或複製網址時不會帶著它。
- **開機不閃**：`web/index.html` 的 `<head>` 有一段同步 inline script，在第一次繪製之前讀 `?theme=` 或 `pld.theme`；是 cyber 時**只**設 `<html data-theme="cyber">` 與 `<meta name="color-scheme">` = `dark`，並把 meta 的原值記在 `<html data-prev-color-scheme>`，供 `applyTheme` 切回標準時還原。寫回偏好、清掉網址參數仍由 `theme.ts` 負責（它仍是唯一的寫回來源）。inline script 的 key、值與屬性名稱要與 `theme.ts` 一致，`theme.test.ts` 會執行那段 script 比對。`main.tsx` 實際呼叫的是 `initTheme()`（決定偏好、套用、註冊 `storage` 監聽）。
- **多分頁同步**：`initTheme()` 監聽 `storage` 事件（`pld.theme` 變動或 `localStorage.clear()`），其他分頁改了偏好時這個分頁跟著套用；只 `applyTheme`、**不寫回**（偏好已被那個分頁寫好）。
- sonner 的 `Toaster` 要傳入目前生效的主題（cyber 時為 `dark`），不然系統淺色時 sonner 自己的預設樣式會是淺色。
- 新增 `useFx()` hook：只有在 `data-theme === "cyber"` **而且**沒有開啟減少動態效果時，才回傳 `true`。所有 JS 動畫（第 6 節標 JS 的項目）都要先檢查它。
  **jsdom 測試環境沒有 `data-theme`，所以 `useFx()` 是 false，P0 之前的 408 個前端測試的行為不變（P0 完成後前端共 503 個，P1 完成後 565 個，均含該期新增的測試）。**

### 3.2 CSS 檔案結構

| 檔案 | 內容 |
|---|---|
| `web/src/styles/index.css` | 新增 `:root[data-theme="cyber"] { … }` token 區塊，放在所有 token 區塊**之後**（第 4 節）；新增動態 token（第 4.4 節） |
| `web/src/styles/cyber.css`（新） | 元件層外觀、keyframes、掃描線圖層。**每條規則都要以 `:root[data-theme="cyber"]` 開頭**；檔尾加 `@media print` 區段，把 cyber 的裝飾全部還原（第 8 節） |
| `web/src/features/report/report.css` | **不改** |

**選擇器優先序的注意事項**：系統深色時，`:root:not([data-theme="light"])`（特異度 0,2,0）也會套用到 `data-theme="cyber"`。
cyber 區塊的特異度相同（0,2,0），**所以必須放在它後面**才會勝出；而且 cyber 區塊要**定義全部 token**，不能依賴繼承，
不然系統淺色時會漏出淺色值。測試會檢查這兩點（第 9.1 節 A2）。

### 3.3 元件掛勾：`data-fx`

cyber.css **不針對 Tailwind class 寫選擇器**（class 會變動，也會誤中報表）。改為在下列元件上加穩定的 `data-fx` 屬性，
**這是 cyber 唯一需要改動元件標記的地方，不改結構、不改事件**（唯一的例外是 `nav-indicator`，見表末）。
`data-fx` 是純屬性：標準主題 0 視覺差異、0 行為差異、可存取名稱不變。

**通則**

- **一個元素只有一個 `data-fx` 值**。`Button` 預設輸出 `data-fx="button"`；表單送出鈕由呼叫端覆寫成 `submit`（`data-variant` 仍在），
  所以按鈕的 CSS 要寫成 `:is([data-fx="button"], [data-fx="submit"])`，再用 `[data-variant="…"]` 分變體。
- 輔助屬性：`data-variant`（Button、破壞性確認對話框）、`data-severity`（`sev`）、`data-state`（`check`）、`data-side`（`sheet`）、`data-fx-alert`（`panel-cut`）、`data-fx-tone`（`button`，目前只有 `danger`）。
- **報表隔離**：`features/report/ReportDocument.tsx` 與 `#report-output` 內（含報表用到的任何元件）**不得出現** `data-fx`／`data-variant`／`data-fx-alert`
  （`ReportDocument` 目前只用 `.rr-sev i[data-sev]` 這種報表自己的屬性）。`ReportPage` 的控制列（`<form>`、日期、按鈕）在 `#report-output` 外，可以有掛勾。
  測試：`ReportDocument.noFx.test.tsx`（A7）與 `test/dataFx.test.tsx`。
- **選中／目前頁狀態用 ARIA**，CSS 直接選：目前頁 `[aria-current="page"]`；分段按鈕選中 `[aria-pressed="true"]`。

| `data-fx` 值 | 掛在哪裡（元素型別）與 DOM 備註 |
|---|---|
| `panel` | `ChartCard`（`<section>`）、次要 KPI 卡（`<div>`）、紀錄列表桌面表格的外框（`<div>`，內含 `<table>`）、回收桶（桌面表格外框 `<div>`；手機每張卡片 `<li>`）、設備對照設定的表單（`<form>`）、日曆外框（`<div>`）、列印報表頁的控制列（`<form>`，`print:hidden`）、儀表板載入骨架的卡片 |
| `panel-cut` | 主要 KPI 卡（待處理、追蹤中）。**可點時是 `<button>`（有 `relative`），0 筆時是 `<div>`（沒有 `relative`，CSS 要自己設 `position: relative`）**，兩者都是同一個值；元素本身沒有 `clip-path`／`overflow`，內容（圖示、數字、提示）是它的子元素，按鈕版另有一個絕對定位的 `ChevronRight`。載入骨架的兩張主要 KPI 也是 `panel-cut`（`<div>`）。切角與框線請畫在 `::before`、L 形角框畫在 `::after`（元素本身 cyber 下底色與框線透明；§5.3、§5.6）。 |
| `data-fx-alert`（屬性，不是 `data-fx` 的值） | 只在「待處理」那張 `panel-cut` 且**數量 > 0** 時輸出（值為空字串，`[data-fx-alert]` 即可選）；沒有警示時整個屬性不存在。追蹤中那張永遠沒有。 |
| `data-fx-tone`（屬性，不是 `data-fx` 的值） | **純屬性，值只有 `danger`**，掛在「以 `secondary` variant 實作的紅字紅框按鈕」上（標準主題靠 `border-critical`／`text-critical` class）：目前只有回收桶（`TrashPage.tsx` `RowActions`，桌面表格與手機卡片共用）每一列的「永久刪除」。cyber 靠它擋掉 secondary hover 的青框、改成 critical 框與 `--glow-critical` 光暈。標準主題 0 視覺差異、0 行為差異；不改 variant。確認對話框的確認鈕本來就是 `destructive` variant，不需要這個屬性。 |
| `nav-item` | 側欄（`Sidebar.tsx`）每個導覽項目：6 個 `<a>` 頁面連結、`匯出 Excel`（`<button>`）、最底部的「CYBER 介面」切換（`<button aria-pressed>`）；手機底部分頁列（`MobileChrome.tsx`）的 4 個分頁 `<a>`（含中央「新增」）與「更多」`<button>`；手機「更多」面板內的每一列（`<a>`／`<button>`，位於 `[data-fx="sheet"]` 內，版型是橫列，和分頁列的直排不同，請用祖先區分）與其中的「CYBER 介面」列。目前頁：`<a>` 有 `aria-current="page"`；「更多」按鈕在子頁（報表、設定、回收桶）時也有。側欄的「新增紀錄」是 `Button`（`button`／`primary`），**不是** `nav-item`。 |
| `nav-group` | 側欄群組小標（`<h2>` 檢視／輸出／管理；< 1024 時 `hidden`） |
| `brand` | 側欄 logo 方塊（`<span>`，內含 Factory 圖示，`text-white` 沒動；cyber 下圖示色由 CSS 處理）。手機頂欄沒有 logo，所以只有這一處 |
| `fab` | 手機底部中央「新增」圓鈕（`<span>`，在 `nav-item` 的 `<a>` 裡，絕對定位凸出）。維持實心樣式（§5.4） |
| `topbar` | 手機頂欄（`<header>`，`< 768` 才顯示） |
| `nav-indicator` | **延到 P3 與 FX-04 一起做，P1 不加**（會新增一個 `aria-hidden` 的高亮條元素，是這個表唯一會動到 DOM 結構的項目） |
| `bar-row` / `bar` | `charts.tsx` `HBarChart`：每一列整個按鈕（`<button>`，`bar-row`）與長條的填色（`<span aria-hidden>`，`bar`；寬度是行內 style，FX-09 的 `scaleX` 作用在它上面，它在一個 `overflow-hidden` 的軌道裡）。處理狀態堆疊條與甜甜圈不是 `bar` |
| `trend-col` / `trend-bar` | 每日趨勢：`trend-col` 是整個柱子按鈕（`<button>`，含數量、柱、日期），`trend-bar` 是裡面的柱（`<span aria-hidden>`，高度是行內 style，FX-12 的 `scaleY` 作用在它上面） |
| `cal-cell` | 日曆格子：有紀錄的是 `<button>`（另帶 `data-step`、`data-date`），沒有紀錄的是 `<div>`；補位的空格（`<td aria-hidden>`）不是 |
| `row` | 紀錄列表的每一列：桌面是 `<tr tabindex="0">`，手機卡片是 `<button>`（卡片內有 `sev`） |
| `page-title` | `PageHeader.tsx` 的 `<h1>`（**< 768 時是 `sr-only`**，視覺上看不到）與手機頂欄的標題（`<p aria-hidden>`，< 768 才是視覺標題） |
| `kpi-num` | KPI 數字（`<span class="num">`）：主要 KPI 與次要 KPI 共 6 個 |
| `field` | 表單欄位外層：`fields.tsx` 的 `Field`（`<div data-field="…">`，含 label、輸入元件、提示、錯誤）；設備對照設定頁自己的 `Field`（`<label>`） |
| `combobox` | `Combobox.tsx` 的外層（`<div class="relative">`，含 `<input role="combobox">` 與展開的清單）。它在 `field` 裡面，所以**用不同的值**，避免巢狀的 `field` 重複套用 |
| `error-msg` | 錯誤訊息**文字本身**（`ERR:` 前綴用）：`fields.tsx` `FieldError` 裡的 `<span>`（外層 `<p role="alert">` 另含圖示，**不**掛）、設備對照設定儲存失敗標題 `<p>`（容器 `role="alert"` 不掛）、日期篩選「起日晚於迄日」`<p role="status">`、照片上傳失敗的狀態文字 `<p>`（只有失敗時才有）。`ErrorState` 內的訊息不算（它整塊是 `error`） |
| `check` | `MultiSelectFilter.tsx` 每個選項的勾選方塊視覺：`<span aria-hidden="true" data-fx="check" data-state="on｜off">`（16px 方塊），在 `cmdk` 的 `div[role="option"]` 裡；選中時內含一個 lucide `Check` 的 `<svg>`（CSS 要隱藏它再畫 `[x]`／`[ ]`）。**這裡沒有原生 checkbox**（是 `role="option"` 的清單項目，已選時另有 `sr-only` 的「（已選）」），所以不存在 `:checked`；狀態用 `data-state`（也可從父層 `[data-checked="true｜false"]` 接）。`DateRangeFilter` 沒有勾選視覺 |
| `submit` | 表單送出按鈕（`Button type="submit"`，覆寫掉 `button`，`data-variant="primary"` 仍在）：新增／編輯紀錄、設備對照設定的「儲存對照表」、列印報表頁的「產生報表」。**匯出 Excel 只存在於導覽（側欄與「更多」面板），它是 `nav-item`，不是 `submit`**。 |
| `button` | `ui/button.tsx` 的 `Button`（所有按鈕，含 `asChild` 的 `<a>`）以及 `ui/alert-dialog.tsx` 的 `AlertDialogAction`／`AlertDialogCancel`。永遠搭配 `data-variant="primary｜secondary｜ghost｜destructive｜link"`（沒傳 variant 時是 `secondary`；確認對話框的確認鈕預設 `primary`、取消鈕 `secondary`）。呼叫端自己傳的 `data-fx` 優先 |
| `seg` | `SegmentedControl.tsx` 的容器（`<div role="group" aria-label>`）；底下直接子元素是 `<button aria-pressed>`，**選中項 `[aria-pressed="true"]`**（沒有另外加屬性）。用在儀表板範圍、列表的狀態與嚴重度篩選、表單的嚴重度與處理狀態 |
| `sev` | 嚴重度色塊（都是 `aria-hidden`，並帶 `data-severity="輕微｜一般｜嚴重｜重大"`，光暈顏色靠它）：`SeverityBadge` 裡的色條（`<span>`；外層膠囊本身**不是** `sev`）、手機卡片左側色條、甜甜圈的弧（`<circle>`，SVG）與圖例色塊、篩選列與表單裡嚴重度選項前的色塊。**報表（`ReportDocument`）不算，不碰** |
| `sheet` | `ui/sheet.tsx` 的 `SheetContent`（詳情面板、手機「更多」面板、窄螢幕的 `ResponsivePopover`）。另帶 `data-side="right｜bottom｜left"` |
| `dialog` | `ui/alert-dialog.tsx` 的 `AlertDialogContent`（確認對話框）。破壞性的（永久刪除）另帶 `data-variant="destructive"`，一般的沒有這個屬性 |
| `pop` | `ui/popover.tsx` 的 `PopoverContent`（多選下拉、日期篩選、桌面 `ResponsivePopover`；有 Radix 的 `data-state`、`data-side`）以及 `Combobox` 展開的建議清單（`<ul role="listbox">`，**沒有** `data-state`）。`cmdk` 的 `Command` 清單在 `pop` 或 `sheet` 裡面，不另外掛 |
| `tooltip` | `ui/tooltip.tsx` 的 `TooltipContent`（Radix，有 `data-state`、`data-side`） |
| `toast` | **sonner 不支援在 toast 元素上加自訂屬性**（`toastOptions.classNames` 只能加 class；`data-testid` 要由發 toast 的地方傳，而 `lib/feedback.ts` 不動），所以**沒有 `data-fx="toast"`**，穩定選擇器是 sonner 自己輸出的：容器 `[data-sonner-toaster]`（有 `data-sonner-theme="light｜dark"`）、每個 toast `[data-sonner-toast]`（`<li>`），類型 `[data-sonner-toast][data-type="success｜error｜info｜warning｜loading"]`（`notify.success`／`toastUndoable` → `success`，`notify.error` → `error`；未指定類型的 `toast()` 沒有 `data-type`，目前沒人用）。內部：圖示 `[data-icon]`、內容 `[data-content]`、標題 `[data-title]`、說明 `[data-description]`、動作鈕 `[data-button]`、關閉鈕 `[data-close-button]`。錯誤 toast 的文字外面包一層 `<span role="alert">`（在 `[data-title]` 裡）。`test/dataFx.test.tsx` 會檢查這些選擇器，sonner 升級後若改了會變紅 |
| `skeleton` | `ui/skeleton.tsx`（`<div aria-hidden>`） |
| `error` | `ErrorState.tsx`（`<div role="alert">`，內含標題、訊息與「重試」`Button`） |

**刻意沒有掛勾**（P2／P3 需要時再加，加之前先改這張表）：`Lightbox`、處理狀態堆疊條與甜甜圈的非嚴重度部分、篩選 chip（FX-17）、設備對照設定的「未儲存」提示（FX-35）、`CopyPicker` 與 `PhotoThumb`／`PhotoField` 的縮圖（FX-26／27）、匯出項目的進行中標記（FX-32，目前只有 `aria-busy`）、日期篩選的快捷 pill（用 `aria-pressed`）、紀錄詳情面板內部（面板本身是 `sheet`）。

### 3.4 圓角改成執行期 token（標準主題零視覺差異）

目前 `@theme inline` 會把 `--radius-sm/md/lg` 在建置時直接寫進 utility（`rounded-md` → `border-radius: 10px`），
cyber 沒辦法在執行期改。做法：

- `:root` 新增 `--r-sm: 6px; --r-md: 10px; --r-lg: 14px;`，`@theme inline` 改成 `--radius-sm: var(--r-sm)` 等。
- cyber 區塊設 `--r-sm: 2px; --r-md: 2px; --r-lg: 2px;`；`--radius-full` 不動（徽章、手機中央新增鈕維持圓形）。
- 驗收：標準主題的計算後樣式比對必須 0 差異（第 9.3 節）。

### 3.5 FX 小工具（`web/src/lib/fx/`）

只寫三個，不引入動畫套件：

| 工具 | 用途 | 無障礙做法 |
|---|---|---|
| `useFx()` | 判斷是否要播 JS 動畫（第 3.1 節） | — |
| `<ScrambleNumber value>` | 數字先亂跳再鎖定成真實值（FX-07） | 真實數字放在 `sr-only` 的 span；亂跳的那份是 `aria-hidden`，**動畫結束就移除**，之後 DOM 裡只剩一份數字（避免 `getByText` 找到兩個） |
| `useStagger(count, cap)` | 列表、長條的依序進場延遲，最多套用前 `cap` 項 | 純視覺，不影響 DOM 順序 |

頁面切換用瀏覽器原生的 View Transitions API（React Router 7 的 `viewTransition` 選項），**只在 `useFx()` 為 true 時開啟**；
不支援的瀏覽器直接跳過，不加 polyfill。

---

## 4. Token 規格

### 4.1 色彩（`:root[data-theme="cyber"]`）

對比值是在三種底色（`page` / `surface` / `surface-raised`）上算的最低值，計算方式與 `contrast.test.ts` 相同。

| Token | 標準深色（現值） | Cyber | 用途 | 對比（最低） |
|---|---|---|---|---|
| `--page` | `#0d0d0d` | `#070b11` | 頁面底色（近黑偏藍） | — |
| `--surface` | `#1a1a19` | `#0c131c` | 次要區塊 | — |
| `--surface-raised` | `#212120` | `#111a25` | 卡片、面板 | — |
| `--ink-1` | `#ffffff` | `#e6f1fa` | 主要文字（冷白，避免純白刺眼） | 15.29 |
| `--ink-2` | `#c3c2b7` | `#b4c6d6` | 次要文字 | 10.01 |
| `--ink-muted` | `#9b9a93` | `#8ba1b5` | 輔助說明 | 6.56 |
| `--line` | `#2c2c2a` | `#1d2b3a` | 細線 | — |
| `--line-strong` | `#383835` | `#2c4054` | 強調線、輸入框框線 | — |
| `--accent` | `#3987e5` | `#22e6ff` | 主要強調（霓虹青） | — |
| `--accent-ink` | `#0b0b0b` | `#04121a` | 青色底上的文字 | 12.50（在 accent 上） |
| `--accent-text` | `#5598e7` | `#22e6ff` | 當文字用的強調色 | 11.54；在 accent-wash 上 10.41 |
| `--accent-wash` | `#132538` | `#08262f` | 選取、hover 底 | — |
| `--accent-2` | `#d95926` | `#ff3fd2` | **純裝飾**（品牌字、鎖定角框、HUD 點綴），不可表示資料狀態 | 5.75 |
| `--good` | `#0ca30c` | `#3ddc84` | 嚴重度：輕微 | 9.82 |
| `--warning` | `#fab219` | `#ffd23f` | 嚴重度：一般 | 12.14 |
| `--serious` | `#ec835a` | `#ff8a3d` | 嚴重度：嚴重 | 7.47 |
| `--serious-wash` | `#332018` | `#2a1608` | 「請確認」提示底 | ink-1 在上 15.06 |
| `--critical` | `#e66767` | `#ff4d64` | 嚴重度：重大、錯誤 | 5.42 |
| `--critical-ink` | `#0b0b0b` | `#12040a` | 紅色底上的文字 | 6.20（在 critical 上） |
| `--ring` | `rgba(255,255,255,.12)` | `rgba(34,230,255,.25)` | 細環 | — |
| `--overlay` | `rgba(0,0,0,.6)` | `rgba(2,6,10,.72)` | 對話框遮罩 | — |
| `--shadow` | 深色陰影 | `0 0 0 1px rgba(34,230,255,.18), 0 16px 40px -16px rgba(0,0,0,.85)` | 浮層：細青框＋深陰影 | — |
| `--seq-100` | `#132538` | `#0a1f29` | 日曆／熱度色階 | — |
| `--seq-200` | `#16324f` | `#0c3340` | | — |
| `--seq-300` | `#1c4576` | `#0f4d5e` | 日曆第 1 級（文字 ink-1） | 8.17 |
| `--seq-400` | `#2a78d6` | `#138299` | | — |
| `--seq-450` | `#3987e5` | `#17a9c4` | | — |
| `--seq-500` | `#5598e7` | `#1cc8e6` | 日曆第 2 級（文字 accent-ink） | 9.45 |
| `--seq-600` | `#86b6ef` | `#6fe3f5` | | — |
| `--seq-700` | `#b7d3f6` | `#b8f3fb` | 日曆第 3 級（文字 accent-ink） | 15.59 |

**紅色與洋紅色的區隔**：`critical`（色相約 352°）與 `accent-2`（約 313°）亮度接近（0.275 vs 0.295），
所以只靠顏色不夠——規則是 **critical 一定搭配文字或形狀**（「重大」字樣、色條、`ERR:` 前綴），
`accent-2` **只出現在純裝飾元素**（細線、角框、品牌字），兩者不會出現在同一種元件上。

### 4.2 Cyber 專用 token（只在 cyber 區塊定義）

| Token | 值 | 用途 |
|---|---|---|
| `--glow-accent` | `0 0 0 1px rgba(34,230,255,.55), 0 0 12px rgba(34,230,255,.35)` | hover／選取時的外框光暈 |
| `--glow-critical` | `0 0 0 1px rgba(255,77,100,.6), 0 0 12px rgba(255,77,100,.35)` | 錯誤欄位、永久刪除 |
| `--text-glow` | `0 0 6px rgba(34,230,255,.45)` | **只用在 ≥ 20px 的數字與頁面標題**（實作：`kpi-num` 與 ≥ 768 的 `<h1 data-fx="page-title">`），內文不加；手機頂欄標題 18px，不加 |
| `--scan-opacity` | `0.025` | 掃描線圖層透明度（手機 0.015） |
| `--grid-dot` | `rgba(34,230,255,.06)` | 頁面背景點陣 |
| `--cut-sm` / `--cut-md` | `8px` / `12px` | 切角大小 |
| `--r-sm` / `--r-md` / `--r-lg` | `2px` | 見第 3.4 節 |

### 4.3 字體

| 項目 | 標準 | Cyber |
|---|---|---|
| 內文 `body` | Noto Sans TC 15px／1.6 | `"IBM Plex Mono", "Noto Sans TC", …`：英數字是等寬字、中文回落到 Noto Sans TC；字級與行高不變 |
| 數字 `.num` | IBM Plex Mono＋tabular-nums | 不變 |
| 頁面標題 | Noto Sans TC 700 | 不變字重；前面加 `~/` 前綴（第 5.2 節） |
| 群組小標 | — | 前面加 `// ` 前綴，`ink-muted` |
| 字距 | — | 英文大寫標籤（若有）`letter-spacing: .06em`；中文不加字距 |

**不新增字型檔**，也不加 IBM Plex Mono 的其他字重（目前已有 400／500／600）。

### 4.4 動態 token（定義在 `:root`，所有主題共用；標準主題不引用）

| Token | 值 | 用途 |
|---|---|---|
| `--dur-instant` | `80ms` | 按壓回饋 |
| `--dur-fast` | `150ms` | hover、選取、括號滑動 |
| `--dur-base` | `220ms` | 面板、彈出選單、頁面切換 |
| `--dur-slow` | `400ms` | 數字鎖定、長條長出 |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | 一般進場 |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | 退場 |
| `--ease-glitch` | `steps(4, end)` | glitch、打字式顯示 |
| `--stagger` | `40ms` | 依序進場的間隔 |

---

## 5. 視覺語言

### 5.1 背景與圖層

- **頁面**：`--page` 加上 24px 間距的點陣（`radial-gradient`，顏色 `--grid-dot`），畫在 cyber 的 `body` `background-image`，**靜態不動**。
- **掃描線**：用 `:root[data-theme="cyber"] body::after` 偽元素，**不新增 DOM 元素**。`position: fixed; inset: 0; pointer-events: none; content: "" / ""`，
  `z-index` 高於所有浮層（對話框、tooltip 之上，也要高於 sonner 容器的 `z-index: 999999999`，所以取 `2147483647`），`background: repeating-linear-gradient(…)` 水平細線，透明度 `--scan-opacity`。
  **靜態不動**（不做捲動或閃爍）。手機（< 768）`--scan-opacity: .015`（在 `cyber.css` 內以 media query 覆寫 token）。線條色用 `--ink-1`（`repeating-linear-gradient(to bottom, ink-1 0 1px, transparent 1px 3px)`，透明度 `--scan-opacity`）。列印時隱藏（第 8 節）。
- **不做**：毛玻璃（`backdrop-filter`）、常駐的雜訊動畫、CRT 彎曲變形。

### 5.2 裝飾字元（一律不朗讀）

用 CSS `content` 的替代文字語法讓螢幕閱讀器不唸：`content: "> " / "";`。

| 位置 | 裝飾 |
|---|---|
| 側欄目前頁面 | 前綴 `>`，青色；**只在桌面側欄（≥ 1024）**。實作：`::before` 絕對定位在項目左側的內距裡，不佔版面，所以其他項目不必保留空白、文字也不會跳動；平板圖示列（文字 sr-only）與手機不加 |
| 群組小標（檢視／輸出／管理） | `// 檢視` |
| 頁面標題 | 前綴 `~/`（`ink-muted`）。PageHeader 的 `<h1>` 在 < 768 是 sr-only，視覺標題是手機頂欄的 `<p aria-hidden>`，所以 `h1[data-fx="page-title"]` 的前綴只在 ≥ 768、`p[data-fx="page-title"]` 的前綴全寬度套用。**尾端閃爍游標延到 P3**（`aria-hidden` 元素，1s `steps(1)` 閃爍） |
| 分段按鈕 | 選中的項目文字兩側 `[ ]`，**貼著文字、與文字固定間距 4px**（不貼按鈕兩端，手機也一樣），選中態另改成空心終端風（見下）。桌面（≥ 768，按鈕是橫排的「標籤＋筆數」）：括號是按鈕自己的 `::before`／`::after`，當作 flex 子項目排進內容前後（flex gap 6px，用 `-2px` margin 修成 4px），包住標籤與筆數；**所有**分段按鈕都有括號，未選中的用 `visibility: hidden` 佔位，所以選中與否文字位置不跳動、按鈕寬度一致。手機（< 768，按鈕直排，欄寬由 `auto-cols-fr` 等分）：括號絕對定位在標籤 `<span>`（第一個子元素）兩側，不佔版面、不改欄寬，括號 10px，按鈕最小寬度放大到 52px 才容得下括號。**選中態**：`accent-wash` 底＋1px `accent` 內框（`box-shadow: inset 0 0 0 1px var(--accent)`，不改尺寸）＋`accent-text` 字，嚴重度色條在深底上才清楚分辨 |
| 多選下拉的勾選 | 視覺上畫成 `[x]`／`[ ]`（隱藏方塊底、框與 `Check` 圖示；兩種狀態同寬 22px，選項不跳動）；語意（`role="option"`＋sr-only「（已選）」）不變，`[x]`／`[ ]` 只是 `aria-hidden` 的視覺 |
| 錯誤訊息 | 前綴 `ERR:`（critical 色） |
| 成功 toast | 前綴 `[OK]`；錯誤 toast 前綴 `[ERR]`。用 sonner 屬性選擇器（`[data-sonner-toast][data-type="success｜error"] [data-title]::before`，同樣要以 `:root[data-theme="cyber"]` 開頭）。toast 外觀 cyber 化：因 `Toaster` 在 cyber 傳 `theme="dark"`，sonner 深色主題會把底色變純黑，所以 cyber.css 把 `--normal-bg／--normal-border／--normal-text` 改回 token（surface-raised／line-strong／ink-1），錯誤 toast 框用 `critical`，圓角 2px |

**不加裝飾**：表格內容、紀錄文字、表單 label、按鈕文字本身。

### 5.3 面板

- `data-fx="panel"`：`surface-raised` 底、1px `line` 框、2px 圓角；hover 不變（面板本身不可點）。
- `data-fx="panel-cut"`（待處理／追蹤中 KPI 卡，可能是可聚焦的 `<button>`，0 筆時是 `<div>`）：右上與左下切角（大小 `--cut-md`，手機 `--cut-sm`），四角各有角框，顏色 `line-strong`：左上與右下兩個直角是 10px 的 L 形，**兩個切角（右上、左下）是連續的「折角括號」**——沿兩條直邊各一段 10px 的線，加上中間沿 45° 切角的 2px 斜線，三段相連成一個完整的角標（不是斷開的兩截）；
  **「待處理」大於 0 時**（`[data-fx-alert]`），角框改成 `serious` 色（P1 靜態；呼吸效果是 P3 的 FX-08）。
- **實作（P1 設計裁定）**：**元素本身不加 `clip-path`**，cyber 下底色與框線透明，並設 `position: relative; isolation: isolate`（0 筆的 `<div>` 沒有 Tailwind 的 `relative`）；
  切角的底色與 1px 框線畫在 `::before`（`inset: -1px; z-index: -1`；`clip-path: polygon(…)` 在偽元素上；框線用 `box-shadow: inset 0 0 0 1px var(--pc-line)`；切角斜邊的框線用兩條 45° 的 `linear-gradient(to top right, …)` 補連續）；
  角框用 `::after` 的 10 條 `linear-gradient` 畫（每角兩條 10px × 2px 的直線，加上兩個切角各一條 `to top right` 的 2px 斜線，斜線貼在切角邊的內側，與 `::before` 的 1px 斜邊框線重疊）；`::after` 本身不加 `clip-path`；不新增 DOM。hover（可點的按鈕）：框線變 `accent`。局部變數 `--pc-cut／--pc-fill／--pc-line／--pc-corner` 都定義在元素自己身上。

### 5.4 按鈕

| 變體 | Cyber 外觀 |
|---|---|
| `primary` | 透明底、1px `accent` 框（`box-shadow: inset 0 0 0 1px`）、`accent-text` 字；hover 時 `accent-wash` 底＋與內框合併在同一個 `box-shadow` 宣告的 `--glow-accent`；**對比仍以 accent-text 在 page／surface-raised 上計算（≥ 11.5）** |
| `secondary` | `surface-raised` 底、`line-strong` 框；hover 時框線變 `accent` |
| `ghost` | 不變，hover 時文字 `accent-text` |
| `destructive` | 透明底、`critical` 框（`inset box-shadow`）與字；hover 時內框＋`--glow-critical`（同一個 `box-shadow` 宣告） |
| `data-fx-tone="danger"`（secondary variant 的紅字紅框按鈕） | `critical` 字；實體 1px `border` 本來就是 `critical` 色（標準主題的 `border-critical`），框線沿用不另加內框（否則變 2px）；任何狀態框都維持 `critical`（擋掉 secondary hover 的青框）；hover 時 `--glow-critical` |
| `link` | 不變 |

觸控尺寸、`disabled` 樣式不變（hover 的光暈與框線變化只作用在 `:not(:disabled)`）。

**例外與補充**：手機底部中央「新增」圓鈕（`data-fx="fab"`）**維持實心**（`accent` 底、`accent-ink` 圖示，不在 cyber.css 裡處理）；側欄的「新增紀錄」是 `Button` `primary`，照 `primary` 規格（透明底＋青框）。**框線一律用 `inset box-shadow`，不新增實體 `border`**：`primary`／`destructive` 在標準主題沒有 `border`，加實體框會讓自動寬度的按鈕多出 2px；用內側陰影則 cyber 與標準的按鈕 rect（寬高）完全相同（驗收：逐頁比對所有按鈕的 rect；唯一的差異來自 cyber 內文字型是等寬字，含英文字母的按鈕文字如「列印／另存 PDF」寬度略有不同，與框線無關）。`secondary` 維持標準的 `border`，只改色。表單送出鈕（`data-fx="submit"`、`data-variant` 仍在）與 `AlertDialogAction／Cancel` 都涵蓋。

### 5.5 嚴重度與狀態

- 嚴重度色條（`[data-fx="sev"]`：`SeverityBadge` 的色條、手機卡片左側色條、圖例與篩選／表單選項前的色塊）加 4px 同色光暈（`box-shadow: 0 0 4px color-mix(in srgb, <嚴重度 token> 50%, transparent)`）。只有「重大」的光暈稍強（70%）。顏色依 `data-severity="輕微｜一般｜嚴重｜重大"` 對應 `good／warning／serious／critical`。**手機（< 768）光暈減半**：半徑 2px、透明度 ×.5（25%；重大 35%）。甜甜圈的弧是 SVG `<circle data-fx="sev">`，`box-shadow` 對 SVG 無效，改用 `filter: drop-shadow(0 0 <半徑> <同色>)`。
- 狀態符號 ○ ◐ ● 不變，顏色 `ink-2`。**不加任何顏色**，維持「狀態用形狀」。

### 5.6 焦點環

- 一般元素：`outline: 2px solid var(--accent-text); outline-offset: 2px`（與現行相同，只是顏色變青色）。**實作**：`index.css` base 層的 `:focus-visible` 已是這個值，cyber 的 token 讓它自動變青色（`#22e6ff`），所以 `cyber.css` **不另寫** `:focus-visible` 規則——`cyber.css` 沒放進 `@layer`，多寫一條會蓋掉元件自己的 `outline-hidden`（對話框、面板、彈出選單的容器）與 `focus-visible:outline-offset-0`（輸入框），把不該出現的外框叫回來。唯一的例外：手機底部分頁列貼著螢幕下緣，外環有一邊會落在螢幕外，cyber 下改成內縮（`outline-offset: -2px`）。另一個例外是日曆格（`cal-cell`）：格子彼此相鄰，環落在相鄰的第 3 級（`seq-700` 淺青）格上對比只有約 1.2:1，所以 cyber 下 `:focus-visible` 時外側墊一圈 `--page` 色（`box-shadow: 0 0 0 6px var(--page)`，環外緣在 4px 所以取 6px）並 `position: relative; z-index: 1` 讓它蓋在相鄰格上；環本身仍是 base 層的規則。
- 有切角（`clip-path`）的元素：outline 會被裁掉，改為在**外層包裝元素**上用 `:focus-within` 畫焦點框，或不在可聚焦元素本身加 `clip-path`。
  **規則：可聚焦的元素本身不加 `clip-path`。**

---

## 6. 動畫清單

### 6.1 共通規則

1. **只動 `transform`、`opacity`、`clip-path`**（外加光暈 `box-shadow` 的淡入淡出）。不動 `width`、`height`、`top/left`——例外：長條圖寬度只在進場時用 `transform: scaleX()` 做，不改 `width`。
2. **不擋輸入**：動畫期間元素一律可點；中途再點，取消目前動畫、以新操作為準。
3. **閃爍上限**：任何閃爍或 glitch 每秒不超過 3 次，而且只播一次（游標閃爍是每秒 1 次，例外允許常駐）。
4. **依序進場最多 20 項**：超過的直接出現，不排隊。
5. **減少動態效果**：CSS 由 `index.css` 現有的全域規則處理；JS 動畫（`ScrambleNumber`、`useStagger`、View Transitions）在 `useFx()` 為 false 時直接顯示最終狀態。
6. **測試環境**：jsdom 中 `useFx()` 為 false，所有測試看到的都是最終狀態。

### 6.2 清單

「做法」欄：CSS＝只靠 cyber.css；JS＝需要 `lib/fx/`；VT＝View Transitions。

| ID | 元件（檔案） | 觸發 | 效果 | 時間／曲線 | 做法 |
|---|---|---|---|---|---|
| FX-01 | 開機畫面（`AppShell.tsx` 的載入狀態） | 第一次載入、儀表板資料**還在載入時** | 取代骨架：逐行印出**真實的**載入步驟（「讀取紀錄…」→ 收到後顯示「N 筆」）。資料到了就立刻結束、換成內容；按任意鍵或點擊可跳過 | 每行 120ms；**不會延長載入時間** | JS |
| FX-02 | 換頁（全部路由） | 點導覽連結、`drill.ts` 帶篩選跳轉 | 舊頁：水平切片 glitch 淡出；新頁：由上而下的掃描線劃過後出現 | 退 120ms＋進 220ms，`--ease-glitch`／`--ease-out` | VT |
| FX-03 | 頁面標題（`PageHeader.tsx`、手機頂欄） | 換頁 | 打字式顯示：`clip-path: inset(0 100% 0 0)` → `inset(0)`，用 steps 分段；文字從一開始就完整存在於 DOM | 字數 × 18ms，上限 300ms | CSS |
| FX-04 | 側欄／圖示列（`Sidebar.tsx`） | 換頁 | `nav-indicator` 高亮條從舊位置滑到新位置；`>` 前綴淡入 | 220ms `--ease-out` | CSS（位置用 CSS 變數，由目前路由決定） |
| FX-05 | 導覽項目 hover | 滑鼠移入 | 文字變 `ink-1`，左側 2px 青線由上往下長出 | 150ms | CSS |
| FX-06 | 手機底部分頁列（`MobileChrome.tsx`） | 點分頁 | 選中的圖示上方出現 2px 青線（由中間向兩側展開）；中央「新增」圓鈕按下時外圈擴散一圈青色細環 | 150ms／300ms | CSS |
| FX-07 | KPI 數字（`KpiCards.tsx`） | 資料載入完成、切換範圍（全部／本月／本週） | 數字亂跳 6～8 次後鎖定成真實值 | 400ms | JS（`ScrambleNumber`） |
| FX-08 | 主要 KPI 卡（待處理） | 待處理 > 0 時持續 | HUD 角框以 `serious` 色緩慢呼吸（透明度 .5 ↔ 1） | 2.4s 一循環；**不是閃爍** | CSS |
| FX-09 | 橫條圖（`charts.tsx` `HBarChart`） | 進場、切換範圍 | 長條由左往右長出（`scaleX` 0→1），每條依序 | 400ms＋`--stagger` | CSS＋JS（延遲） |
| FX-10 | 長條列 hover／焦點 | 滑鼠、Tab | 整列 `accent-wash` 底，長條加 `--glow-accent` | 150ms | CSS |
| FX-11 | 長條列點擊（帶篩選跳到列表） | 點擊、Enter／Space | 四角出現洋紅 L 形角框，由大縮小「鎖定」，**同時**照原本的流程立即跳轉（FX-02 接手）；不延後跳轉。角框主要會出現在 FX-02 舊頁面的退場畫面裡；不支援 View Transitions 的瀏覽器看不到角框，這是可以接受的 | 角框 200ms | CSS（`:active` 與跳轉同步，不加 `setTimeout`） |
| FX-12 | 每日趨勢柱 | 進場 | 由下往上長出（`scaleY`），依序 | 300ms＋20ms 間隔 | CSS＋JS |
| FX-13 | 圓餅／其他非長條圖 | 進場 | 整張淡入＋掃描線劃過一次 | 300ms | CSS |
| FX-14 | 日曆格（`CalendarPage.tsx`） | 進場、換月 | 格子沿對角線依序淡入（左上→右下）；換月時整張先水平 glitch 一次 | 每格 10ms，總長上限 400ms | CSS＋JS |
| FX-15 | 日曆格 hover／焦點 | 滑鼠、Tab | 格子加 `--glow-accent` 外框 | 150ms | CSS |
| FX-16 | 紀錄列表列（`RecordList.tsx`） | 進場、篩選結果變化 | 前 20 列依序由左 8px 淡入；hover 時左側出現 `▶`（`aria-hidden`），整列 `accent-wash` | 150ms＋`--stagger` | CSS＋JS |
| FX-17 | 篩選 chip（`FilterBar.tsx`） | 新增、移除 | 新增：由左展開；移除：向左收起後消失 | 150ms | CSS |
| FX-18 | 多選下拉、日期篩選（`MultiSelectFilter.tsx`、`DateRangeFilter.tsx`、`ui/popover.tsx`） | 開、關 | 從觸發按鈕的位置用 `clip-path` 由上往下展開；關閉反向 | 開 150ms／關 100ms | CSS（Radix `data-state`） |
| FX-19 | 分段按鈕（`SegmentedControl.tsx`） | 選取 | `[ ]` 括號滑到新選項 | 150ms | CSS（位置用 CSS 變數） |
| FX-20 | 詳情面板（`RecordDetailSheet.tsx`、`ui/sheet.tsx`） | 開、關 | 由右滑入（現有），加上框線一道青色掃描由上往下；內容區塊依序淡入（標題→標籤→事實格→處理→照片） | 220ms＋30ms 間隔，最多 6 段 | CSS |
| FX-21 | 詳情面板上一筆／下一筆 | 點擊 | 內容水平 glitch 切換（往前→向右、往後→向左） | 180ms | CSS（以 record id 當 key 重播） |
| FX-22 | 確認對話框（`ConfirmDialog.tsx`、`ui/alert-dialog.tsx`） | 開啟 | 遮罩淡入；對話框 glitch 進場一次；**永久刪除**的對話框加 `critical` 斜紋上緣與 `--glow-critical` | 200ms | CSS |
| FX-23 | 表單輸入框（`fields.tsx`、`Combobox.tsx`） | 聚焦 | 框線變 `accent`＋`--glow-accent`；左側 `>` 提示符亮起 | 150ms | CSS |
| FX-24 | 表單驗證錯誤 | 送出失敗、欄位驗證失敗 | 欄位水平抖動一次（±4px，3 下）＋`--glow-critical`；錯誤訊息加 `ERR:` 前綴並打字式顯示 | 抖 240ms／字 200ms | CSS |
| FX-25 | 送出按鈕（`RecordForm.tsx`） | 送出中（現有的進行中狀態） | 按鈕文字左側加一條 ASCII 進度條 `[████░░]` 循環跑動（**進度不明，所以是循環動畫，不假裝百分比**）；按鈕原本的文字與 disabled 狀態不變 | 循環 900ms | CSS |
| FX-26 | 照片上傳（`PhotoField.tsx`、`PhotoThumb.tsx`） | 上傳中 | 縮圖上覆蓋一條來回跑的掃描帶，取代旋轉圖示的視覺（旋轉圖示的無障礙文字保留） | 循環 1.2s | CSS |
| FX-27 | 「從過去紀錄帶入」（`CopyPicker.tsx`） | 選定、帶入 | 被帶入的欄位依序閃一次 `accent-wash` 底（標示「這些欄位被填了」） | 每欄 200ms，間隔 40ms | CSS＋JS |
| FX-28 | 嚴重度自動建議 | 打耗時後建議值變化 | 建議的嚴重度選項外框閃一次對應色光暈 | 300ms，一次 | CSS |
| FX-29 | Toast（`ui/sonner.tsx`、`lib/feedback.ts` 不動） | 出現 | 由右滑入＋左側 3px 狀態色條；標題打字式顯示（`clip-path`，文字一開始就在 DOM）；錯誤 toast 紅色框閃一次 | 滑入 200ms、打字 ≤ 300ms | CSS |
| FX-30 | 可復原 toast 的〔復原〕 | 按下 | 按鈕 `accent` 底閃一次後 toast 照原流程消失 | 120ms | CSS |
| FX-31 | 回收桶（`TrashPage.tsx`） | 復原、永久刪除成功後 | 該列「溶解」：`clip-path` 由上下往中間收起＋淡出（復原與刪除方向相反） | 250ms | CSS（列表移除前的退場動畫；**不延後 API 呼叫**） |
| FX-32 | 匯出 Excel（`useExportAction.ts` 的進行中狀態） | 匯出中 | 側欄／更多面板的匯出項目文字旁顯示循環的 `▮▯▯`→`▮▮▯`→`▮▮▮` | 循環 900ms | CSS |
| FX-33 | 骨架載入（`ui/skeleton.tsx`） | 載入中 | 灰塊改成 `line` 色的 `▒` 紋理，左到右掃光循環 | 1.6s 循環（與現行同頻率） | CSS |
| FX-34 | 錯誤狀態（`ErrorState.tsx`） | 載入失敗 | 標題 glitch 一次；重試按鈕照原樣 | 280ms，一次 | CSS |
| FX-35 | 設備對照設定（`SettingsPage.tsx`） | 有未儲存變更 | 「未儲存」提示左側 `serious` 色條緩慢呼吸 | 2.4s 循環 | CSS |
| FX-36 | 燈箱（`Lightbox.tsx`） | 開、切換照片 | 開啟：由中心水平線展開（像 CRT 開機）；切換：交叉淡化 | 200ms | CSS |
| FX-37 | 所有按鈕的按壓 | `:active` | `scale(.97)`＋背景亮一下 | `--dur-instant` | CSS |
| FX-38 | 主題切換（D1 的按鈕） | 切換 | 整頁一次掃描線劃過後換色；切回標準時不播 | 300ms | VT |

### 6.3 明確不做的動畫

- 內文、紀錄文字、表格內容的亂碼或打字效果（中文亂碼不好讀，而且會拖慢閱讀）。
- 常駐的 glitch、掃描線捲動、背景粒子。
- 滑鼠游標的拖尾或光暈。
- 會改變版面高度的動畫（不能造成 CLS）。

---

## 7. 響應式

| 寬度 | 差異 |
|---|---|
| ≥ 1024（桌面側欄） | 全部效果 |
| 768–1023（圖示列） | 目前頁（`[aria-current="page"]`）左側 2px `accent` 內側直條（`box-shadow: inset 2px 0 0 var(--accent)`，P1 靜態，不是 `nav-indicator`；1024 以上維持 `>` 前綴）；`nav-indicator`（P3）改成垂直方向的短條；tooltip 用 cyber 外觀（`surface-raised` 底、青框），不再是 `ink-1` 底 |
| < 768（手機） | 掃描線透明度降為 0.015；光暈減半；依序進場上限降為 10 項；FX-14 日曆只淡入不跑對角；切角改小（`--cut-sm`）；**觸控目標 44px 規則不變** |
| 320 | 不能出現橫向捲動（裝飾前綴要計入寬度；品牌字「產線日誌」不能換行成直排） |

---

## 8. 列印與報表

1. `ReportDocument.tsx` 內的元素**不加任何 `data-fx`**；`report.css` 不改。
2. `cyber.css` 檔尾的 `@media print`：把掃描線、點陣背景、光暈、切角、裝飾前綴全部移除，並**還原全部色彩 token 與 `--r-*`**（值等於標準淺色 `:root`）、設 `color-scheme: light`、body 字型回標準；`body` 用 `background: var(--page); color: var(--ink-1)`（token 還原後即標準淺色的 `#f9f9f7`／`#0b0b0b`），所以 **cyber 列印 ≡ 標準淺色列印**——即使使用者在 App 頁面（不是報表）按列印，也不會印出黑底。（註記：此處與原文「`html, body` 背景回白色」有差異：為了做到與標準淺色列印逐元素一致，實作改用標準淺色的 `--page`／`--ink-1`，而不是純白純黑。之後各期新增的 cyber token 與裝飾，都要在這個區段同步還原；`cyberCss.test.ts` 檢查 print 區段的 token 涵蓋 cyber 區塊全部色彩 token 且值等於標準淺色 `:root`。）
2a. **P1 新增的裝飾如何還原**：`@media print` 區段內，所有 `[data-fx]` 元素（含 `::before`／`::after`）用 `all: revert-layer` 退回 Tailwind 層的值（`cyber.css` 沒放進 `@layer`，`revert-layer` 會退到最後一個具名層，也就是標準主題的樣式）；選擇器加 `:not(#cyber-print)` 把特異度拉高，壓過螢幕規則的 `:hover`／`:not(:disabled)`。沒有 `data-fx` 但被改動的元素逐項還原：分段按鈕（`position`、`[ ]` 前後綴）、勾選的 `svg`（`display`）、欄位輸入框（`border-color`）、toast（前綴 `content: none`、圓角 8px、錯誤框、sonner 淺色主題的 `--normal-*` 字面值、關閉鈕）。點陣 `background-image: none`、`body::after { display: none }`。**驗收做法**：用 CDP 把頁面切到 print media（`Emulation.setEmulatedMedia`），逐元素（含 `::before`／`::after` 的 `content` 與完整 computed style）比對標準淺色與 cyber（系統深色／淺色各一次）；儀表板、列表、新增表單（含驗證錯誤）、日曆、回收桶、確認對話框、設定、報表（含 `#report-output`）、詳情面板、多選下拉、tooltip、toast 全部 0 差異（主題切換鈕因為狀態不同，色彩本來就不同，排除）。
3. 掃描線是 `body::after` 偽元素（第 5.1 節），不再有「新的 fixed 元素＋`print:hidden`」，`report.css` 的 `#root .fixed` 規則（只作用在 `#root` 裡的元素）也不適用於它；所以 `cyber.css` 檔尾的 `@media print` 內要明確寫 `:root[data-theme="cyber"] body::after { display: none }`，並把 `body` 的點陣 `background-image` 還原為 `none`。
4. 「開新視窗」的報表 `<html>` 沒有 `data-theme`，cyber.css 的規則全部不會套用（因為每條規則都以 `:root[data-theme="cyber"]` 開頭）。
5. `ReportPage.tsx` 的**控制列**（日期範圍、產生報表、列印、開新視窗按鈕）可以用 cyber 外觀；報表本體維持紙本。
6. **`#report-output` 的嚴重度 token 隔離**：`report.css` 只重新定義文字／線／底色 token，沒有覆寫嚴重度四色，而報表的 `.rr-sev` 色塊會用到它們；所以 `cyber.css` 在 `:root[data-theme="cyber"] #report-output` 內把 `--good`／`--warning`／`--serious`／`--critical` 還原成標準淺色值（`cyberCss.test.ts` 與 `index.css` 比對）。之後新增的 cyber token 或裝飾也不得漏進 `#report-output`。

---

## 9. 驗收條件

### 9.1 自動化（加進現有測試，CI 五個指令都要綠燈）

| # | 檢查 | 放在哪裡 |
|---|---|---|
| A1 | cyber 色票：`ink-1`／`ink-2`／`ink-muted`／`accent-text`／`good`／`warning`／`serious`／`critical` 在 `page`／`surface`／`surface-raised` 上都 ≥ 4.5；`accent-ink` 在 `accent` 上、`critical-ink` 在 `critical` 上 ≥ 4.5；日曆 `STEP_CLASS` 三級 ≥ 4.5 | `contrast.test.ts`（`THEMES` 加 `cyber`） |
| A2 | cyber 區塊定義的 token 名稱集合 = 淺色 `:root` 的集合（沒有漏定義）；cyber 區塊在 CSS 檔中位於系統深色 media 區塊之後 | `contrast.test.ts` |
| A3 | `theme.ts`：`localStorage` 丟例外時回傳 `"standard"`；`?theme=cyber` 會套用並寫回；`applyTheme` 正確設定或移除 `data-theme` 與 `color-scheme` | 新的 `theme.test.ts` |
| A4 | `useFx()`：沒有 `data-theme`、或減少動態效果時為 false | 新的 `fx.test.tsx` |
| A5 | `ScrambleNumber`：可存取名稱與 `getByText` 都是真實數字；`useFx()` 為 false 時不渲染亂碼層；動畫結束後亂碼層已移除 | `fx.test.tsx` |
| A6 | cyber.css 每條規則都以 `:root[data-theme="cyber"]` 開頭（讀檔、逐條檢查選擇器）；所有 `content:` 宣告都有 `/ ""` 替代文字 | 新的 `cyberCss.test.ts` |
| A7 | `ReportDocument` 的輸出中沒有任何 `data-fx`／`data-variant`／`data-fx-alert`；`report.css` 的列印選擇器仍在（沿用現有測試） | `ReportDocument.noFx.test.tsx`（新）、`ReportDocument.test.tsx`；整頁（`ReportPage`）版本在 `test/dataFx.test.tsx` |
| A8 | P0 之前既有的 408 個前端測試、169 個後端測試**不修改就全部通過**（只允許因 `data-fx` 屬性造成的快照差異，若有快照）。前端測試數量基準：P0 前 408 個、P0 後 503 個、P1 後 565 個（均為實測；之後各期以實測為準） | — |

### 9.2 無障礙

| # | 條件 |
|---|---|
| B1 | 開啟系統「減少動態效果」：cyber 主題下沒有任何移動、閃爍、亂碼；只剩顏色與靜態外觀 |
| B2 | 螢幕閱讀器（NVDA 或 VoiceOver）在 cyber 與標準主題下，唸出的導覽、按鈕、KPI、列表內容**完全相同**（不會唸出 `>`、`//`、`[OK]`、亂碼數字） |
| B3 | Tab 走過所有頁面：每個可聚焦元素的焦點環都完整可見（包含切角面板內的元素）；焦點環與背景對比 ≥ 3:1。**判定以「cyber 沒有比標準主題更差」為準**：側欄連結、列表列、趨勢柱的焦點環被 `overflow` 裁掉是標準主題既有狀況，不在 cyber 範圍。日曆格是例外，已處理：`:focus-visible` 時外側墊 `--page` 色外暈（`0 0 0 6px`）並 `z-index: 1`，環對相鄰第 3 級格的緊鄰像素 ≥ 3:1 |
| B4 | 詳情面板、對話框、手機「更多」面板：焦點鎖定、Esc 關閉、焦點回到觸發元素，行為與標準主題相同（`CLAUDE.md` 手動驗證第 2 點全部重做一次） |
| B5 | 沒有任何每秒超過 3 次的閃爍（逐一檢查 FX-08、22、24、29、34） |

### 9.3 標準主題零差異

| # | 條件 |
|---|---|
| C1 | 用逐元素比對計算後樣式的腳本（做法同當初報表比對：位置、字型、字級、行高、顏色、邊框、圓角），在**標準淺色與標準深色**、寬度 375／900／1280，比對儀表板、列表、新增表單、詳情面板、日曆、回收桶、設定、報表頁：**0 差異**（`data-fx` 屬性本身不算） |
| C2 | 列印報表：cyber 主題下按「列印／另存 PDF」，與標準主題的 PDF 逐頁一致；開新視窗的報表與標準主題一致 |

### 9.4 效能

| # | 條件 |
|---|---|
| P1 | 中階 Android 手機（或 Chrome DevTools 4× CPU 降速）：捲動紀錄列表、開關詳情面板維持 ≥ 50fps；任何 FX 不造成 > 50ms 的長任務 |
| P2 | cyber 動畫不造成版面位移（CLS = 0） |
| P3 | 打包大小：`web/dist` 的 JS 增加 ≤ 8KB（gzip），CSS 增加 ≤ 12KB（gzip）；不新增任何 npm 相依套件 |
| P4 | 冷啟動到內容出現的時間，cyber 與標準主題差異 ≤ 50ms（FX-01 不能延後內容） |

### 9.5 手動情境（使用者實測）

| # | 情境 | 通過條件 |
|---|---|---|
| M1 | 在產線用手機新增一筆紀錄（含 2 張照片） | 所需時間、點擊次數與標準主題相同；沒有「等動畫」的感覺 |
| M2 | 現場光線下看儀表板與列表 | 嚴重度四色、狀態三種符號一眼可分；文字不會因光暈糊掉 |
| M3 | 連續快速操作：點長條→列表→開詳情→下一筆×5→關閉→換頁 | 每一步都即時反應，沒有動畫堆疊或卡住 |
| M4 | 切換主題後重新整理、關掉分頁再開 | 選擇被記住（依 D2）；不會先閃一下標準主題 |
| M5 | `CLAUDE.md`「測試與驗證」的手動清單 1～9 在 cyber 主題下全部重做 | 行為與標準主題完全相同 |

---

## 10. 分期

每一期都可以單獨合併、單獨退回；前一期驗收通過才開始下一期。

| 期 | 內容 | 涵蓋 | 驗收 |
|---|---|---|---|
| **P0 主題骨架**<br>已合併（PR #40） | `theme.ts`、`useFx()`、D1 切換入口、cyber token 區塊、圓角執行期化、`cyber.css` 空殼與列印還原 | 第 3、4 節 | A1–A4、A6、A8、C1、C2、M4 |
| **P1 靜態外觀**<br>實作＋獨立驗證完成、待設計審查與合併（分支 `feat/cyber-p1-static`，PR #41） | `data-fx` 掛勾、面板／切角／按鈕／焦點環／裝飾前綴、背景點陣與掃描線（靜態） | 第 5 節 | A6、A7、B2、B3、C1、M2 |
| **P2 微互動與浮層** | hover、按壓、聚焦、彈出選單、面板、對話框、toast、錯誤、骨架等純 CSS 動畫 | FX-05、06、10、15、17–24、28–31、33–37 | B1、B4、B5、P1、P2、M3 |
| **P3 招牌效果** | 開機畫面、換頁 View Transitions、數字鎖定、長條／趨勢／日曆／列表依序進場、帶入閃爍 | FX-01–04、07–09、11–14、16、25–27、32、38 | A5、P3、P4、M1、M5 |

**P1 實作時與上文的差異**（都已寫回對應章節）：掃描線 `body::after`；切角畫在 `::before`／L 形角框畫在 `::after`、元素本身不加 `clip-path`（§5.3）；`>` 前綴只在桌面側欄且絕對定位、不佔版面（§5.2）；頁面標題游標延到 P3；toast 前綴用 sonner 屬性選擇器，並把 sonner 深色主題的純黑底改回 token（§5.2）；焦點環沿用 `index.css` base 層的規則，不另寫（§5.6）；甜甜圈弧的光暈用 `drop-shadow`（§5.5）；列印還原以 `all: revert-layer` 為主（§8）；手機頂欄標題（18px）不加文字光暈（§4.2）。

---

## 11. 風險與回退

| 風險 | 對策 |
|---|---|
| 現場實用性不如預期 | opt-in 設計：切回標準即可，資料與功能完全不受影響 |
| 某個效果在特定瀏覽器出問題 | 每個 FX 都是獨立的 CSS 規則或 `useFx()` 分支，可以單獨移除 |
| View Transitions 與換頁後的焦點移動衝突 | P3 驗收 B4 時特別檢查；有衝突就關掉 FX-02（換頁改成只有 FX-03） |
| 未來新增元件忘了 cyber 外觀 | 新元件只要用語意 token，cyber 下就自動有正確配色；只是沒有 `data-fx` 的特效 |
| 完全放棄這個實驗 | 刪除 `cyber.css`、`lib/fx/`、`theme.ts`、cyber token 區塊與 D1 的按鈕；`data-fx` 屬性無害，可以留著或一併移除 |

---

## 12. 執行流程與角色

比照 `docs/refactor-plan.md` §5（實作 → 獨立驗證 → 修正 → 重驗 → 文件檢查），差別是多一道**設計審查**關卡：

| 角色 | 負責 | 執行者 |
|---|---|---|
| 主視覺設計師／顧問 | 這份規格書、每期的設計簡報、設計審查（對照本文件判定「符合／不符合」並列出要改的地方）、回答設計疑問 | 主模型 |
| 工作協調 | 依本文件派發每期工作、串起實作／驗證／修正／文件檢查、開 PR、回報 | Sonnet |
| 實作、驗證、修正、文件檢查 | 同 `refactor-plan.md` §5；驗證依 `.claude/agents/verifier.md` | Sonnet |

**每一期的流程**

1. 協調者依第 10 節派發實作；實作在自己的 git worktree，從最新 `origin/main` 開分支（P0 `feat/cyber-p0-theme`、P1 `feat/cyber-p1-static`、P2 `feat/cyber-p2-motion`、P3 `feat/cyber-p3-signature`）。
2. CI 綠燈後，獨立驗證者依第 9 節中該期的驗收條件實測，並提供**設計審查用截圖**：375／900／1280 三種寬度 × cyber、標準深色、標準淺色，以及該期新增效果的前後狀態。
3. 有問題 → 修正 → **新的**驗證者重驗。
4. **設計審查**：主模型對照本文件審查 diff 與截圖；不符合就退回第 3 步。實作中遇到本文件沒寫到、或寫了但做不到的地方，**先問設計師，不要自行決定**。
5. 文件檢查（`CLAUDE.md`／`AGENTS.md` 同步、`README.md`），並在第 10 節標註狀態與 PR。
6. **合併要使用者明確同意**（每個 PR 各自同意）；合併後才開始下一期。

資料安全規則同 `refactor-plan.md` §5：真實資料夾禁止讀寫、禁止當 `DATA_DIR`，啟動 App 一律用複製的範例資料、非 3000 的 port。

## 13. 待實作時一併更新的文件

- `CLAUDE.md`／`AGENTS.md`（兩份內容保持同步，只有原本就不同的章節標題不同）：〈關鍵檔案〉加入 `styles/cyber.css`、`lib/theme.ts`、`lib/fx/`；〈前端與共用邏輯的規則〉加入第 2 節的紅線摘要（特別是「報表不加 `data-fx`」「cyber 規則一律以 `:root[data-theme="cyber"]` 開頭」「裝飾 `content` 要有 `/ ""`」）；手動驗證清單加入 cyber 主題的項目。
- `README.md`：介面主題的行為描述、專案結構（`src/lib/`、`src/styles/`、`docs/`）；與 `CLAUDE.md` 同步更新。
- 本文件：每期完成後在第 10 節標註完成日期與 PR（見第 12 節）。
