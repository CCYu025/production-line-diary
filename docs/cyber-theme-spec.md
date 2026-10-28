# 產線日誌 Cyber-Terminal 主題 設計規格書

> 狀態：**規格草案，尚未實作**（2026-10-28）。
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
- 網址 `?theme=cyber`／`?theme=standard`（hash 前的 query）可以覆寫並寫回偏好，方便測試與 D1 選項 (b)。
- sonner 的 `Toaster` 要傳入目前生效的主題（cyber 時為 `dark`），不然系統淺色時 sonner 自己的預設樣式會是淺色。
- 新增 `useFx()` hook：只有在 `data-theme === "cyber"` **而且**沒有開啟減少動態效果時，才回傳 `true`。所有 JS 動畫（第 6 節標 JS 的項目）都要先檢查它。
  **jsdom 測試環境沒有 `data-theme`，所以 `useFx()` 是 false，現有 408 個前端測試的行為不變。**

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
**這是 cyber 唯一需要改動元件標記的地方，不改結構、不改事件**：

| `data-fx` 值 | 掛在哪裡 |
|---|---|
| `panel` | `ChartCard`、KPI 卡、列表外框、設定表格外框、回收桶外框 |
| `panel-cut` | 主要 KPI 卡（待處理、追蹤中）——切角＋HUD 角框 |
| `nav-item` | `Sidebar.tsx`、`MobileChrome.tsx` 的每個導覽項目 |
| `nav-indicator` | 新增一個 `aria-hidden` 的高亮條元素（側欄目前位置） |
| `bar` / `bar-row` | `charts.tsx` 的長條與整列按鈕 |
| `trend-col` | 每日趨勢的柱子 |
| `cal-cell` | 日曆格子 |
| `row` | 紀錄列表的每一列（桌面表格列與手機卡片） |
| `page-title` | `PageHeader.tsx` 的標題、手機頂欄標題 |
| `kpi-num` | KPI 數字 |
| `field` | 表單輸入框外層（`fields.tsx`） |
| `submit` | 表單送出按鈕、匯出 Excel 按鈕 |
| `seg` | `SegmentedControl.tsx` |
| `sheet` / `dialog` / `pop` | 詳情面板、確認對話框、彈出選單 |
| `toast` | sonner 的 toast（用 `toastOptions.classNames` 加） |
| `skeleton` | `ui/skeleton.tsx` |
| `error` | `ErrorState.tsx` |

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
| `--text-glow` | `0 0 6px rgba(34,230,255,.45)` | **只用在 ≥ 20px 的數字與頁面標題**，內文不加 |
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

- **頁面**：`--page` 加上 24px 間距的點陣（`radial-gradient`，顏色 `--grid-dot`），**靜態不動**。
- **掃描線**：一層固定在畫面上、`pointer-events: none`、`aria-hidden` 的水平細線（`repeating-linear-gradient`，透明度 `--scan-opacity`）。
  **靜態不動**（不做捲動或閃爍），列印時隱藏（第 8 節）。它是新的 fixed 元素，必須加 `print:hidden`。
- **不做**：毛玻璃（`backdrop-filter`）、常駐的雜訊動畫、CRT 彎曲變形。

### 5.2 裝飾字元（一律不朗讀）

用 CSS `content` 的替代文字語法讓螢幕閱讀器不唸：`content: "> " / "";`。

| 位置 | 裝飾 |
|---|---|
| 側欄目前頁面 | 前綴 `>`，青色；其他項目保留同寬的空白，文字才不會跳動 |
| 群組小標（檢視／輸出／管理） | `// 檢視` |
| 頁面標題 | 前綴 `~/`（`ink-muted`）＋尾端閃爍游標方塊（`aria-hidden` 元素，1s `steps(1)` 閃爍） |
| 分段按鈕 | 選中的項目兩側 `[ ]` |
| 多選下拉的勾選 | 視覺上畫成 `[x]`／`[ ]`；原生的 checkbox 語意不變 |
| 錯誤訊息 | 前綴 `ERR:`（critical 色） |
| 成功 toast | 前綴 `[OK]`；錯誤 toast 前綴 `[ERR]` |

**不加裝飾**：表格內容、紀錄文字、表單 label、按鈕文字本身。

### 5.3 面板

- `data-fx="panel"`：`surface-raised` 底、1px `line` 框、2px 圓角；hover 不變（面板本身不可點）。
- `data-fx="panel-cut"`：右上與左下切角（`clip-path`，大小 `--cut-md`）；四角各一個 10px 的 L 形角框（`::before`／`::after` 加一個 `aria-hidden` 元素），顏色 `line-strong`；
  **「待處理」大於 0 時**，角框改成 `serious` 色並做呼吸效果（FX-08）。
- 切角會把 `border` 一起裁掉，所以切角面板的框線改用內層 `box-shadow: inset 0 0 0 1px var(--line)` 畫，切角處另外用一條 45° 的細線補上。

### 5.4 按鈕

