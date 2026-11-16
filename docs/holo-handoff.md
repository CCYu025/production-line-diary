# 全像模式（HOLO）交接文件

> 用途：任何新的 session（或新的人）接手全像模式開發時，**先讀這份**。
> 維護規則：每次合併 PR、每完成一期、使用者說「handoff」（停機或離開）時都要更新。最後更新：2026-11-15。

## 1. 一分鐘現況

| 項目 | 狀態 |
|---|---|
| 目前階段 | H2 共用核心進行中，停在 **H2-0（`npm run verify:holo`）**：L1 通過、L2 發現已修一部分（見「L2 發現處理狀態」），**使用者 2026-11-16 第二次 handoff，修復中途停機**。未開 PR |
| main | `a172c5f`（PR #65：個人路徑換成佔位符） |
| 進行中分支 | `feat/holo-h2-0-verify`（已 rebase 到 `a172c5f`；最新是 WIP commit，見 `git log`），worktree `pld-wt/h2-0`，只在本機。baseline worktree `pld-wt/h2-base`（main `3d8a1ce`，產品程式碼與 `a172c5f` 相同）。設計師的 `pld-wt/holo-h15-spec` 由設計師處理 |
| 伺服器 | 3114–3116 都已停止；沒有背景中的協調者或驗證者 |
| L2 拆分結果（2026-11-16） | 上一輪 L2 範圍太大逾時，改拆三位：**L2-a**（靜態）：可疑 ③④⑤⑥ 屬實（紅線 2 可繞過、紅線 3 只掃新增檔、lockfile 等欄位漏、工作區不乾淨照樣 PASS）、`osHandoff4x` 暫定門檻與 main 實測矛盾、範圍與文件全部符合；**L2-b**：找到缺陷——holo-ime C3 的「ㄈ」不比對任何選項，拿掉 `isComposing` 也 PASS；探針後計數歸零符合規格；**真實失焦→INVALID、`--full` 小樣本、1× DEVIATED 上限→INVALID 三項沒有有效實測**；**L2-c**：c1-web 故意改壞（按鈕 `px-4`→`px-5`）FAIL、858 處差異；DeviceGate 1000×700 時工作站仍在 DOM 且 `hidden`＋`inert`＋`aria-hidden`、表單值保留，與 main 的 DOM 與截圖位元組完全相同 |
| 裁定（設計師 2026-11-16） | 1 修 holo-ime C3：保留「ㄈ」、加會比對到選項的「F」，兩者都檢查值沒被換成選項——這是修正測不到缺陷的輸入，不是放寬；2 4× 門檻：同一 commit 共跑 3 次完整 4×、取最差訂 `conclusiveMin` 與明確 DEVIATED 上限，baseline 註明「4× 只能抓 FAIL，輸入閘主要證據來自 1×」與原始數字；3 個人路徑另開 docs PR（已以 PR #65 合併） |
| 新紅線（2026-11-16） | 協調者與驗證者**不得執行 `git config`**（`--local`／`--global` 都不行）、不得改 `.git/config` 與 hooks，突變只改 worktree 內的追蹤檔案（暫時 commit 用 `git -c user.name=… -c user.email=… commit`）；**寫檔一律用絕對路徑**（PowerShell 的 .NET 檔案 API 相對路徑以行程啟動目錄為準，曾因此誤寫主 checkout） |
| L2 發現處理狀態 | **已完成（已 commit）**：① holo-ime C3 加「比對到選項」情境（`F`）；自證：拿掉 `isComposing` 判斷 → `holo-ime` FAIL（4 項，皆為 matches-options 情境），乾淨分支 PASS，檢查數 30（`holoIme.checks` 已改 30）；② 紅線規則 2（引號包住的偏好 key，ts/tsx/js/mjs，排除註解與測試）、規則 3b（所有檔案新增行掃使用者家目錄路徑）、規則 4（lockfile 任何變動、`overrides`／`resolutions`／`workspaces`／`bundledDependencies`）都用 L2-a 的情境重驗：別名、括號、換行、.js、修改既有檔加路徑、lockfile、overrides、workspaces 原本漏的現在都 FAIL，註解與測試檔、乾淨分支 PASS；③ 工作區不乾淨時 `tests-untouched`／`redline-grep` 為 INVALID（exit 2）、JSON 有 `dirty`；④ baseline 小項（`measuredOn` 補 Chrome、螢幕、4× 日期；`hp1WarnFps20k` 45 警戒；`labBundle.holoCoreMaxBytes` 由 baseline 讀；刪死欄位）；⑤ README／CLAUDE／AGENTS 已同步；⑥ 已 rebase 到 `a172c5f`。**未完成**：⑦ `osHandoff4x` 門檻（`conclusiveMin`、`deviatedMax`、三次原始數字）**還沒寫進 baseline**，仍是暫定值 35／62；⑧ 本節與 §2 的 PR #65 列已更新，但完整版 `verify:holo`（rebase 後）與 `--only os-handoff-4x --full` 還沒跑；⑨ 補 L2。|
| 下一步 | ① 補完 4× 門檻：在 `pld-wt/h2-base`（main 程式碼）已跑 base 完整 4×：第 1 次（L2 做的）102 樣本／確定通過 23／DEVIATED 79／FAIL 0；第 2 次 102／37／64／**FAIL 1（I2 switch/first-click/hash，planned=0，timeout waiting for phase switching-post，與協調者先前看到的 FAIL 同類，main 上也會出現，傾向是不穩定而非分支造成）**；第 3 次跑到一半中止（handoff）。證據在開發主管 scratchpad `holoverify/h2/h2-0/coord3-4x/run1`。需要再跑 1 次完整 4× 湊滿三次，取最差者訂 `conclusiveMin`（建議不高於 23）與 `deviatedMax`（建議不低於 79 再留餘裕、且小於樣本數），並把「4× 的確定通過很少，只能用來抓 FAIL；輸入閘的主要證據來自 1×」與原始數字寫進 baseline note；FAIL 是否算 main 的不穩定，請設計師裁定（目前 verify-holo 對 4× 任一 FAIL 仍判 FAIL）；② rebase 後跑完整版 `verify:holo`（要 exit 0）與 `--only os-handoff-4x --full`；③ L1（完整版）後補 L2：真實失焦→INVALID、`--full` 小樣本、1× DEVIATED 上限→INVALID、C3 的 F 情境（改壞 Combobox 要 FAIL、乾淨 main 兩情境 PASS）、紅線新規則；④ push、開 PR（本文寫 `holo-baseline.json` 每處變動理由與 main 多出 1816 B 的前 5 名模組）、CI、送設計師審查 |
| H2 簡報 | 定稿在開發主管的筆記資料夾 `h2-brief.md`（不在 repo）。重點：共 7 個 PR（H2-0、H2-1+2、H2-3、H2-4、H2-5、H2-6、H2-7）；Q1 紀錄相關 hook 放 `features/records/core/`、`useModeShell` 拆成 `app/core/`（標題、換頁焦點）與 `features/os/core/`（模式生命週期），網頁入口不得 import `features/os`（A5／HB1）；Q2 H2-6 搬家與 H2-7 ColorManagement 初始化放本期；Q3 `holoAggregate` 延到 H6；Q4 H2-1 與 H2-2 合成一個 PR。只有 H2-0、H2-4 送設計師審查；突變沒被抓到時不合併、先問設計師 |
| H2-0 裁定 | 已於 2026-11-16 由設計師裁定並落實（(a) `--full` 補跑 4×、(b) DEVIATED ≤ 基準×1.5、(c) c1-os 1280＋1024 共 18 組、(d) 組合數和基準比、(e) 逾時 40 分鐘／軟體算圖 INVALID、(f) holo-ime 探針、(g) `bundle-baseline.json` 不動、新增 `entry-delta-vs-base` ≤ +100 B）。未解：`--full` 的 4× 門檻見「下一步」①。|
| 規格 | `docs/holo-mode-spec.md`（H1.5 抽象佈局定稿版）、`docs/holo-mode-inventory.md`（附錄 A，必須保留的功能清單） |
| 待決問題 | 規格 §6.7 Q1–Q4（見 §5） |

