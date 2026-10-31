# 產線日誌 Cyber-Terminal 主題 設計規格書

> 狀態：**P0 已合併（PR #40）；P1 已合併（PR #41）；P2 已合併（PR #42）；P3 已合併（PR #43）**（2026-10-31）。
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

**2026-10-28 P1 設計裁定**：(1) 掃描線改用 `body::after`（不新增 DOM），點陣畫在 cyber 的 `body` `background-image`；(2) 切角面板的切角、底色與框線畫在 `::before`（`clip-path` 在偽元素上），角框畫在 `::after`（直角 L 形、切角折角括號，見設計審查裁定 (4)），**可聚焦的元素本身不加 `clip-path`**，切角斜邊的框線用 45° 漸層補連續；(3) 手機底部中央「新增」圓鈕（`data-fx="fab"`）維持實心，側欄「新增紀錄」照 `primary` 規格（透明底＋青框）；(4) 為 P1 追加的 `data-fx` 掛勾（第 3.3 節表）已隨 `8b675ff` 加入；(5) 裝飾前綴的範圍：`>` 只在桌面側欄（≥ 1024），頁面標題 `~/` 在 ≥ 768 套在 `<h1>`、< 768 套在手機頂欄的標題，**頁面標題的尾端游標延到 P3**，toast 前綴改用 sonner 屬性選擇器；(6) 文字光暈 `--text-glow` 只用在 `kpi-num` 與 ≥ 20px 的 `page-title`（手機頂欄標題 18px，不加）；(7) P1 不寫任何 `@keyframes`／`transition`（FX 全屬 P2／P3）；(8) 焦點環不另寫規則（見第 5.6 節）。

**2026-10-28 P1 設計審查**裁定（PR #41 退回一輪修正，本段為修正後的最終做法）：(1) **分段按鈕選中態改空心終端風**——`accent-wash` 底＋1px `accent` 內框（`box-shadow: inset 0 0 0 1px`，不改尺寸）＋`accent-text` 字，保留 `[ ]`，括號**貼著文字**、與文字固定間距 4px（桌面括號是按鈕的 `::before`／`::after` 排進內容前後，手機是標籤 `<span>` 兩側的絕對定位），選中與未選中時文字位置不跳動；嚴重度色條因此在深底上清楚可辨；(2) 回收桶「永久刪除」按鈕不動 variant，加**純屬性 `data-fx-tone="danger"`**（標準主題 0 差異），cyber 下 critical 字與框、hover 為 `--glow-critical`、絕不出現青框；(3) **按鈕框線一律用 `inset box-shadow`**，hover 光暈與內框合併在同一個 `box-shadow` 宣告，不新增實體 `border`，cyber 與標準的按鈕尺寸（rect 寬高）必須相同；(4) 切角面板的角框在兩個切角處改成**連續的「折角括號」**（兩段直邊線＋中間 45° 斜線）；(5) 平板圖示列（768–1023）目前頁左側加 2px `accent` 內側直條（靜態，不是 `nav-indicator`）；(6) 日曆格 `:focus-visible` 在焦點環外側墊 `--page` 色的外暈，並用 `z-index` 蓋在相鄰格上，使焦點環對相鄰第 3 級格 ≥ 3:1；(7) 掃描線色 `--ink-1` 核准；手機頂欄 18px 標題不加光暈（維持 ≥ 20px 才加）；(8) **色盲不在 P1 處理**（嚴重度本來就有文字標籤，狀態用形狀）；(9) 側欄連結、列表列、趨勢柱的焦點環被 `overflow` 裁掉是標準主題既有狀況，**不在 cyber 範圍**（§9.2 B3 的判定以「cyber 沒有比標準主題更差」為準）；(10) 上面 P1 設計裁定的偏離第 1–7 項已核准；多選選項語意（`role="option"`＋sr-only「（已選）」）不變，`[x]`／`[ ]` 只是 `aria-hidden` 的視覺。 修正輪重驗（HEAD `93060a0`）後另裁定接受：(11) **「按鈕 rect 必須與標準相同」只涵蓋 `Button` 元件**（框線用 `inset box-shadow` 不改尺寸）；分段按鈕群組在 cyber 可以變寬（桌面括號佔位約 +24.81px，另有等寬字型的影響），條件是不折行、320–1280 無橫向捲動、觸控目標不比標準小；(12) **已知的緊繃情況**：320 寬五選項嚴重度篩選選中時，括號 ink 離按鈕內框只有約 0.56–0.77px（沒有出框、括號與文字間隙 ≥ 2px 已達成），維持現狀；(13) 狀態符號 ○ ◐ ● 沒有「依狀態而異的色相」，一律跟隨 `currentColor`，所以分段按鈕選中時被 `accent-text` 染色是允許的（§5.5）；(14) 「永久刪除」（`data-fx-tone="danger"`）沿用標準主題本來就是 `critical` 色的實體 1px 框，不另加 inset 內框（否則變 2px）；(15) 既有、非 cyber 造成：375 寬時固定的底部分頁列與中央新增鈕會蓋住被 Tab 聚焦到的下方元素（cyber 與標準相同，不在本期範圍）；(16) **FX-19（P2）要先對齊現況**：分段按鈕目前每顆都有括號、未選中的以 `visibility: hidden` 佔位，P2 的「括號滑到新選項」需據此重新設計。

**2026-10-29 P2 設計簡報**裁定：(1) **FX-19**：括號常駐、未選中的 `visibility: hidden` 佔位，所以「滑到新選項」做不到，改成**新選中項的括號由外側 4px 收回定位並淡入**（只動 `transform`／`opacity`，括號最終位置與 P1 相同）；(2) **FX-17** 只做「新增」（`clip-path` 由左展開），**移除直接消失**（移除動畫要延後卸載，不做）；(3) **FX-31（回收桶溶解）整項移到 P3**：要延後卸載該列，P3 判斷能否不延後 API 呼叫，不行就放棄；(4) **FX-21** 改為「切換紀錄時重播 FX-20 的內容依序淡入」：`DetailBody` 本來就以 `key={r.id}` 重新掛載，所以不分前後方向、沒有獨立的 glitch；每段 200ms、間隔 30ms，延遲分 6 檔（第 8 個之後的區塊共用最後一檔），最晚一段收尾 ≤ 350ms（以實作為準）；(5) **FX-22** 沿用 `data-variant="destructive"`（所有 destructive 確認框都有 4px `critical` 斜紋上緣＋`--glow-critical`，**未新增 `data-fx-tone`**）；進場 glitch 改用 `transform`／`opacity`，**不用 `clip-path`**——`clip-path` 會讓 hit-test 跟著被裁掉、進場中點不到按鈕（實測發現並修正）；(6) **FX-23** 的 `>` 提示符只有 Combobox 外層（`combobox`）有，其餘輸入框只有框線＋光暈；(7) **FX-24** 的抖動在 `aria-invalid` 出現時觸發，同一個錯誤第二次提交不重播；(8) **FX-28 移到 P3**：`SegmentedControl` 的選項沒有「被建議」屬性，要先加 prop；(9) **FX-29** 沿用 sonner 自己的進退場滑動，cyber 只加左側色條、標題打字、錯誤框閃一次；(10) **FX-30** 的 `accent` 底是靜態狀態＋`box-shadow` 閃一次；(11) **FX-33（骨架掃光）與 FX-35（未儲存呼吸）是 P2 唯二的 `infinite` 動畫**；(12) **FX-36** 開啟用 `scaleY`＋`opacity`，**切換照片不做**（`<img>` 只換 `src`、不重新掛載）；(13) **FX-37** 按壓用 `inset` 疊色（`box-shadow: inset 0 0 0 999px`）亮一下，不改尺寸；(14) **FX-06** 的擴散環畫在新增鈕連結 `<a>` 的 `::after`（56px／`top: -24px`，對齊凸出的圓鈕、`pointer-events: none`），**不碰 `data-fx="fab"`**，與 `MobileChrome` 的 FAB class 以測試綁定（P1 起 `cyber.css` 就不處理 `fab`，`cyberCss.test.ts` 斷言沒有 `fab` 的選擇器）；(15) **FX-10** 為了讓長條的光暈不被裁掉，新增 `bar-track` 掛勾，cyber 下軌道改 `overflow: visible`（長條寬度本來就 ≤ 軌道）；(16) **列印還原用 `revert-layer` 而不是 `none`**：保持 computed style 與標準淺色一致（標準主題本來就有的 Tailwind 動畫與 transition 列印時要保留）；sonner 整棵子樹的 transition／animation 是執行期插入的無層級樣式，`revert-layer` 會連它的一起退掉，所以只對那棵子樹做 `animation: none`；(17) **P1 的「不得有動畫」靜態斷言改為只掃 `/* === P2 START === */` 之前**（`cyberCss.test.ts`）；P2 區段另有自己的斷言（只動 `transform`／`opacity`／`clip-path`／光暈 `box-shadow`、`@keyframes` 以 `cyber-` 前綴、`infinite` 白名單等）；(18) **P2 專用動畫時間 token 定義在 `cyber.css` 的 `:root[data-theme="cyber"]` 區塊（P2 區段開頭），不放 `index.css`**：`--dur-close: 100ms`、`--dur-open: 200ms`、`--dur-type: 200ms`、`--dur-shake: 240ms`、`--dur-err: 280ms`、`--dur-flash: 120ms`、`--dur-ring: 300ms`、`--dur-sweep: 1.6s`、`--dur-breathe: 2.4s`、`--stagger-sheet: 30ms`、`--dur-sheet-item: 200ms`、`--ease-type: steps(8, end)`，另有按壓疊色 `--press-wash`、`--press-wash-critical`；§4.4 的 `--dur-*`／`--ease-*`／`--stagger` 仍在 `index.css` 的 `:root`。