| 變體 | Cyber 外觀 |
|---|---|
| `primary` | 透明底、1px `accent` 框、`accent-text` 字；hover 時 `accent-wash` 底＋`--glow-accent`；**對比仍以 accent-text 在 page／surface-raised 上計算（≥ 11.5）** |
| `secondary` | `surface-raised` 底、`line-strong` 框；hover 時框線變 `accent` |
| `ghost` | 不變，hover 時文字 `accent-text` |
| `destructive` | 透明底、`critical` 框與字；hover 時 `--glow-critical` |
| `link` | 不變 |

觸控尺寸、`disabled` 樣式不變。

### 5.5 嚴重度與狀態

- 嚴重度色條（`SeverityBadge`、列表左側色條）加 4px 同色光暈（`box-shadow`，透明度 .5）。只有「重大」的光暈稍強（.7）。
- 狀態符號 ○ ◐ ● 不變，顏色 `ink-2`。**不加任何顏色**，維持「狀態用形狀」。

### 5.6 焦點環

- 一般元素：`outline: 2px solid var(--accent-text); outline-offset: 2px`（與現行相同，只是顏色變青色）。
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
| 768–1023（圖示列） | `nav-indicator` 改成垂直方向的短條；tooltip 用 cyber 外觀（`surface-raised` 底、青框），不再是 `ink-1` 底 |
| < 768（手機） | 掃描線透明度降為 0.015；光暈減半；依序進場上限降為 10 項；FX-14 日曆只淡入不跑對角；切角改小（`--cut-sm`）；**觸控目標 44px 規則不變** |
| 320 | 不能出現橫向捲動（裝飾前綴要計入寬度；品牌字「產線日誌」不能換行成直排） |

---

## 8. 列印與報表

1. `ReportDocument.tsx` 內的元素**不加任何 `data-fx`**；`report.css` 不改。
2. `cyber.css` 檔尾的 `@media print`：把掃描線、點陣背景、光暈、切角、裝飾前綴全部移除，`html, body` 背景回白色——即使使用者在 App 頁面（不是報表）按列印，也不會印出黑底。
3. 掃描線圖層是 fixed 元素，除了 `print:hidden`，也會被 `report.css` 的 `#root .fixed` 規則涵蓋；兩者都要在。
4. 「開新視窗」的報表 `<html>` 沒有 `data-theme`，cyber.css 的規則全部不會套用（因為每條規則都以 `:root[data-theme="cyber"]` 開頭）。
5. `ReportPage.tsx` 的**控制列**（日期範圍、產生報表、列印、開新視窗按鈕）可以用 cyber 外觀；報表本體維持紙本。

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
| A7 | `ReportDocument` 的輸出中沒有任何 `data-fx` 屬性；`report.css` 的列印選擇器仍在（沿用現有測試） | `ReportDocument.test.tsx` |
| A8 | 現有 408 個前端測試、169 個後端測試**不修改就全部通過**（只允許因 `data-fx` 屬性造成的快照差異，若有快照） | — |

### 9.2 無障礙

| # | 條件 |
|---|---|
| B1 | 開啟系統「減少動態效果」：cyber 主題下沒有任何移動、閃爍、亂碼；只剩顏色與靜態外觀 |
| B2 | 螢幕閱讀器（NVDA 或 VoiceOver）在 cyber 與標準主題下，唸出的導覽、按鈕、KPI、列表內容**完全相同**（不會唸出 `>`、`//`、`[OK]`、亂碼數字） |
| B3 | Tab 走過所有頁面：每個可聚焦元素的焦點環都完整可見（包含切角面板內的元素）；焦點環與背景對比 ≥ 3:1 |
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
| **P0 主題骨架** | `theme.ts`、`useFx()`、D1 切換入口、cyber token 區塊、圓角執行期化、`cyber.css` 空殼與列印還原 | 第 3、4 節 | A1–A4、A6、A8、C1、C2、M4 |
| **P1 靜態外觀** | `data-fx` 掛勾、面板／切角／按鈕／焦點環／裝飾前綴、背景點陣與掃描線（靜態） | 第 5 節 | A6、A7、B2、B3、C1、M2 |
| **P2 微互動與浮層** | hover、按壓、聚焦、彈出選單、面板、對話框、toast、錯誤、骨架等純 CSS 動畫 | FX-05、06、10、15、17–24、28–31、33–37 | B1、B4、B5、P1、P2、M3 |
| **P3 招牌效果** | 開機畫面、換頁 View Transitions、數字鎖定、長條／趨勢／日曆／列表依序進場、帶入閃爍 | FX-01–04、07–09、11–14、16、25–27、32、38 | A5、P3、P4、M1、M5 |

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

- `CLAUDE.md`：〈關鍵檔案〉加入 `styles/cyber.css`、`lib/theme.ts`、`lib/fx/`；〈前端與共用邏輯的規則〉加入第 2 節的紅線摘要（特別是「報表不加 `data-fx`」「cyber 規則一律以 `:root[data-theme="cyber"]` 開頭」「裝飾 `content` 要有 `/ ""`」）；手動驗證清單加入 cyber 主題的項目。
- 本文件：每期完成後在第 10 節標註完成日期與 PR（見第 12 節）。