## 2. 已完成里程碑

| 期 | PR | 日期 | 內容 |
|---|---|---|---|
| 規格 | #56 | 2026-11-08 | 全像模式初版規格與功能盤點 |
| H0 | #57 | 2026-11-09 | OS 工作站底部頻道列重設計 |
| IME 修正 | #58 | 2026-11-10 | 網頁版 Combobox／CopyPicker 選字中 Enter 的修正 |
| H1.5 | #59 | 2026-11-15 | 方向改為抽象佈局：A 事件流場（主）、C 時空晶格（分析）、B 星座（選配）；一個世界多種佈局；新分期 H2–H10 與 L1/L2 獨立軌 |
| H1 | #62 | 2026-11-15 | 技術驗證四關卡通過：引擎、全像材質、終端板定位定案為投影（規格 §3.3）、縮圖快取、效能（20k 筆 60fps）、`holo-*` 驗證腳本、bundle 群組制。機台樣品已移除；留給 H3 的發現記在規格 §3.3 |
| 文件 | #65 | 2026-11-16 | 個人路徑換成佔位符（`.env.example`、`docs/refactor-plan.md`、`test/migrateLogic.test.js`），設計師合併 |

## 3. 下一步（依序）

1. H2 共用核心抽出（規格 §12，簡報已定稿，見 §1）：先完成 H2-0 的 L1／L2／PR（見 §1「下一步」），再依序 H2-1+2 → H2-3 → H2-4 → H2-5 → H2-6 → H2-7。網頁與 OS 2D 行為零差異。
2. 之後依規格 §12：H3 引擎＋佈局框架 → H4 流場＋詳情 → H5 編輯新增 → H6 晶格＋儀器環 → H7 深層＋設定 → H8 轉場音效 → H9 星座（選配）→ H10 收尾。
3. L1 詞彙設定（跨領域）：H4 展示後才開，需先修改紅線 1、3。L2 資料模型另立專案。