**2026-10-30 P3 設計簡報**裁定：(1) **範圍**：FX-01、03、04、07、08、09、11–14、16、25–27、28、31、32、36（含切換照片）、38，以及頁面標題尾端游標（§5.2）與 `nav-indicator`（§3.3，與 FX-04 一起）；**FX-17 的「移除」動畫不做**（要延後卸載，直接消失）；**FX-02 換頁 View Transitions 評估後移除**（見第 10 點）。(2) **infinite 白名單**：FX-33、FX-35（P2）＋ FX-08、頁面標題游標、FX-25、FX-26、FX-32（P3）；理由是它們的語意都是「持續」（警示、游標、進行中），只動 `opacity`／`transform`、不閃爍；**infinite 一律直接寫在 `animation` 簡寫裡**（不用 `--loop-forever` 之類的間接 token）。**授權修改 P2 既有斷言**：「infinite 恰好 2 條」改為依 `@keyframes` 名稱的白名單比對（並加負向測試：白名單外的 infinite 一律失敗）。(3) **授權修改 FX-20 的 `detail-body` 檔數斷言**：詳情面板內容依序淡入由 6 檔減為 4 檔（延遲 0／1×／2×／3× 間隔，第 4 個之後的區塊共用最後一檔，只動 `opacity`、不位移，總長 290ms；斷言由「5 條 delay」改為「3 條」）；FX-20 的掃描線（`cyber-sheet-sweep`）`animation-delay` 延後到淡入全部結束之後（`3 × --stagger-sheet ＋ --dur-sheet-item`＝290ms），兩者不同時觸發（呼應 P2 驗證發現的 4× CPU 降速掉幀，見 §13）。(4) **FX-16**：只讓**新出現的列**進場（前 20 列，手機 10 列；篩選結果變化時，原本就在的列不重播），捲動中不重播；hover 的 `▶` 為 `aria-hidden`、`content` 帶 `/ ""`、不佔版面；虛擬化／分頁行為不變。(5) **不重掛可聚焦元素**：長條（按鈕）、趨勢柱（按鈕）、日曆格等**不以資料簽名或月份當 `key` 重掛**——重掛會讓焦點掉到 `body`；改用 `useReplayPhase(signature)`，簽名改變時 `data-fx-phase` 在 `"a"`／`"b"` 間翻面，CSS 在內容相同、名稱不同的兩組 `@keyframes`（如 `cyber-bar-grow`／`cyber-bar-grow-b`）之間切換 `animation-name` 以重播；簽名不變（例如 refetch 回來資料相同）相位不變。標準主題與減少動態效果時不輸出屬性。(6) **新增的 `data-fx-*` 屬性掛勾**（`data-fx-in`、`-phase`、`-indicator`、`-scan`、`-progress`、`-copied`、`-suggested`、`-ghost`、`-boot` 等）一律納入 §3.3，這些是純屬性、不是 `data-fx` 值，AX 樹與 rect 不變。(7) **FX-03**：標題尾端游標畫在標題的 `::after`，`content: "\2060 \258C" / ""`（替代文字為空，不進輔助科技），標題 `white-space: nowrap`（不會被游標擠成兩行，320 寬已驗），`steps(1)` 1s 閃爍常駐，減少動態效果時停在常亮；打字用 `clip-path`（標題不可點）。(8) **FX-38**：沒有獨立的發光掃描線——只用 View Transitions 的新畫面 `clip-path` 由上往下露出（300ms，舊畫面不動）；僅切到 cyber 且未減少動態效果時播，切回標準不播。(9) **標題打字與 VT 重疊接受**：FX-38 的整頁快照與標題打字可能同時發生（切到 cyber 的當下），不另外錯開。(10) **FX-02 換頁 View Transitions「評估後移除」**：原設計（退 80＋進 170ms）實測後放棄，理由：View Transitions 進行期間**真實 DOM 不可 hit-test**（畫面是 `::view-transition` 快照），縮到最短（退 40＋進 100、關掉根群組預設 250ms 動畫，約 240ms）仍會吞掉點擊約 250ms，違反總原則 2 與 M3「不擋輸入」；`pointer-events: none` 對 `::view-transition-*` 偽元素**無效**（實測，擋不住吞點擊）。因此 Sidebar／MobileChrome 的導覽連結與 `drill.ts` 帶篩選跳轉**都不帶 `viewTransition`**，換頁只剩 FX-03 標題打字與 FX-04 高亮條。**FX-38 保留**（主題切換是使用者主動、低頻的單次操作，300ms 內的吞點擊可接受）；`themeToggle.tsx` 是專案裡**唯一**呼叫 `startViewTransition` 的地方。(11) **FX-11**：長條列 `:active` 時由 CSS（`bar-row::before`）畫洋紅 L 形角框，**鍵盤 Enter 不觸發角框、不加 JS**、不加 `setTimeout`、不延後跳轉；FX-02 移除後角框只在按下的瞬間可見。(12) **FX-31 實作條件與結果**：見下一段（塊 C 後半裁定）——條件全部成立，已實作。(13) **掃描線 `body::after` 維持 P1 設計不改**（不為 P3 加動畫）。(14) **§9.4 P1 目標改為「相對標準主題不低超過 3fps」**（原「≥ 50fps」在 4× CPU 降速下連標準主題都達不到，見 §13；細節數字之後補）。(15) **標準主題零差異的做法**：`nav-indicator`、開機行（`BootScreen`）、FX-25 進度條都**只在 cyber（且 `useFx()`）時渲染**，標準主題 DOM 與 AX 樹與 main 完全相同；標題游標、FX-32 等為純 CSS 偽元素。FX-01 開機畫面只在 App 冷啟動、儀表板資料載入中出現，載入不到 150ms 不顯示，每個分頁只出現一次（`sessionStorage`），按任意鍵或點擊跳過，資料一到立即結束，不延後內容。

**2026-10-30 P3 塊 C 後半裁定**：(1) **FX-27**：`RecordForm` 只多一個純展示狀態 `{ n, fields }`（帶入時 `n+1`、`fields` 為真的被填值的欄位），`Field` 渲染 `data-fx-copied="a"／"b"`（依 `n` 奇偶交替）；屬性值一變，CSS 選到的 keyframes 名稱就換、動畫重播，**輸入框不重新掛載**，表單值、驗證、焦點不變；每欄 200ms、間隔 40ms；復原帶入／重設時清空欄位清單。(2) **FX-28**：`SegmentedControl` 加 optional `suggestedValue`，該選項渲染 `data-fx-suggested=<選項值>`，cyber 下屬性出現（建議值變化）時閃一次對應嚴重度色光暈 300ms；`RecordForm` 接上既有的 `suggestSeverity(duration)`，只做展示，資料流不變；標準主題沒有規則吃這個屬性。(3) **FX-31 實作（條件全部成立）**：API、查詢快取、計數、徽章都照原時機更新（`rows` 不變）；`useGhostRows` 只在 `useFx()===true` 時於原位置多留一個殘影節點 250ms（`inert`＋`aria-hidden`＋`data-fx-ghost`，不可聚焦不可點），復原垂直收起、永久刪除水平收起；標準主題／reduced-motion／jsdom 的 DOM 與原本相同；`TrashPage` 改動約 20 行；焦點落點由原本的程式碼決定、與標準相同。

| # | 決策 | 推薦 | 其他選項 |
|---|---|---|---|
| D1 | 切換入口（**這是整份規格唯一新增的介面元素**） | 桌面側欄最底部、平板圖示列最底部、手機「更多」面板最後一列：一顆「介面主題：標準／CYBER」切換按鈕 | (b) 只能用網址 `?theme=cyber` 開啟，不加任何按鈕 |
| D2 | 選擇記在哪裡 | `localStorage`（每台裝置各自記住；讀寫失敗時當作「標準」） | 不記憶，每次重開都回標準 |
| D3 | cyber 與系統淺色／深色的關係 | cyber 永遠是深色，不跟隨系統 | — |
| D4 | 開機畫面（FX-01）出現頻率 | 每個瀏覽器分頁第一次載入出現一次（`sessionStorage`），且只在資料**還在載入**時出現 | 每次載入都出現；完全不做 |

---

