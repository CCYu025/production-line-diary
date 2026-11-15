# 全像模式（HOLO）交接文件

> 用途：任何新的 session（或新的人）接手全像模式開發時，**先讀這份**。
> 維護規則：每次合併 PR、每完成一期、使用者說「handoff」（停機或離開）時都要更新。最後更新：2026-11-15。

## 1. 一分鐘現況

| 項目 | 狀態 |
|---|---|
| 目前階段 | H2 共用核心進行中，停在 **H2-0（`npm run verify:holo`）**：程式已寫完（協調者自跑完整版 17/17 通過），L1（Haiku）跑到一半因使用者 2026-11-15 handoff 中斷；L2 未做、未開 PR |
| main | `3d8a1ce`（PR #63 合併後；本交接更新的 docs PR 合併後會再往前一個 commit） |
| 進行中分支 | `feat/holo-h2-0-verify`，HEAD `2ed07f8`（WIP 標記 commit；實作在 `e5fd791`…`ce0f80e`），worktree `pld-wt/h2-0`。baseline worktree `pld-wt/h2-base` 已移除。設計師的 `pld-wt/holo-h15-spec`（分支 `docs/holo-h15-abstract`）由設計師處理 |
| 伺服器 | 3114–3116 都已停止；沒有背景中的協調者或驗證者 |
| 下一步 | ① 從 main 重建 baseline worktree（`git worktree add --detach pld-wt/h2-base main`，裡面 `npm install`、`npm run build`）；② 在 `pld-wt/h2-0` 從頭跑完整版 `npm run verify:holo -- --base <h2-base>` 做 L1（約 45 分鐘，需可見桌面與真 GPU）；③ L2（含 holo-ime 失焦→INVALID、拿掉 `isComposing`→FAIL、c1 故意改壞一處要抓到）；④ 開 PR、CI、送設計師審查 |
| H2 簡報 | 定稿在開發主管的筆記資料夾 `h2-brief.md`（不在 repo）。重點：共 7 個 PR（H2-0、H2-1+2、H2-3、H2-4、H2-5、H2-6、H2-7）；Q1 紀錄相關 hook 放 `features/records/core/`、`useModeShell` 拆成 `app/core/`（標題、換頁焦點）與 `features/os/core/`（模式生命週期），網頁入口不得 import `features/os`（A5／HB1）；Q2 H2-6 搬家與 H2-7 ColorManagement 初始化放本期；Q3 `holoAggregate` 延到 H6；Q4 H2-1 與 H2-2 合成一個 PR。只有 H2-0、H2-4 送設計師審查；突變沒被抓到時不合併、先問設計師 |
| 待設計師裁定（H2-0） | 協調者與簡報不同的決定：(a) `os-handoff` 只跑 CPU 1×（完整 1×＋4× headed 超過 25 分鐘），並容許 DEVIATED（這台機器每次 11–12 個）：判定為 0 FAIL、樣本 ≥ 100、確定通過 ≥ 75；(b) `c1-os` 只比 1280 寬、標準淺色、README S4(b) 的 9 個情境（OS 固定 Cyber、< 1024 只有 DeviceGate），不是三主題 × 三寬度；(c) c1 組合數和 `holo-baseline.json` 比，不另跑 base 端；(d) 任何一步超過 40 分鐘記 INVALID；(e) 網頁入口 gzip 增量在 main 上已是 +1816 B（上限 2048，`bundle-baseline.json` 過舊），後面的 PR 容易踩線，要不要更新 baseline |
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