## 4. 角色與流程

| 角色 | 模型／誰 | 職責 |
|---|---|---|
| 使用者 | — | 決定方向；看里程碑展示（H4、H6、H8）與注音實測。說「handoff」代表要停機或離開 |
| 設計師 session | Opus | 規格、每期簡報、設計審查、決定推送與合併（需使用者直接授權該 session） |
| 開發主管 session | Opus | 拆工作、派協調者與驗證者、判斷是否升級驗證、維護本文件 |
| 協調者（實作） | Sonnet | 依簡報實作；交工前自己先跑 `npm run verify:holo` |
| L1 例行驗證 | Haiku | 每一輪都做：執行 `verify:holo`，對照門檻回報通過／失敗與數字（CI 六步、測試數、bundle 上限、網頁零差異、效能／IME／靜止腳本、紅線 grep）。不做判斷；失敗或不確定一律升級 L2 |
| L2 對抗驗證 | Sonnet（每次換新的） | 每期最後一輪，以及高風險變更（H2 共用核心、輸入閘、刪除與復原、列印、任何碰網頁模式的改動）：故意改壞程式測試、設計邊角情境、逐條對照規格與附錄 A |
| 抽查 | Sonnet | 大約每 3 輪，從 Haiku 判定通過的結果中抽一份重驗 |
| 顧問 | Fable | 方向與設計品質的重大判斷，以及里程碑展示的審查；來回修改直到顧問滿意 |

流程：
1. 設計師寫簡報，寫明 L1 要過的項目與 L2 要做的對抗測試。
2. 協調者實作，並自己跑 `verify:holo`。
3. L1（Haiku）驗證；沒過就修，修完再驗。
4. 每期最後一輪做 L2（Sonnet）。
5. 開 PR，CI 綠燈。
6. 合併，並同時更新本文件。

`verify:holo` 預設只跑 `os-handoff` 的 CPU 1×。**必須加 `--full`（再跑 4×，`os-handoff-4x`，超過 25 分鐘）的時機**：H2-5 的每一輪 L2、H3 起每期最後一輪 L2、任何碰到輸入閘／轉場／`useBlocker` 的 PR。`os-handoff` 的 DEVIATED 數超過基準 ×1.5 記 INVALID；`holo-baseline.json` 的任何變動都要在 PR 本文說明理由，L2 逐行看它的 diff。

設計稿與筆記放在設計師的本機筆記資料夾（不在 repo），包括顧問報告、H1.5 草圖與審查紀錄，路徑記在設計師的記憶裡。

## 5. 待決問題（規格 §6.7）

| # | 問題 | 規格預設 |
|---|---|---|
| Q1 | B 星座的「共現數」算不算新統計口徑 | B 裁定前不做 |
| Q2 | 雙條件下鑽（設備＋分類） | 不做，等裁定 |
| Q3 | C 晶格 z 軸單位 | 一格一週，遠距 LOD 合併；不用「月」 |
| Q4 | 變形時的淡尾跡 | 不做 |

## 6. 安全規則（每個 session、每個代理都要遵守）

- **真實資料資料夾**（主 checkout 的 `.env` 所指的 DATA_DIR）：任何代理都不得讀寫，也不得當成 DATA_DIR。
- **主 checkout**：不跑 `npm start`／`npm run dev`（`.env` 指向真實資料）；代理不得寫入，不 stash、不 reset、不切換分支。
- **跑 app**：只能在 worktree 裡，用 `backend/data/example` 的複本當 DATA_DIR，搭配非 3000 的連接埠與 `NO_OPEN_BROWSER=1`，並用 `node scripts/verify/serve.mjs --root <worktree> --port 3114|3115|3116` 啟動。不碰 3000／3001。
- **worktree**：放在 repo 外的固定 worktree 資料夾（路徑記在記憶裡）。
- **其他**：
  - 新增套件或下載任何東西前，要先問使用者。
  - 提交的檔案裡不得出現個人絕對路徑。
  - commit 結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`；PR 本文結尾加 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。
- **全像模式紅線**：
  - 網頁模式零差異；業務邏輯只存在一份。
  - 不新增業務功能，也不新增顯示的統計數字（佈局衍生量見規格 §1.3）。
  - 輸入閘不漏不吞；所有離開都走 `useBlocker`；列印走 `#report-output`。
  - 不用 View Transitions，只用 `applyTheme`。

## 7. 接手檢查清單

1. 讀這份文件、規格開頭狀態列、規格 §12。
2. `git fetch`，確認 main 與本文件 §1 相符；列出 `pld-wt` 底下的 worktree 與遠端分支，確認進行中的工作。
3. `gh pr list` 看有沒有未合併的全像 PR。
4. 接續 §3 的第一個未完成項目。
5. 做完之後更新本文件。