**2026-10-31 P4 設計裁定**（效能與列印收尾，分支 `feat/cyber-p4-polish`，待合併）：(1) **暫停／隱藏背景掃描線（a）**：`body::after` 其實是靜態圖層（P1 裁定），不是動畫，`animation-play-state: paused` 無效；改裁定「浮層開啟時 `visibility: hidden`」（`<html>` 旗標 `data-fx-overlay`、參考計數、只在 `useFx()` 時設），並要求以**真實實作**量測、1280 改善 ≥ 40ms 才保留。實測結果（見 §9.4〈P4 量測〉）：n=13 合併中位數僅 −30ms（兩批分別 −92、−12，變異大於效果；375 為 +30ms），**未達門檻，已撤掉，程式碼未進主線**；(2) **捲動列表額外成本（b）**：歸因為 FX-03 標題尾端游標（`cyber-cursor`，`/records` 上唯一執行中的動畫）——它是主執行緒動畫，捲動時每一幀多一次樣式重算；`animation: none` 即回到標準的 ±3%。**設計裁定（主設計師，並授權修改 `cyberCss.test.ts` 的既有游標斷言）**：游標在**打字結束後閃 3 次（約 3 秒）就停在常亮**（`animation: cyber-cursor 1s steps(1) 3 <打字總長延遲> forwards`，沒有 `infinite`；開機行游標同為 3 次）；標題換掉時整個元素重新掛載，所以與打字一起重播；減少動態效果不變（沒有閃爍）。`cyber-cursor` 因此自 `infinite` 白名單移除（白名單剩 6 項）；「只播一次」斷言對游標豁免整數 > 1，`forwards` 多一種允許用法（游標），並另有斷言鎖定次數 3；(3) **已開機冷啟動（c）**：`BootLoading` 在已開機時（`mode === "plain"`）沒有多餘工作，+75ms 不是開機判斷造成；關閉全部動畫、掃描線、偽元素、陰影光暈的對照都沒有改善，剩下的是 cyber 的一般 JS／樣式成本，**裁定接受為主題固有成本，P4 不再處理**（數字見 §9.4）；(4) **列印邊緣（d）**：匯出中導覽圖示的 `visibility` 在列印還原（已做）；FX-25 送出中進度條的列印畫面不做（要同時渲染旋轉圖示，會改到既有的 `fxP3C` 測試；列印中途送出是極端情境，印出結果本來就相同）；(5) **不做**：FX-38 吞點擊窗口（已接受）、FX-32 手機「更多」面板（既有行為）、桌面 CLS 0.00064（P2 既有）。

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
  **jsdom 測試環境沒有 `data-theme`，所以 `useFx()` 是 false，P0 之前的 408 個前端測試的行為不變（P0 完成後前端共 503 個，P1 完成後 565 個，P2 完成後 601 個，均含該期新增的測試）。**

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
| `panel-cut` | 主要 KPI 卡（待處理、追蹤中）。**可點時是 `<button>`（有 `relative`），0 筆時是 `<div>`（沒有 `relative`，CSS 要自己設 `position: relative`）**，兩者都是同一個值；元素本身沒有 `clip-path`／`overflow`，內容（圖示、數字、提示）是它的子元素，按鈕版另有一個絕對定位的 `ChevronRight`。載入骨架的兩張主要 KPI 也是 `panel-cut`（`<div>`）。切角與框線請畫在 `::before`、角框（直角 L 形、切角折角括號）畫在 `::after`（元素本身 cyber 下底色與框線透明；§5.3、§5.6）。 |
| `data-fx-alert`（屬性，不是 `data-fx` 的值） | 只在「待處理」那張 `panel-cut` 且**數量 > 0** 時輸出（值為空字串，`[data-fx-alert]` 即可選）；沒有警示時整個屬性不存在。追蹤中那張永遠沒有。 |
| `data-fx-tone`（屬性，不是 `data-fx` 的值） | **純屬性，值只有 `danger`**，掛在「以 `secondary` variant 實作的紅字紅框按鈕」上（標準主題靠 `border-critical`／`text-critical` class）：目前只有回收桶（`TrashPage.tsx` `RowActions`，桌面表格與手機卡片共用）每一列的「永久刪除」。cyber 靠它擋掉 secondary hover 的青框、改成 critical 框與 `--glow-critical` 光暈。標準主題 0 視覺差異、0 行為差異；不改 variant。確認對話框的確認鈕本來就是 `destructive` variant，不需要這個屬性。 |
| `nav-item` | 側欄（`Sidebar.tsx`）每個導覽項目：6 個 `<a>` 頁面連結、`匯出 Excel`（`<button>`）、最底部的「CYBER 介面」切換（`<button aria-pressed>`）；手機底部分頁列（`MobileChrome.tsx`）的 4 個分頁 `<a>`（含中央「新增」）與「更多」`<button>`；手機「更多」面板內的每一列（`<a>`／`<button>`，位於 `[data-fx="sheet"]` 內，版型是橫列，和分頁列的直排不同，請用祖先區分）與其中的「CYBER 介面」列。目前頁：`<a>` 有 `aria-current="page"`；「更多」按鈕在子頁（報表、設定、回收桶）時也有。側欄的「新增紀錄」是 `Button`（`button`／`primary`），**不是** `nav-item`。 |
| `nav-group` | 側欄群組小標（`<h2>` 檢視／輸出／管理；< 1024 時 `hidden`） |
| `brand` | 側欄 logo 方塊（`<span>`，內含 Factory 圖示，`text-white` 沒動；cyber 下圖示色由 CSS 處理）。手機頂欄沒有 logo，所以只有這一處 |
| `fab` | 手機底部中央「新增」圓鈕（`<span>`，在 `nav-item` 的 `<a>` 裡，絕對定位凸出）。維持實心樣式（§5.4） |
| `topbar` | 手機頂欄（`<header>`，`< 768` 才顯示） |
| `nav-indicator` | **（P3 實作，FX-04）** 不是 `data-fx` 值，而是屬性 `data-fx-indicator`：`NavIndicator.tsx` 在導覽列內渲染的 `aria-hidden`＋`inert` 高亮條 `<span>`，**只在 cyber 渲染**（標準主題 DOM 不變）；位置由目前頁連結（`aria-current="page"`）的 `offsetTop` 寫進 `--nav-y`，用 `transform` 位移 220ms，首次量測前沒有過渡（`data-ready`）；沒有目前頁時淡出（`data-state="off"`）；桌面為整個項目高度的 2px 青線，768–1023 改為垂直短條並取代 P1 的 2px 內側直條，< 768 不顯示 |
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
| `chip` | `FilterBar.tsx` 的篩選 chip（P2，FX-17）：每個已套用的篩選項目外層元素（新增時由左展開） |
| `bar-track` | `charts.tsx` `HBarChart` 長條的軌道（P2，FX-10）：`<span aria-hidden>`，標準主題是 `overflow-hidden` 的圓角軌道；cyber 下改 `overflow: visible`，長條的光暈才不會被裁掉 |
| `detail-body` | `RecordDetailSheet.tsx` 詳情面板的內容捲動區（P2，FX-20／21）：`DetailBody` 裡的 `<div class="overflow-y-auto">`，它的直接子元素（標題、標籤、事實格、處理、照片…）依序淡入；以 `key={r.id}` 重新掛載，所以切換上一筆／下一筆會重播 |
| `lightbox` | `Lightbox.tsx` 的對話框內容容器（P2，FX-36）：開啟時 `scaleY`＋`opacity` 展開；切換照片時 `<img>` 不重新掛載 |
| `error-title` | `ErrorState.tsx` 的標題 `<p>`（P2，FX-34）：載入失敗時 glitch 一次 |
| `unsaved` | `SettingsPage.tsx` 設備對照設定「未儲存」提示的文字外層 `<span>`（P2，FX-35）：左側 `::before` 的 `serious` 色條緩慢呼吸 |

**P3 新增的純屬性掛勾（不是 `data-fx` 值，AX 樹與 rect 不變；cyber 規則可以選它們）**：

| 屬性 | 位置與用途 |
|---|---|
| `data-fx-in` | `useStagger` 輸出（值為 `""`，另有 `style="--i: n"`）：該元素要播依序進場，超過上限（桌面 20、< 768 為 10）的項目沒有。HBar 長條（FX-09）、趨勢柱（FX-12）、日曆格（FX-14）、紀錄列（FX-16）使用；日曆換月（`"glitch"`）與甜甜圈（`"donut"`）以值區分。只在 `useFx()` 為 true 時輸出 |
| `data-fx-phase` | `useReplayPhase` 輸出（`"a"`／`"b"`）：資料簽名改變時翻面，CSS 在 `-b` 版 `@keyframes` 之間切換 `animation-name` 以重播，**不重掛 DOM**（FX-09 長條 `<ul>`、FX-12 趨勢 `<ol>`、FX-13 甜甜圈、FX-14 日曆）。標準主題與減少動態效果不輸出 |
| `data-fx-alert` | 「待處理」> 0 的 KPI 卡（P1 起；P3 的 FX-08 呼吸角框使用） |
| `data-fx-indicator` | FX-04 高亮條（見上表 `nav-indicator` 列），搭配 `data-state`／`data-ready` |
| `data-fx-boot`／`-boot-line` | FX-01 開機畫面容器與每一行（`aria-hidden`，`style="--i: n"`），只在 cyber 且 `useFx()` 時渲染 |
| `data-fx-scan` | `PhotoThumb` 上傳中覆蓋層（FX-26）；旋轉圖示與 sr-only「上傳中」保留 |
| `data-fx-progress`／`-track`／`-block` | `RecordForm` 送出中 ASCII 進度條（FX-25）；**只在 `useFx()` 為 true 時渲染**、`aria-hidden`、取代旋轉圖示（標準主題與減少動態效果仍是旋轉圖示）。送出鈕有 `md:min-w-36`（手機 `flex-1`），內容寬度遠小於最小寬，按鈕 rect 與標準送出中相同 |
| `data-fx-copied` | `fields.tsx` 的 `Field`（FX-27）：值 `"a"`／`"b"` 依 `RecordForm` 的帶入計數奇偶交替，屬性值一變 CSS 選到的 keyframes 就換、動畫重播，輸入框不重掛 |
| `data-fx-suggested` | `SegmentedControl` 的被建議選項（FX-28，optional prop `suggestedValue`；值為選項值） |
| `data-fx-ghost` | `TrashPage` 被移除列的視覺殘影（FX-31，值為 `"restore"`／`"purge"`），同時帶 `inert`＋`aria-hidden`，250ms 後移除 |
| `data-vt` | `<html data-vt="theme">`：只在「切到 cyber」的主題切換 View Transitions 期間存在（FX-38） |

FX-11 使用既有的 `bar-row`（`::before` 畫角框）、FX-32 使用既有的 `nav-item[aria-busy="true"]`、FX-36 切換照片使用 `lightbox` 內的 `<img key={src}>`（標準主題也以 src 為 key，視覺不變）、FX-03 使用既有的 `page-title`。**infinite 白名單（P3）**：FX-08、頁面標題游標（FX-03）、開機行游標、FX-25、FX-26、FX-32，理由：語意是「持續」或「進行中、時間不明」，必須持續可見；只動 `opacity`／`transform`、不閃爍，元素只在對應狀態才存在／匹配；`infinite` 一律直接寫在 `animation` 簡寫裡。FX-32 在圖示列（768–1023，只有圖示）不顯示。

**刻意沒有掛勾**（需要時再加，加之前先改這張表；`Lightbox`、篩選 chip、「未儲存」提示已在 P2 加入，見上表）：處理狀態堆疊條與甜甜圈的非嚴重度部分、`CopyPicker`、日期篩選的快捷 pill（用 `aria-pressed`）、紀錄詳情面板內部（面板本身是 `sheet`）。

### 3.4 圓角改成執行期 token（標準主題零視覺差異）

目前 `@theme inline` 會把 `--radius-sm/md/lg` 在建置時直接寫進 utility（`rounded-md` → `border-radius: 10px`），
cyber 沒辦法在執行期改。做法：

- `:root` 新增 `--r-sm: 6px; --r-md: 10px; --r-lg: 14px;`，`@theme inline` 改成 `--radius-sm: var(--r-sm)` 等。
- cyber 區塊設 `--r-sm: 2px; --r-md: 2px; --r-lg: 2px;`；`--radius-full` 不動（徽章、手機中央新增鈕維持圓形）。
- 驗收：標準主題的計算後樣式比對必須 0 差異（第 9.3 節）。

### 3.5 FX 小工具（`web/src/lib/fx/`）

只寫這幾個（P3 由原本的三個增為六個），不引入動畫套件：

| 工具 | 用途 | 無障礙做法 |
|---|---|---|
| `useFx()` | 判斷是否要播 JS 動畫（第 3.1 節） | — |
| `<ScrambleNumber value>` | 數字先亂跳再鎖定成真實值（FX-07） | 真實數字放在 `sr-only` 的 span；亂跳的那份是 `aria-hidden`，**動畫結束就移除**，之後 DOM 裡只剩一份數字（避免 `getByText` 找到兩個） |
| `useStagger(count, cap)` | 列表、長條的依序進場延遲，最多套用前 `cap` 項；回傳每項要展開的 `data-fx-in`＋`--i`（`useStaggerCap()` 給桌面 20／< 768 為 10 的上限） | 純視覺，不影響 DOM 順序 |
| `useReplayPhase(signature)` | 「不重掛的重播」：簽名改變時回傳的相位在 `"a"`／`"b"` 間翻面，呼叫端輸出成 `data-fx-phase`；簽名不變不重播 | 純屬性；DOM 節點與 `key` 不動，可聚焦元素不會被重掛、焦點不會掉 |
| `useGhostRows(rows, opRef)`／`ghostProps` | FX-31：`useFx()` 為 true 時，為被移除的列在原位置多留一個殘影節點 `GHOST_MS`（250ms）；`rows` 本身不變，API／快取／計數照原時機 | 殘影帶 `inert`＋`aria-hidden`＋`data-fx-ghost`，不可聚焦不可點；標準主題 DOM 不變 |

View Transitions API **只用於主題切換（FX-38）**：`themeToggle.tsx` 在 `useFx()` 條件成立且「切到 cyber」時才呼叫 `document.startViewTransition`；不支援的瀏覽器直接跳過，不加 polyfill。**換頁不使用 View Transitions（FX-02 已移除，理由見 §1 P3 設計簡報第 10 點）**——VT 進行期間真實 DOM 不可 hit-test，會吞點擊。

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
| 頁面標題 | 前綴 `~/`（`ink-muted`）。PageHeader 的 `<h1>` 在 < 768 是 sr-only，視覺標題是手機頂欄的 `<p aria-hidden>`，所以 `h1[data-fx="page-title"]` 的前綴只在 ≥ 768、`p[data-fx="page-title"]` 的前綴全寬度套用。**尾端閃爍游標（P3 實作，FX-03）**：標題的 `::after`（`content: "\2060 \258C" / ""`，不進輔助科技），1s `steps(1)` 閃爍，減少動態效果時常亮，標題 `nowrap` |
| 分段按鈕 | 選中的項目文字兩側 `[ ]`，**貼著文字、與文字固定間距 4px**（不貼按鈕兩端，手機也一樣），選中態另改成空心終端風（見下）。桌面（≥ 768，按鈕是橫排的「標籤＋筆數」）：括號是按鈕自己的 `::before`／`::after`，當作 flex 子項目排進內容前後（flex gap 6px，用 `-2px` margin 修成 4px），包住標籤與筆數；**所有**分段按鈕都有括號，未選中的用 `visibility: hidden` 佔位，所以選中與否文字位置不跳動、按鈕寬度一致。手機（< 768，按鈕直排，欄寬由 `auto-cols-fr` 等分）：括號絕對定位在標籤 `<span>`（第一個子元素）兩側，不佔版面、不改欄寬，括號 10px，按鈕最小寬度放大到 52px 才容得下括號。**選中態**：`accent-wash` 底＋1px `accent` 內框（`box-shadow: inset 0 0 0 1px var(--accent)`，不改尺寸）＋`accent-text` 字，嚴重度色條在深底上才清楚分辨 |
| 多選下拉的勾選 | 視覺上畫成 `[x]`／`[ ]`（隱藏方塊底、框與 `Check` 圖示；兩種狀態同寬 22px，選項不跳動）；語意（`role="option"`＋sr-only「（已選）」）不變，`[x]`／`[ ]` 只是 `aria-hidden` 的視覺 |
| 錯誤訊息 | 前綴 `ERR:`（critical 色） |
| 成功 toast | 前綴 `[OK]`；錯誤 toast 前綴 `[ERR]`。用 sonner 屬性選擇器（`[data-sonner-toast][data-type="success｜error"] [data-title]::before`，同樣要以 `:root[data-theme="cyber"]` 開頭）。toast 外觀 cyber 化：因 `Toaster` 在 cyber 傳 `theme="dark"`，sonner 深色主題會把底色變純黑，所以 cyber.css 把 `--normal-bg／--normal-border／--normal-text` 改回 token（surface-raised／line-strong／ink-1），錯誤 toast 框用 `critical`，圓角 2px |

**不加裝飾**：表格內容、紀錄文字、表單 label、按鈕文字本身。

### 5.3 面板

- `data-fx="panel"`：`surface-raised` 底、1px `line` 框、2px 圓角；hover 不變（面板本身不可點）。
- `data-fx="panel-cut"`（待處理／追蹤中 KPI 卡，可能是可聚焦的 `<button>`，0 筆時是 `<div>`）：右上與左下切角（大小 `--cut-md`，手機 `--cut-sm`），四角各有角框，顏色 `line-strong`：左上與右下兩個直角是 10px 的 L 形，**兩個切角（右上、左下）是連續的「折角括號」**——沿兩條直邊各一段 10px 的線，加上中間沿 45° 切角的 2px 斜線，三段相連成一個完整的角標（不是斷開的兩截）；
  **「待處理」大於 0 時**（`[data-fx-alert]`），角框改成 `serious` 色（P1 靜態；呼吸效果是 P3 的 FX-08，已實作）。
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

**例外與補充**：手機底部中央「新增」圓鈕（`data-fx="fab"`）**維持實心**（`accent` 底、`accent-ink` 圖示，不在 cyber.css 裡處理）；側欄的「新增紀錄」是 `Button` `primary`，照 `primary` 規格（透明底＋青框）。**框線一律用 `inset box-shadow`，不新增實體 `border`**：`primary`／`destructive` 在標準主題沒有 `border`，加實體框會讓自動寬度的按鈕多出 2px；用內側陰影則 cyber 與標準的按鈕 rect（寬高）完全相同（驗收：逐頁比對 `Button` 元件所有按鈕的 rect；唯一的差異來自 cyber 內文字型是等寬字，含英文字母的按鈕文字如「列印／另存 PDF」寬度略有不同，與框線無關。**這條「rect 相同」只涵蓋 `Button` 元件的框線**：分段按鈕群組在 cyber 可以變寬——桌面括號佔位使每顆 +24.81px，手機儀表板範圍選擇 min-width 52px，等寬字型也會使排序鈕、chip 等寬度改變，手機列表卡片高度 95→94——條件是不折行、320–1280 無橫向捲動、觸控目標不比標準小）。`secondary` 維持標準的 `border`，只改色。表單送出鈕（`data-fx="submit"`、`data-variant` 仍在）與 `AlertDialogAction／Cancel` 都涵蓋。

### 5.5 嚴重度與狀態

- 嚴重度色條（`[data-fx="sev"]`：`SeverityBadge` 的色條、手機卡片左側色條、圖例與篩選／表單選項前的色塊）加 4px 同色光暈（`box-shadow: 0 0 4px color-mix(in srgb, <嚴重度 token> 50%, transparent)`）。只有「重大」的光暈稍強（70%）。顏色依 `data-severity="輕微｜一般｜嚴重｜重大"` 對應 `good／warning／serious／critical`。**手機（< 768）光暈減半**：半徑 2px、透明度 ×.5（25%；重大 35%）。甜甜圈的弧是 SVG `<circle data-fx="sev">`，`box-shadow` 對 SVG 無效，改用 `filter: drop-shadow(0 0 <半徑> <同色>)`。
- 狀態符號 ○ ◐ ● 不變，顏色 `ink-2`。**不依狀態加任何色相**，維持「狀態用形狀」；符號跟隨 `currentColor`，所以所在元素本身改色時（例如分段按鈕選中態的 `accent-text`）符號會一起變，這是允許的。

### 5.6 焦點環

- 一般元素：`outline: 2px solid var(--accent-text); outline-offset: 2px`（與現行相同，只是顏色變青色）。**實作**：`index.css` base 層的 `:focus-visible` 已是這個值，cyber 的 token 讓它自動變青色（`#22e6ff`），所以 `cyber.css` **不另寫** `:focus-visible` 規則——`cyber.css` 沒放進 `@layer`，多寫一條會蓋掉元件自己的 `outline-hidden`（對話框、面板、彈出選單的容器）與 `focus-visible:outline-offset-0`（輸入框），把不該出現的外框叫回來。唯一的例外：手機底部分頁列貼著螢幕下緣，外環有一邊會落在螢幕外，cyber 下改成內縮（`outline-offset: -2px`）。另一個例外是日曆格（`cal-cell`）：格子彼此相鄰，環落在相鄰的第 3 級（`seq-700` 淺青）格上對比只有約 1.2:1，所以 cyber 下 `:focus-visible` 時外側墊一圈 `--page` 色（`box-shadow: 0 0 0 6px var(--page)`，環外緣在 4px 所以取 6px）並 `position: relative; z-index: 1` 讓它蓋在相鄰格上；環本身仍是 base 層的規則。
- 有切角（`clip-path`）的元素：outline 會被裁掉，改為在**外層包裝元素**上用 `:focus-within` 畫焦點框，或不在可聚焦元素本身加 `clip-path`。
  **規則：可聚焦的元素本身不加 `clip-path`。**

---

## 6. 動畫清單

### 6.1 共通規則

1. **只動 `transform`、`opacity`、`clip-path`**（外加光暈 `box-shadow` 的淡入淡出）。不動 `width`、`height`、`top/left`——例外：長條圖寬度只在進場時用 `transform: scaleX()` 做，不改 `width`。
2. **不擋輸入**：動畫期間元素一律可點；中途再點，取消目前動畫、以新操作為準。
3. **閃爍上限**：任何閃爍或 glitch 每秒不超過 3 次，而且只播一次（游標閃爍是每秒 1 次；P4 起改為打字後閃 3 次就停在常亮，不再常駐）。
4. **依序進場最多 20 項**：超過的直接出現，不排隊。
5. **減少動態效果**：CSS 由 `index.css` 現有的全域規則處理；JS 動畫（`ScrambleNumber`、`useStagger`、`useReplayPhase`、`useGhostRows`、主題切換的 View Transitions）在 `useFx()` 為 false 時直接顯示最終狀態。
6. **測試環境**：jsdom 中 `useFx()` 為 false，所有測試看到的都是最終狀態。
7. **（P2 追加）可點元素的進場不得用 `clip-path`**：`clip-path` 會讓 hit-test 跟著被裁掉，進場中點不到按鈕（FX-22 實測發現）；進場用 `transform`／`opacity`。`clip-path` 只用在不可點的裝飾（偽元素、打字式顯示的純文字）與不會被點擊的浮層展開。
8. **（P2 追加）基礎樣式即最終狀態**：`@keyframes` 只寫起始影格（或明確 `to` 回到基礎樣式），不用 `animation-fill-mode: both`（依序淡入的 `backwards`、退場的 `forwards` 為例外），這樣減少動態效果把 duration 壓到 0.01ms 後畫面就等於靜態外觀；`@keyframes` 名稱一律 `cyber-` 前綴；`infinite` 只有白名單內的（FX-33、FX-35、FX-08、標題游標、FX-25、FX-26、FX-32，依 `@keyframes` 名稱比對）。
9. **（P3 追加）不重掛可聚焦元素來重播動畫**：用 `useReplayPhase` 翻面 `data-fx-phase`（或屬性值交替如 `data-fx-copied`）換 `animation-name`，不以資料／月份當 `key`。
10. **（P3 追加）View Transitions 只用於主題切換**：換頁不使用（FX-02 已移除）；`pointer-events: none` 對 `::view-transition-*` 無效。

### 6.2 清單

「做法」欄：CSS＝只靠 cyber.css；JS＝需要 `lib/fx/`；VT＝View Transitions。

| ID | 元件（檔案） | 觸發 | 效果 | 時間／曲線 | 做法 |
|---|---|---|---|---|---|
| FX-01 | 開機畫面（`BootScreen.tsx`，由 `AppShell.tsx`／儀表板載入狀態使用） | App 冷啟動、儀表板資料**還在載入時** | **（P3 實作）** 取代骨架的「視覺」：逐行印出終端機風格的載入步驟（`aria-hidden`，最後一行帶游標）；載入狀態的無障礙文字（`role="status"`、`aria-busy`、「載入中…」）與骨架相同。**載入不到 150ms 完全不顯示**；資料一到立刻由內容取代；按任意鍵或點擊跳過（不吞按鍵）；每個瀏覽器分頁只出現一次（`sessionStorage`），換頁、重新整理都不再出現；只在 cyber 且 `useFx()` 時渲染 | 每行 120ms（`--stagger-boot`）；**不會延長載入時間** | JS＋CSS |
| FX-02 | 換頁（全部路由） | 點導覽連結、`drill.ts` 帶篩選跳轉 | **（評估後移除，P3 未實作）** 原設計為舊頁水平切片 glitch 淡出、新頁由上而下掃描線。移除理由：View Transitions 期間真實 DOM 不可 hit-test，縮到最短（退 40＋進 100，約 240ms）仍吞點擊約 250ms，違反總原則 2 與 M3；`pointer-events: none` 對 `::view-transition` 無效（實測）。Sidebar、MobileChrome、`drill.ts` 都**不帶 `viewTransition`**；換頁只有 FX-03 與 FX-04 | — | — |
| FX-03 | 頁面標題（`PageHeader.tsx`、手機頂欄） | 換頁 | **（P3 實作）** 打字式顯示：`clip-path: inset(0 100% 0 0)` → `inset(0)`，用 steps 分段（步數＝字數，`--chars` 由 `titleTypeProps` 在 `useFx()` 時輸出，上限 16）；文字從一開始就完整存在於 DOM。尾端游標為 `::after`（`content: "\2060 \258C" / ""`），`steps(1)` 1s 閃爍常駐，減少動態效果時常亮；標題 `nowrap`（不被游標擠成兩行，320 寬已驗）。與 FX-38 的 VT 重疊接受 | 每字 18ms（`--dur-char`），上限 288ms；游標 1 次／秒 | CSS（＋`--chars`） |
| FX-04 | 側欄／圖示列（`Sidebar.tsx`、`NavIndicator.tsx`） | 換頁 | **（P3 實作）** `nav-indicator`（`data-fx-indicator`）高亮條從舊位置滑到新位置，位置由目前路由量出的 `--nav-y` 決定，首次渲染不播動畫；桌面為整個項目高度的 2px 青線（與 `>` 前綴並存），768–1023 改為垂直短條並取代 P1 內側直條，< 768 不顯示；沒有目前頁時淡出 | 220ms `--ease-out` | CSS＋JS（只量位置） |
| FX-05 | 導覽項目 hover | 滑鼠移入 | 文字變 `ink-1`，左側 2px 青線由上往下長出 | 150ms | CSS |
| FX-06 | 手機底部分頁列（`MobileChrome.tsx`） | 點分頁 | 目前頁的分頁上緣出現 2px 青線（由中間向兩側展開）；中央「新增」圓鈕按下時外圈擴散一圈青色細環。**（P2 實作）** 擴散環畫在新增鈕連結 `<a href$="/records/new">` 的 `::after`（56px、`top: -24px`，對齊凸出圓鈕；`pointer-events: none`，`:active` 期間播放），不選 `data-fx="fab"`；與 `MobileChrome` 的 FAB class 以測試綁定 | 150ms／300ms | CSS |
| FX-07 | KPI 數字（`KpiCards.tsx`、`lib/fx/ScrambleNumber.tsx`） | 資料載入完成、切換範圍（全部／本月／本週） | **（P3 實作）** 數字亂跳 6～8 次後鎖定成真實值；真實數字在 `sr-only` span，亂碼層 `aria-hidden` 並於結束後移除；只套 KPI 數字，切換範圍重播 | 400ms | JS（`ScrambleNumber`） |
| FX-08 | 主要 KPI 卡（待處理） | 待處理 > 0 時持續 | **（P3 實作）** `[data-fx-alert]` 的 HUD 角框（`::after`）以 `serious` 色緩慢呼吸（透明度 .5 ↔ 1）；`infinite` 白名單之一；減少動態效果時停在 1 | 2.4s 一循環；**不是閃爍** | CSS |
| FX-09 | 橫條圖（`charts.tsx` `HBarChart`） | 進場、切換範圍 | **（P3 實作）** 長條由左往右長出（`scaleX` 0→1，`transform-origin: left`，寬度計算不變），每條依序（`useStagger`）；切換範圍以 `useReplayPhase` 翻面 `data-fx-phase` 重播，**按鈕不重掛** | 400ms（`--dur-slow`）＋`--stagger` | CSS＋JS（延遲） |
| FX-10 | 長條列 hover／焦點 | 滑鼠、Tab | 整列 `accent-wash` 底，長條加 `--glow-accent`。**（P2 實作）** 長條原本在 `overflow-hidden` 的軌道裡，光暈會被裁掉，所以新增 `bar-track` 掛勾，cyber 下軌道 `overflow: visible` | 150ms | CSS |
| FX-11 | 長條列點擊（帶篩選跳到列表） | 點擊（滑鼠、觸控） | **（P3 實作）** `bar-row` 的 `::before` 在 `:active` 時畫出四角洋紅 L 形角框，由大縮小「鎖定」，與跳轉同步，**不延後跳轉**；FX-02 移除後，角框只在按下的瞬間可見。**鍵盤 Enter 不觸發角框、不加 JS** | 角框 200ms | CSS（`:active`，不加 `setTimeout`） |
| FX-12 | 每日趨勢柱 | 進場、切換範圍 | **（P3 實作）** 由下往上長出（`scaleY`），依序；切換範圍以 `data-fx-phase` 重播，不重掛 | 300ms＋20ms 間隔 | CSS＋JS |
| FX-13 | 圓餅／其他非長條圖（甜甜圈） | 進場、切換範圍 | **（P3 實作）** 整張淡入＋掃描線劃過一次；切換範圍以 `data-fx-phase` 重播 | 300ms | CSS |
| FX-14 | 日曆格（`CalendarPage.tsx`） | 進場、換月 | **（P3 實作）** 格子沿對角線依序淡入（左上→右下，最多 12 道）；換月時整張水平 glitch 一次（`transform`，`data-fx-in="glitch"`），以 `data-fx-phase` 重播、**table 不重掛**；< 768 只淡入 | 每道 10ms，總長 ≤ 270ms（< 400ms） | CSS＋JS |
| FX-15 | 日曆格 hover／焦點 | 滑鼠、Tab | 格子加 `--glow-accent` 外框 | 150ms | CSS |
| FX-16 | 紀錄列表列（`RecordList.tsx`） | 進場、篩選結果變化 | **（P3 實作）** 前 20 列（< 768 為 10）由左 8px 淡入，**只有新出現的列進場**，捲動中不重播；hover 時左側出現 `▶`（`aria-hidden`，`content` 帶 `/ ""`，不佔版面），整列 `accent-wash`；虛擬化／分頁行為不變 | 150ms＋`--stagger` | CSS＋JS |
| FX-17 | 篩選 chip（`FilterBar.tsx`） | 新增 | **（P2 實作，僅新增）** 新增：`clip-path` 由左展開（`data-fx="chip"`，150ms）。**移除：直接消失，不做動畫**（移除動畫要延後卸載；**P3 評估後不做**，維持直接消失） | 150ms | CSS |
| FX-18 | 多選下拉、日期篩選（`MultiSelectFilter.tsx`、`DateRangeFilter.tsx`、`ui/popover.tsx`） | 開、關 | 從觸發按鈕的位置用 `clip-path` 由上往下展開；關閉反向 | 開 150ms／關 100ms | CSS（Radix `data-state`） |
| FX-19 | 分段按鈕（`SegmentedControl.tsx`） | 選取 | **（P2 實作，已與括號常駐對齊）** 新選中項的 `[ ]` 括號各從外側 4px 收回定位並淡入（`cyber-bracket-l`／`cyber-bracket-r`，只動 `transform`／`opacity`）；括號最終位置與 P1 相同，沒有「滑過」其他選項的軌跡 | 150ms | CSS |
| FX-20 | 詳情面板（`RecordDetailSheet.tsx`、`ui/sheet.tsx`） | 開、關 | 由右滑入（現有），加上一條 2px 青色橫線由面板頂掃到底並淡出（`sheet` `data-side="right"` 的 `::after`，只動 `transform: translateY`，`--dur-slow`，不用 `clip-path`）；內容區塊（`detail-body` 的直接子元素）依序淡入（標題→標籤→事實格→處理→照片）；關閉時退場縮短為 100ms（`--dur-close`，Radix 等退場動畫結束才卸載） | 每段 200ms、間隔 30ms，延遲分 6 檔（第 8 個之後共用最後一檔），最晚一段收尾 ≤ 350ms | CSS |
| FX-21 | 詳情面板上一筆／下一筆 | 點擊 | **（P2 裁定）改為「切換紀錄時重播 FX-20 的內容依序淡入」**：`DetailBody` 本來就以 `key={r.id}` 重新掛載，所以淡入自然重播；**不分前後方向、沒有獨立的 glitch**，沒有加任何 key，按鈕與標題列行為不變；內容全程可點 | 同 FX-20（最晚 ≤ 350ms） | CSS |
| FX-22 | 確認對話框（`ConfirmDialog.tsx`、`ui/alert-dialog.tsx`） | 開啟 | 遮罩淡入（Tailwind 現有）；對話框 glitch 進場一次、退場 100ms 淡出；**破壞性的**（`data-variant="destructive"`，所有 destructive 確認框，不只永久刪除；**未新增 `data-fx-tone`**）加 4px `critical` 斜紋上緣（`::before`，不佔版面）與 `--glow-critical`。**進場 glitch 用 `transform`／`opacity`，不用 `clip-path`**（`clip-path` 會讓 hit-test 吞掉進場中的點擊，實測發現並修正）；對話框置中用的是 Tailwind 個別的 `translate` 屬性，與動畫的 `transform` 不衝突 | 開 200ms／關 100ms | CSS |
| FX-23 | 表單輸入框（`fields.tsx`、`Combobox.tsx`） | 聚焦 | 框線變 `accent`＋`--glow-accent`（輸入框、文字區、下拉都有）。**`>` 提示符只有 `Combobox` 外層（`data-fx="combobox"` 的 `::before`，絕對定位在輸入框左側內距裡，不改版面）有**；其餘輸入框只有框線＋光暈（輸入框本身不能有偽元素） | 150ms | CSS |
| FX-24 | 表單驗證錯誤 | 送出失敗、欄位驗證失敗 | 欄位水平抖動一次（±4px，3 下）＋`--glow-critical`；錯誤訊息（`error-msg`）加 `ERR:` 前綴並以 `clip-path` 打字式顯示（文字一開始就在 DOM）。**抖動在 `aria-invalid` 出現時觸發，同一個錯誤第二次提交不重播**（屬性一直存在，animation 不重啟） | 抖 240ms／字 200ms | CSS |
| FX-25 | 送出按鈕（`RecordForm.tsx`） | 送出中（現有的進行中狀態） | **（P3 實作）** 在 cyber 且 `useFx()` 時，以 `aria-hidden` 的 ASCII 進度條 `[████░░]`（`data-fx-progress`）循環跑動取代旋轉圖示（**進度不明，不假裝百分比**）；按鈕文字與 disabled 狀態不變，rect 與標準送出中相同；`infinite` 白名單之一 | 循環 900ms | CSS＋JS（只決定是否渲染） |
| FX-26 | 照片上傳（`PhotoField.tsx`、`PhotoThumb.tsx`） | 上傳中 | **（P3 實作）** 縮圖上 `data-fx-scan` 覆蓋層，來回跑的掃描帶取代旋轉圖示的視覺（旋轉圖示與 sr-only「上傳中」保留）；`infinite` 白名單之一 | 循環 1.2s | CSS |
| FX-27 | 「從過去紀錄帶入」（`CopyPicker.tsx`、`RecordForm.tsx`、`fields.tsx`） | 選定、帶入 | **（P3 實作）** 被帶入的欄位依序閃一次 `accent-wash` 底；`RecordForm` 只多一個純展示狀態 `{ n, fields }`，`Field` 渲染 `data-fx-copied="a"／"b"`，屬性值一變 CSS 選到的 keyframes 就換，**不重掛輸入框**，表單值、驗證、焦點不變 | 每欄 200ms，間隔 40ms | CSS＋最少量狀態 |
| FX-28 | 嚴重度自動建議（`SegmentedControl.tsx`、`RecordForm.tsx`） | 打耗時後建議值變化 | **（P3 實作）** `SegmentedControl` 加 optional `suggestedValue`，該選項渲染 `data-fx-suggested=<選項值>`；cyber 下屬性出現時閃一次對應嚴重度色光暈；`RecordForm` 接既有的 `suggestSeverity(duration)`，只做展示，資料流不變；標準主題沒有規則吃這個屬性 | 300ms，一次 | CSS |
| FX-29 | Toast（`ui/sonner.tsx`、`lib/feedback.ts` 不動） | 出現 | **（P2 實作）** 進退場的滑動沿用 sonner 自己的（不覆寫）；左側 3px 狀態色條（畫在 `[data-content]::before`，因為 toast 本身的偽元素被 sonner 用掉）；標題打字式顯示（`clip-path`，文字一開始就在 DOM）；錯誤 toast 紅色框閃一次（swipe-out 時不蓋掉 sonner 的 animation） | 打字 ≤ 300ms（實際 200ms）、錯誤框 `--dur-base` | CSS |
| FX-30 | 可復原 toast 的〔復原〕 | 按下 | 按鈕 `accent` 底（靜態狀態）＋`box-shadow` 光暈閃一次後 toast 照原流程消失（滑鼠按下後的焦點留到 toast 離開，所以不被截斷；鍵盤聚焦不觸發） | 120ms | CSS |
| FX-31 | 回收桶（`TrashPage.tsx`） | 復原、永久刪除成功後 | **（P3 實作，條件全部成立）** 被移除的列留 250ms 視覺殘影後溶解：復原垂直收起、永久刪除水平收起（`useGhostRows`，`useFx()` 為 true 才產生）；API、查詢快取、計數、徽章都照原時機更新（`rows` 不變）；殘影 `inert`＋`aria-hidden`＋`data-fx-ghost`，不可聚焦不可點；`TrashPage` 改動約 20 行；焦點落點與標準相同；標準主題／reduced-motion／jsdom 的 DOM 與原本相同 | 250ms | CSS＋JS（`useGhostRows`） |
| FX-32 | 匯出 Excel（`useExportAction.ts` 的進行中狀態；`nav-item[aria-busy="true"]`） | 匯出中 | **（P3 實作）** 依現有 `aria-busy` 用 CSS 在匯出項目文字旁循環 `▮▯▯`→`▮▮▯`→`▮▮▮`，不加任何狀態；`infinite` 白名單之一；768–1023 圖示列不顯示 | 循環 900ms | CSS |
| FX-33 | 骨架載入（`ui/skeleton.tsx`） | 載入中 | 灰塊改成 `line-strong` 色的斜紋 `▒` 紋理（靜態），左到右掃光（偽元素 `translateX`）循環；標準骨架的整塊 opacity 脈動在 cyber 下關掉。**P2 兩個 `infinite` 動畫之一**；減少動態效果時掃光停在看不見的位置 | 1.6s 循環（與現行同頻率） | CSS |
| FX-34 | 錯誤狀態（`ErrorState.tsx`） | 載入失敗 | 標題 glitch 一次；重試按鈕照原樣 | 280ms，一次 | CSS |
| FX-35 | 設備對照設定（`SettingsPage.tsx`） | 有未儲存變更 | 「未儲存」提示（`unsaved`）左側 `serious` 色條緩慢呼吸（透明度 1 ↔ .35，不是閃爍）。**P2 兩個 `infinite` 動畫之一** | 2.4s 循環 | CSS |
| FX-36 | 燈箱（`Lightbox.tsx`） | 開、切換照片 | **（P2 實作）** 開啟：`scaleY`（由 .96）＋`opacity` 展開像 CRT 開機（不用 `clip-path`）。**（P3 實作）切換照片**：`<img key={src}>` 重新掛載，只做新圖淡入；燈箱焦點、左右鍵、Esc 不變（標準主題也以 src 為 key，視覺不變） | 開 200ms／切換淡入 | CSS |
| FX-37 | 所有按鈕的按壓 | `:active` | `scale(.97)`＋背景亮一下：用 `inset` 疊色（`box-shadow: inset 0 0 0 999px var(--press-wash)`，與原本的內框、光暈合併成同一個宣告），不改尺寸；涵蓋 `button`／`submit`／分段按鈕，只作用於 `:not(:disabled)` | `--dur-instant` | CSS |
| FX-38 | 主題切換（D1 的按鈕，`themeToggle.tsx`） | 切換 | **（P3 實作）** 僅「切到 cyber」且未減少動態效果、瀏覽器支援 VT 時：`<html data-vt="theme">`，新畫面 `clip-path` 由上往下露出一次（舊畫面不動，**無獨立發光線**）；切回標準不播；reduced-motion 不播 | 300ms | VT |

**P2 範圍調整一覽**：FX-28、FX-31 移 P3；FX-17 僅新增；FX-21 與 FX-20 合併；FX-36 僅開啟。其餘 P2 項目照上表實作。

**P3 實作（一覽）**：FX-01、03、04、07–09、11–14、16、25–28、31、32、36（切換照片）、38 皆已實作；**FX-02 評估後移除**；FX-17 移除動畫不做。FX-27／28／31 細節見 §1「2026-10-30 P3 塊 C 後半裁定」；其中 FX-27／28／31 沒有新增 `infinite`，只動 `box-shadow`（光暈）、`clip-path`／`opacity`（殘影不可點）；列印以 `revert-layer` 還原。

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
| 768–1023（圖示列） | 目前頁（`[aria-current="page"]`）左側 2px `accent` 內側直條（`box-shadow: inset 2px 0 0 var(--accent)`，P1 靜態，不是 `nav-indicator`；1024 以上維持 `>` 前綴）；`nav-indicator`（P3，FX-04）改成垂直方向的短條並取代這條內側直條；tooltip 用 cyber 外觀（`surface-raised` 底、青框），不再是 `ink-1` 底 |
| < 768（手機） | 掃描線透明度降為 0.015；光暈減半；依序進場上限降為 10 項；FX-14 日曆只淡入不跑對角；切角改小（`--cut-sm`）；**觸控目標 44px 規則不變** |
| 320 | 不能出現橫向捲動（裝飾前綴要計入寬度；品牌字「產線日誌」不能換行成直排） |

---

## 8. 列印與報表

1. `ReportDocument.tsx` 內的元素**不加任何 `data-fx`**；`report.css` 不改。
2. `cyber.css` 檔尾的 `@media print`：把掃描線、點陣背景、光暈、切角、裝飾前綴全部移除，並**還原全部色彩 token 與 `--r-*`**（值等於標準淺色 `:root`）、設 `color-scheme: light`、body 字型回標準；`body` 用 `background: var(--page); color: var(--ink-1)`（token 還原後即標準淺色的 `#f9f9f7`／`#0b0b0b`），所以 **cyber 列印 ≡ 標準淺色列印**——即使使用者在 App 頁面（不是報表）按列印，也不會印出黑底。（註記：此處與原文「`html, body` 背景回白色」有差異：為了做到與標準淺色列印逐元素一致，實作改用標準淺色的 `--page`／`--ink-1`，而不是純白純黑。之後各期新增的 cyber token 與裝飾，都要在這個區段同步還原；`cyberCss.test.ts` 檢查 print 區段的 token 涵蓋 cyber 區塊全部色彩 token 且值等於標準淺色 `:root`。）
2a. **P1 新增的裝飾如何還原**：`@media print` 區段內，所有 `[data-fx]` 元素（含 `::before`／`::after`）用 `all: revert-layer` 退回 Tailwind 層的值（`cyber.css` 沒放進 `@layer`，`revert-layer` 會退到最後一個具名層，也就是標準主題的樣式）；選擇器加 `:not(#cyber-print)` 把特異度拉高，壓過螢幕規則的 `:hover`／`:not(:disabled)`。沒有 `data-fx` 但被改動的元素逐項還原：分段按鈕（`position`、`[ ]` 前後綴）、勾選的 `svg`（`display`）、欄位輸入框（`border-color`）、toast（前綴 `content: none`、圓角 8px、錯誤框、sonner 淺色主題的 `--normal-*` 字面值、關閉鈕）。點陣 `background-image: none`、`body::after { display: none }`。**P2 的動畫與 transition**：對所有元素與偽元素用 `animation: revert-layer; transition: revert-layer`（不用 `none`，標準主題本來就有的 Tailwind 動畫與 transition——`transition-colors`、`animate-in`、`animate-spin`——列印時要保留，computed style 才與標準淺色逐項相同；cyber 自己加的動畫在標準層沒有對應值，會退成 `none`）；sonner（toast）整棵子樹的 transition／animation 是執行期插入的無層級樣式，`revert-layer` 會連它的一起退掉，所以該子樹只做 `animation: none`。**驗收做法**：用 CDP 把頁面切到 print media（`Emulation.setEmulatedMedia`），逐元素（含 `::before`／`::after` 的 `content` 與完整 computed style）比對標準淺色與 cyber（系統深色／淺色各一次）；儀表板、列表、新增表單（含驗證錯誤）、日曆、回收桶、確認對話框、設定、報表（含 `#report-output`）、詳情面板、多選下拉、tooltip、toast 全部 0 差異（主題切換鈕因為狀態不同，色彩本來就不同，排除）。
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
| A6 | cyber.css 每條規則都以 `:root[data-theme="cyber"]` 開頭（讀檔、逐條檢查選擇器）；所有 `content:` 宣告都有 `/ ""` 替代文字。P1 的靜態斷言（無 `@keyframes`／`transition`、無 `clip-path` 動畫等）**只掃 `/* === P2 START === */` 之前**；P2 區段另有斷言（動畫只動 `transform`／`opacity`／`clip-path`／光暈 `box-shadow`、`@keyframes` 名稱 `cyber-` 前綴、`infinite` 白名單依 `@keyframes` 名稱比對（FX-33、FX-35、FX-08、標題游標、FX-25、FX-26、FX-32，白名單外一律失敗）、可點元素進場不用 `clip-path`、`pointer-events: none` 只用在偽元素、print 區段還原 P2 動畫、沒有 `fab` 的選擇器） | 新的 `cyberCss.test.ts` |
| A7 | `ReportDocument` 的輸出中沒有任何 `data-fx`／`data-variant`／`data-fx-alert`；`report.css` 的列印選擇器仍在（沿用現有測試） | `ReportDocument.noFx.test.tsx`（新）、`ReportDocument.test.tsx`；整頁（`ReportPage`）版本在 `test/dataFx.test.tsx` |
| A8 | P0 之前既有的 408 個前端測試、169 個後端測試**不修改就全部通過**（只允許因 `data-fx` 屬性造成的快照差異，若有快照）。前端測試數量基準：P0 前 408 個、P0 後 503 個、P1 後 565 個、P2 後 601 個（32 個檔案；後端 169 個；均為實測；之後各期以實測為準） | — |

### 9.2 無障礙

| # | 條件 |
|---|---|
| B1 | 開啟系統「減少動態效果」：cyber 主題下沒有任何移動、閃爍、亂碼；只剩顏色與靜態外觀 |
| B2 | 螢幕閱讀器（NVDA 或 VoiceOver）在 cyber 與標準主題下，唸出的導覽、按鈕、KPI、列表內容**完全相同**（不會唸出 `>`、`//`、`[OK]`、亂碼數字） |
| B3 | Tab 走過所有頁面：每個可聚焦元素的焦點環都完整可見（包含切角面板內的元素）；焦點環與背景對比 ≥ 3:1。**判定以「cyber 沒有比標準主題更差」為準**：側欄連結、列表列、趨勢柱的焦點環被 `overflow` 裁掉是標準主題既有狀況，不在 cyber 範圍。日曆格是例外，已處理：`:focus-visible` 時外側墊 `--page` 色外暈（`0 0 0 6px`）並 `z-index: 1`，環對相鄰第 3 級格的緊鄰像素 ≥ 3:1 |
| B4 | 詳情面板、對話框、手機「更多」面板：焦點鎖定、Esc 關閉、焦點回到觸發元素，行為與標準主題相同（`CLAUDE.md` 手動驗證第 2 點全部重做一次） |
| B5 | 沒有任何每秒超過 3 次的閃爍（逐一檢查 FX-08、22、24、29、34）。B5 針對的是自發或循環的閃爍；使用者每次操作觸發的一次性動畫（含連點造成的重播）不受「每秒 3 次」限制 |

### 9.3 標準主題零差異

| # | 條件 |
|---|---|
| C1 | 用逐元素比對計算後樣式的腳本（做法同當初報表比對：位置、字型、字級、行高、顏色、邊框、圓角），在**標準淺色與標準深色**、寬度 375／900／1280，比對儀表板、列表、新增表單、詳情面板、日曆、回收桶、設定、報表頁：**0 差異**（`data-fx` 屬性本身不算） |
| C2 | 列印報表：cyber 主題下按「列印／另存 PDF」，與標準主題的 PDF 逐頁一致；開新視窗的報表與標準主題一致 |

### 9.4 效能

| # | 條件 |
|---|---|
| P1 | 中階 Android 手機（或 Chrome DevTools 4× CPU 降速）：捲動紀錄列表、開關詳情面板，**相對標準主題不低超過 3fps**（P3 修訂：4× CPU 降速下標準主題本身已低於 50fps，絕對值改以相對差為準）；任何 FX 不造成 > 50ms 的長任務。**P3 實測結果：開關詳情面板未達標，經設計裁定接受**（見下方〈P1 實測與裁定〉） |
| P2 | cyber 動畫不造成版面位移（CLS = 0） |
| P3 | 打包大小：`web/dist` 的 JS 增加 ≤ 8KB（gzip），CSS 增加 ≤ 12KB（gzip）；不新增任何 npm 相依套件 |
| P4 | 冷啟動到內容出現的時間，cyber 與標準主題差異 ≤ 50ms（FX-01 不能延後內容） |

**P1 實測與裁定（P3，4× CPU 降速、headless Chrome、開關詳情面板 6 次循環，中位數，n=5）**

| 量測 | 寬度 | A | B | 差 |
|---|---|---|---|---|
| 最終：P3 的增量（A、B 皆用 `?theme=cyber`，B 為 P3 完成後、A 為 P3 之前基線） | 1280 | 896ms／44.6fps | 1091ms／41.5fps | +195ms，fps −3.1 |
| 同上 | 375 | 665ms／48.3fps | 772ms／47.2fps | +107ms，fps −1.1 |
| 中途（perf-d2）：標準主題 A 對 cyber B | 1280 | 634ms／46.9fps | 1031ms／41.6fps | +397ms，fps −5.3 |
| 同上 | 375 | 510ms／51.7fps | 724ms／47.3fps | +214ms，fps −4.4 |
| 修正前（D 之前）cyber | 1280 | — | 1362ms／34.6fps | — |

- **誠實註明**：最終兩行的 A 是 cyber 基線，量的是 P3 增量；**sheet-sweep 錯開與移除 VT 之後，沒有再與標準主題 A 重新量測**。中途那兩行的標準 A 對 cyber，是錯開之前的數字（1280 +397ms、−5.3fps）。因此「cyber 對標準」的最終差距只能估計：介於 +195ms 與 +397ms 之間，1280 fps 差約 3~5。
- **捲動紀錄列表**（主執行緒成本，ms／秒，fps 皆 60；headless rAF 無法區分兩者）：1280 A 63.4 對 B 96.6（B 多出樣式重算 13.8ms 與 scripting）；375 A 70.2 對 B 121.6。
- **歸因診斷**（全 keyframes 關閉的 `noanim` 對照）：`cyber-fade-in` 與 `cyber-sheet-sweep` 同時觸發約占 −216ms（後者已改為延後到淡入結束後）；偽元素（`::before`／`::after`，含 `body::after` 約 −65ms）靜態成本約 −185ms；`kfType` −35ms；`clip-path`、`box-shadow`、`filter` 各約 −15~−47ms；`will-change` 約 −15ms、`transition` 約 +8ms（無顯著影響）。**全部 keyframes 關閉後，cyber 仍比標準高約 +105ms，此為靜態 CSS 成本**（1280 `A_noanim` 495ms 對 `B_noanim` 737ms 為 perf-d2 中途版本的原始對照數字）。
- **裁定**：cyber 為 opt-in 主題，經設計裁定接受開關詳情比標準多約 195~397ms（4× CPU 降速）、fps −3~5；靜態 CSS 成本約 +105ms（全 keyframes 關後 B 仍比 A 高）屬主題固有成本（切角偽元素、發光、掃描線背景）。
- **未採用的候選（留作 P4／後續）**：(a) 暫停背景掃描線（`body::after`，約 −65ms；維持 P1 設計，等使用者真機實測再決定）；(b) 減少偽元素數量；(c) `cyber-fade-in` 與 `cyber-sheet-sweep` 二選一。證據：`perf-d2/agg-trace.txt`、`perf-d2/var-agg.txt`、`perf-d2/anim.json`、`perf-final/agg-*.txt`。

**P4 量測（最終 HEAD 對標準主題 A，4× CPU 降速、headless Chrome、開關詳情面板 6 次循環，中位數，n=5；同一機器同一天的兩批獨立量測）**

| 批次 | 寬度 | 標準 A | cyber B | 差 |
|---|---|---|---|---|
| 1 | 1280 | 880ms／39.7fps | 1617ms／33.8fps | +737ms，fps −5.9 |
| 1 | 375 | 648ms／44.7fps | 1263ms／38.3fps | +615ms，fps −6.4 |
| 2 | 1280 | 1039ms／36.2fps | 1763ms／31.4fps | +724ms，fps −4.8 |
| 2 | 375 | 599ms／47.3fps | 1026ms／42.7fps | +427ms，fps −4.6 |

- 這取代上方 P3 以 cyber 對 cyber 的增量數字。cyber 比標準多約 **+430～+740ms（約 1.7～1.95 倍）、fps −4.6～−6.4**；比 P3 當時的中途數字（+397ms）差，因為當天機器較慢（標準本身 599～1039ms，P3 當時 634ms），只能比相對值，不能比絕對值。M3 類操作的行為沒有改變，結論與 P3 裁定相同（opt-in 主題，接受）。
- **掃描線浮層旗標實驗（real toggle，n=5＋n=8 合併 n=13，1280）**：旗標開（B）1840ms 對 旗標關（Boff）1871ms，**僅 −30ms**（兩批各 −92／−12；375 +30ms），未達 40ms，撤掉。上界（`display: none`）約 −122ms／−128ms，但包含了把整層永遠拿掉的成本差，與實際切換不同。
- **捲動列表（ms／秒，主執行緒，4×，n=5）**：游標常駐循環時（P4 之前）1280 標準 106.8、cyber 191.7、cyber＋`animation: none` 110.4；375 標準 170.5、cyber 284.9、cyber＋`animation: none` 164.4（約 +80%／+67%）；`/records` 上唯一執行中的動畫是標題游標（`getAnimations()` 確認），`display: inline-block`、`will-change`、`translateZ(0)`、線性時序改寫都沒有降低。**游標改為閃 3 次後常亮（見 §1）、等到閃完之後量測**：1280 標準 70.8、cyber 77.0（**+8.8%**）；375 標準 103.6、cyber 124.6（**+20.3%**，剛好在 +20% 邊緣）；樣式重算回到 0。目標 ≤ 標準 +20%：1280 達標、375 約達標。真實滾輪（compositor）捲動在游標常駐時每秒約 43～63ms 樣式重算（標準為 0）。注意：游標閃 3 次的那幾秒內仍會有每幀樣式重算，只是不再常駐。
- **冷啟動 P4（4×，n=15，到內容出現，中位數）**：標準 1466ms、cyber 乾淨 1580ms（+113）、cyber 已開機 1594ms（+128）；1× 未重測。今天的機器比 P3 慢（標準 1216ms），差距以相對值看：仍**超出 50ms**。對照（n=10，已開機）：關閉全部動畫 1630、關閉掃描線 1712、關閉偽元素 1677、關閉陰影／光暈 1752，標準 1471、cyber 1621——都在雜訊內，沒有任何一項是主因；主執行緒 4.5 秒的追蹤顯示 cyber 多 `FunctionCall` ≈ +298ms、`Paint` +103ms、`UpdateLayoutTree` +93ms（含內容出現後的動畫與數字亂碼）。
- **大小（P3 指標，對 main）**：JS +0B、CSS +5B（gzip）；沒有新套件。
- 證據：`scratchpad/followup/p4/`（`res-p4a/b/c.json`、`res-scroll-b.json`、`res-cold-4.json`、`coldtrace.log`）。

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
| **P1 靜態外觀**<br>已合併（PR #41） | `data-fx` 掛勾、面板／切角／按鈕／焦點環／裝飾前綴、背景點陣與掃描線（靜態） | 第 5 節 | A6、A7、B2、B3、C1、M2 |
| **P2 微互動與浮層**<br>已合併（PR #42） | hover、按壓、聚焦、彈出選單、面板、對話框、toast、錯誤、骨架等純 CSS 動畫 | FX-05、06、10、15、17（僅新增）、18–24、29、30、33–37（FX-36 僅開啟） | B1、B4、B5、P1、P2、M3 |
| **P3 招牌效果**<br>已合併（PR #43） | 開機畫面、數字鎖定、長條／趨勢／日曆／列表依序進場、標題打字與游標、nav-indicator、帶入閃爍、主題切換掃描（**換頁 View Transitions〔FX-02〕評估後移除**，見 §1） | FX-01–04、07–09、11–14、16、25–27、32、38，以及自 P2 移入的 FX-28（先加「被建議」prop）、FX-31（要延後卸載，P3 判斷能否不延後 API 呼叫，不行就放棄）；FX-17 的「移除」動畫評估後不做；FX-36 的「切換照片」以 `<img key={src}>` 淡入實作 | A5、P3、P4、M1、M5 |
| **P4 效能與列印收尾**<br>待合併 | 列印邊緣（匯出中圖示 `visibility` 還原）；其餘效能項目量測後未達標，見 §1「P4 設計裁定」與 §9.4〈P4 量測〉 | §9.4 | C1、列印、P3 大小 |
| 修正（非分期）<br>已合併（PR #45） | 「修正：既有焦點與可及性問題」：P2／P3 驗證發現的既有問題——詳情上一筆／下一筆焦點、空表單送出不展開 Combobox、375 底部 Sheet 焦點（落在面板本身）、`scroll-padding-bottom`、三處內縮焦點環、標準深色列印淺色色票（標準與 cyber 都生效） | §9.2 B3／B4、§13 | 本地五指令、C1 |

**P3 實作時與上文的差異**（都已寫回 §1「P3 設計簡報」、§3.3、§3.5、§6.2）：FX-02 換頁 VT 評估後移除（VT 期間 DOM 不可 hit-test，吞點擊；`pointer-events: none` 無效），VT 只用於 FX-38；infinite 白名單擴為 7 項、改依 `@keyframes` 名稱比對；FX-20 的 `detail-body` 由 6 檔減為 4 檔、掃描線延後到淡入結束後；可聚焦元素不重掛，改 `useReplayPhase`／`data-fx-phase`；FX-16 只讓新出現的列進場；FX-11 鍵盤不觸發角框；FX-38 無獨立發光線；lib/fx 增為六個工具；新增一批 `data-fx-*` 屬性掛勾（§3.3）；§9.4 P1 目標改為相對標準主題。

**P1 實作時與上文的差異**（都已寫回對應章節）：掃描線 `body::after`；切角畫在 `::before`／角框畫在 `::after`（直角 L 形、切角折角括號）、元素本身不加 `clip-path`（§5.3）；`>` 前綴只在桌面側欄且絕對定位、不佔版面（§5.2）；頁面標題游標延到 P3；toast 前綴用 sonner 屬性選擇器，並把 sonner 深色主題的純黑底改回 token（§5.2）；焦點環沿用 `index.css` base 層的規則，不另寫（§5.6）；甜甜圈弧的光暈用 `drop-shadow`（§5.5）；列印還原以 `all: revert-layer` 為主（§8）；手機頂欄標題（18px）不加文字光暈（§4.2）。

**P2 實作時與上文的差異**（都已寫回 §1「P2 設計簡報」、§3.3、§6.2、§8）：FX-19 括號改為新選中項由外側 4px 收回並淡入；FX-17 僅新增；FX-28、FX-31 移 P3；FX-21 併入 FX-20（`key={r.id}` 重新掛載、不分方向、無獨立 glitch）；FX-22 沿用 `data-variant="destructive"`、進場改 `transform`／`opacity`（`clip-path` 會吞點擊）；FX-23 `>` 只有 Combobox；FX-24 同一個錯誤不重播抖動；FX-36 僅開啟；FX-06 擴散環畫在新增鈕連結 `<a>::after`；FX-10 新增 `bar-track` 並 `overflow: visible`；新增 6 個 `data-fx` 掛勾（`chip`、`bar-track`、`detail-body`、`lightbox`、`error-title`、`unsaved`）；P2 專用時間 token 在 `cyber.css` 而非 `index.css`；列印用 `animation／transition: revert-layer`（sonner 子樹 `animation: none`）；P1 靜態斷言只掃 `P2 START` 之前；`infinite` 只有 FX-33、FX-35。前端測試 565 → 601 個（32 個檔案）。

---

## 11. 風險與回退

| 風險 | 對策 |
|---|---|
| 現場實用性不如預期 | opt-in 設計：切回標準即可，資料與功能完全不受影響 |
| 某個效果在特定瀏覽器出問題 | 每個 FX 都是獨立的 CSS 規則或 `useFx()` 分支，可以單獨移除 |
| View Transitions 吞點擊（真實 DOM 在 VT 期間不可 hit-test） | **已處置**：FX-02 換頁 VT 評估後移除，VT 只留給使用者主動、低頻的主題切換（FX-38） |
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
- P2 前置待辦（P1 修正輪重驗發現）：FX-19 與「分段按鈕括號常駐＋`visibility: hidden` 佔位」的對齊**已在 P2 處理**（改為新選中項括號由外側收回並淡入，見 §1）；375 寬時固定底部分頁列蓋住被聚焦元素屬既有問題（標準主題相同），不在 cyber 範圍；側欄連結、列表列、趨勢柱的焦點環被 `overflow` 裁掉同屬既有問題。**以上兩項已於「修正：既有焦點與可及性問題」（PR #45，已合併）修正**：`html` 加 `scroll-padding-bottom`、三處改內縮焦點環（B3 的「cyber 沒有比標準更差」判定不變，但三處現在兩個主題都完整可見）。
- P2 驗證發現的既有問題（標準主題 main 同樣，**P2 不修**，另案處理）：(1) 詳情面板按上一筆／下一筆切換後，焦點掉到 dialog 容器，而不是留在按鈕上；(2) 新增紀錄表單送出空表單時，首個無效欄位（Combobox）自動展開的建議清單會蓋住它下方的 `ERR:` 訊息；(3) 底部分頁列遮蔽與 `overflow` 裁焦點環維持原狀；(4) 375 寬的多選下拉與日期篩選（`ResponsivePopover` 的底部 Sheet）因 `onOpenAutoFocus` 被 `preventDefault`，開啟後焦點留在觸發按鈕，Tab 會跑到面板外（沒有焦點鎖定；Esc 可關閉並回到觸發元素）；**(1)–(4) 與標準深色列印的深色嚴重度色塊，已於 PR #45 一併修正（已合併）**；(5) P2 效能量測（4× CPU 降速）：詳情面板開關在標準主題已低於 50fps（1280 約 37、375 約 49），cyber 再低約 6fps（1280 約 32、375 約 43），不降速時皆 ≥ 59.5fps；見 PR #42 說明。**P3 結論**：FX-20 掃描線（`cyber-sheet-sweep`）已是 `transform`，P2 時「`clip-path` 是主因」的推測不成立；真正歸因見 §9.4〈P1 實測與裁定〉（淡入與掃描線同時觸發、偽元素靜態成本、其餘各項），P3 已把掃描線延後到淡入結束後、詳情淡入由 6 檔減為 4 檔；`body::after` 維持 P1 設計等使用者真機實測；未採用候選（暫停背景掃描線、減少偽元素、淡入與掃描二選一）留作 P4／後續。
- **P4 結論（待合併）**：掃描線浮層旗標撤掉（−30ms < 40）；捲動額外成本歸因為標題游標常駐動畫，已改成「打字後閃 3 次就停在常亮」（1280 +8.8%、375 +20.3%，並同步修改 `cyberCss.test.ts` 的游標斷言，已獲授權）；已開機冷啟動 +113～128ms（今天的機器）超出 50ms，裁定接受為主題固有成本（不是 `BootLoading` 造成）；匯出中圖示列印還原已做，FX-25 列印畫面不做。驗證：B4（詳情面板、「更多」面板的焦點鎖定、Esc、回到觸發元素）、M3（開詳情→上一筆×5→關閉→換頁，每步 ≤ 約 200ms）、B1（減少動態效果：無執行中動畫、游標常亮）、CLS（375 為 0、1280 為 0.00026，P2 既有的同源）、標準主題 C1 皆通過，證據 `followup/p4/p4check.json`。
- **P3 驗證發現（不修，留作後續或使用者實測）**：
  1. **P4 冷啟動**（1×，中位數）：標準 260ms／cyber 乾淨 270ms／cyber 已開機 283ms；4× 降速：標準 1216ms／cyber 乾淨 1254ms／已開機 1291ms。1× 皆在 50ms 內；**已開機 4× 多 +75ms，超出 50ms，記錄之**（乾淨 4× +38ms）。
  2. **大小**（對 `d3797c7`）：JS +4,055B、CSS +6,131B，無新套件。
  3. **M3 與 FX-38 吞點擊窗口**：FX-38 主題切換 VT 期間吞點擊，1× 約 350–400ms、4× 約 450–850ms（FX-02 因此移除，見 §1 第 10 點；FX-38 因使用者主動、低頻而保留）。
  4. **FX-02 移除理由**：VT 期間真實 DOM 不可 hit-test，縮到約 240ms 仍吞點擊，`pointer-events: none` 對 `::view-transition-*` 無效。
  5. **FX-32 在 375「更多」面板點匯出會立刻關閉面板**，所以看不到匯出中指示（既有行為，標準主題相同）。
  6. **列印邊緣 computed style 差異**：匯出中 `svg` 的 `visibility`、送出中 DOM 不同；`aside` 本就 `print:hidden`，列印畫面相同。
  7. **開面板時機**：詳情面板開啟，cyber 比標準晚出現約 15ms（1×）／80ms（4×）。
  8. **CLS**：桌面冷啟動 cyber 為 0.00064，非嚴格 0，與 P2 既有的同源（標題區 `DIV`），未新增。
  9. **未驗證**：無實機 NVDA／VoiceOver；FX-01 開機畫面實機只以時間軸佐證，未在真機肉眼確認。
