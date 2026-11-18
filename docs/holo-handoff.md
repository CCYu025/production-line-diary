# 全像模式（HOLO）交接文件

> 用途：任何新的 session（或新的人）接手全像模式開發時，**先讀這份**。
> 維護規則：每次合併 PR、每完成一期、使用者說「handoff」（停機或離開）時都要更新。最後更新：2026-11-18。

## 1. 一分鐘現況

| 項目 | 狀態 |
|---|---|
| 目前階段 | **H2-0（`npm run verify:holo`）已以 PR #67 合併（2026-11-18）**。下一步是 H2-1+2（見 §3），開工前先處理 §5 的「H2-1 開工前置項目」 |
| main | PR #67 的合併 commit（squash；H2-0 verify:holo） |
| 進行中分支 | 無。`feat/holo-h2-0-verify` 合併後由 GitHub 刪除；worktree `pld-wt/h2-0` 可以移除。baseline worktree `pld-wt/h2-base`（main `3d8a1ce`）留到 H2-1 開工時改指新 main。`.git/worktrees/` 底下有 `h2-0-l2b`、`h2-0-l2j`、`h2-0-l2k`、`h2-0-l2k-old`、`h2-0-l2m` 等刪不掉的空殼（Permission denied），照慣例留著 |
| 伺服器 | 3114–3116 都已停止；沒有背景中的協調者或驗證者 |
| H2-0 驗證結果 | 完整 L1（`c131c88`）17/19：os-handoff 兩項被「exit 與結果矛盾」檢查誤判（帶 `--allow-deviated` 時只有 DEVIATED 就是 exit 0），已在 `3f608ac` 修正（`buildHandoffArgs` 統一產生參數）。os-handoff 兩項重跑：coord9 的 4× 出現 1 筆真實 FAIL，已記為已知問題（見 §5）；l1-r8 的 1× 與 4× 都 PASS。後續 commit（`146e24e` 自測缺口、`14827b7` E1：holo-ime 的 exit 0 必須與 result.json 一致）跑過自測、check、test 的 L1，並各有一位新的 L2 複驗，都沒有找到真實會發生的錯誤 PASS。L2 共 l2i、l2h、l2j、l2k、l2m 五輪；證據放在開發主管的 scratchpad（不進版控） |
| 停止條件（設計師 2026-11-18） | L2 只找到「不會造成錯誤 PASS」的缺口時，一律記成下一期的前置項目，不再回頭修；只有會讓結果變成錯誤 PASS 的缺陷才在本期修 |
| 新紅線（2026-11-16） | 協調者與驗證者**不得執行 `git config`**（`--local`／`--global` 都不行，2026-11-18 起連只讀取設定也不行）、不得改 `.git/config` 與 hooks，突變只改 worktree 內的追蹤檔案（暫時 commit 用 `git -c user.name=… -c user.email=… commit`）；**寫檔一律用絕對路徑**（PowerShell 的 .NET 檔案 API 相對路徑以行程啟動目錄為準，曾因此誤寫主 checkout） |
| H2 簡報 | 定稿在開發主管的筆記資料夾 `h2-brief.md`（不在 repo）。重點：共 7 個 PR（H2-0、H2-1+2、H2-3、H2-4、H2-5、H2-6、H2-7）；Q1 紀錄相關 hook 放 `features/records/core/`、`useModeShell` 拆成 `app/core/`（標題、換頁焦點）與 `features/os/core/`（模式生命週期），網頁入口不得 import `features/os`（A5／HB1）；Q2 H2-6 搬家與 H2-7 ColorManagement 初始化放本期；Q3 `holoAggregate` 延到 H6；Q4 H2-1 與 H2-2 合成一個 PR。只有 H2-0、H2-4 送設計師審查；突變沒被抓到時不合併、先問設計師 |
| H2-0 裁定 | 已於 2026-11-16 由設計師裁定並落實（(a) `--full` 補跑 4×、(b) DEVIATED ≤ 基準×1.5、(c) c1-os 1280＋1024 共 18 組、(d) 組合數和基準比、(e) 逾時 40 分鐘／軟體算圖 INVALID、(f) holo-ime 探針、(g) `bundle-baseline.json` 不動、新增 `entry-delta-vs-base` ≤ +100 B）。2026-11-17 補：4× 門檻已訂、I2 階段逾時採 known-on-main 對照（見「L2 發現處理狀態」）。|
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
| 文件 | #66 | 2026-11-16 | 交接文件更新（H2-0 第二次 handoff） |
| H2-0 | #67 | 2026-11-18 | 一鍵驗證指令 `npm run verify:holo`（19 項、機器可讀 JSON＋摘要行、exit 0／1／2）、`holo-baseline.json` 門檻、known-on-main 比率規則、待機偵測、SELFTEST 保護、holo-ime 補強與環境例外重試；產品程式碼沒有改 |

## 3. 下一步（依序）

1. H2 共用核心抽出（規格 §12，簡報已定稿，見 §1）：H2-0 已合併（#67）；接著依序 H2-1+2（開工前先處理 §5「H2-1 開工前置項目」） → H2-3 → H2-4 → H2-5 → H2-6 → H2-7。網頁與 OS 2D 行為零差異。
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

**已知問題（2026-11-17，設計師裁定記錄）**：4× 下 OS 轉場 I2 階段逾時（`timeout waiting for phase …-post (have …-pre>…)`；main 也會出現，不是分支造成）：可能是轉場在慢機器上太慢，或腳本逾時設定太緊。H3 開工前查清楚；若是產品問題，排進 H8（轉場）。`verify:holo --full` 對這一種 FAIL 有 known-on-main 對照規則（見 `scripts/verify/README.md`），其他 FAIL 不受影響。

**已知問題（2026-11-18，設計師裁定記錄）：4× 下 I2 交接後第一次點擊沒有產生 `exiting-pre`。** 這一條和上面的 4× I2 階段逾時一起，列為 H3 開工前要查清的項目。
- **出現在哪一輪**：`3f608ac` 的 `--only os-handoff,os-handoff-4x` 重跑（coord9）。目前重現率是 1/3 輪完整 4×（`6aef487`、`c131c88` 兩輪都是 FAIL 0）。
- **症狀**：失敗的樣本是 I2 switch / first-click / trigger hash，planned 50 ms、achieved 108 ms，嘗試 3 次。訊息原文是 `first click after the handoff did not produce exiting-pre`：`os-handoff.mjs` 等了 1500 ms，一直沒等到 `exiting-pre`。
- **當次數字**：4× 102 筆，FAIL 1，DEVIATED 68，conclusive 33。
- **為什麼不是分支造成的**：分支沒有改產品程式碼，`os-handoff.mjs` 只把階段名稱改成匯入 `os-phases.mjs`，值相同。
- **判定規則不變**：這一種**不加進** known-on-main 白名單，也不放寬任何判定規則，gate 照常判 FAIL；不為了讓它消失而重跑。
- **證據**：scratchpad `holoverify/h2/h2-0/coord9/os-handoff-4x/result.json`（不進版控）。

**已知問題（2026-11-18，設計師裁定記錄）：holo-ime 在乾淨程式碼上偶發 FAIL，根因未明。下一個動到輸入、slate 或 freeze 的 H2 PR，合併前必須先處理這個問題。**
- 重現率：L2-h 2/5 次失敗（當時同機長時間跑其他驗證）。根因第一輪 0/24：main 與分支各 12 次，另有分支加 CPU 滿載 6 次，也全部通過。第二輪 0/10：與另一個瀏覽器驗證 `os-handoff --headed --throttles 4` 同時跑，但背景負載不完整，信心中低。
- 症狀 1：選字在 Enter、Process-Enter 或 ArrowDown 之後就自己結束（`composing=false`），值變成「ㄋㄧˇ你好」；同時 freeze=1 時 slate 位移 45px（門檻是小於 0.5px）。失敗那次期間沒有 focusout、沒有 window blur、visibility 沒變，所以不是失焦。
- 症狀 2：freeze=0 那頁 `__holoLab().frames>10` 等待逾時。目前這歸為環境例外（page-not-ready），會就地重試一次；連兩次同種就判 FAIL。
- 診斷欄位：`result.json` 每次都有 `diag`，內容包括 slate 節點與三個欄位是否被換、`isConnected`、`__holoLab` 是否被換、`visibilityState`、`hasFocus`，以及選字開始與中段的 frames、frames 是否前進。失敗或例外時才另有 `diagFull`（最後 80 筆事件、longtask）。若診斷指向產品（輸入框被重掛、slate 或 `__holoLab` 被換），要先修好，並請使用者用真的注音輸入法實測。
- 不自動重跑 holo-ime 來掩蓋。唯一的重試是環境例外的就地一次，而且一定記成 `retried 1x`；重試後 PASS 仍判 INVALID。

**H2-1 開工前置項目（H2-0 L2 留下，2026-11-18）。設計師裁定：不會造成錯誤 PASS 的缺口不在 H2-0 修，H2-1 開工前處理。**
- G1：沒有測試證明 `--dump-hooks` 不寫 `verify-holo.json`。重現：把 `--dump-hooks` 的寫檔分支改成會寫出 `verify-holo.json`，所有自測仍通過。
- G2：h-6 沒涵蓋「exit 3（0／1／2 以外的碼）加一份完整 PASS 的 result.json」。重現：把 `holoIme()` 的 `r.code !== 0` 放寬成 `r.code > 3`，自測仍通過。
- G3：h-3 只測 CI 拒絕與正常路徑。重現：`--help`、`--out` 含真實資料夾名稱、未知 id 這三條路徑若洩漏 `pld-vh` 暫存資料夾，自測抓不到。
- G5：holo-ime 的 halt 接線只有原始碼 regex 檢查，沒有行為層級測試。重現：在 `finally` 裡把 `halt` 重設成 `false`，或移除 catch 內的 `halt = true`，自測仍通過。
- G6：`--out` 路徑含真實資料夾名稱時，資料夾在拒絕之前就已建立（`mkdirSync(LOGS)` 在拒絕檢查之前）。這是既有行為。重現：用含真實資料夾名稱的 `--out` 執行，拒絕之後該資料夾仍存在。
- 前一輪 L2 留下的：錯誤訊息會帶出 `--base` 的絕對路徑（只進 log 與 JSON）。重現：給一個不存在的 `--base`，在 log 與 `verify-holo.json` 裡可看到完整絕對路徑。
- **E1 檢查的殘餘問題**（14827b7 的 L2 找到；真實 holo-ime 都不會走到，因為它只有在 `failed` 為 0、`invalid` 與 `envError` 都是 null 時才會 exit 0）：
  - **型別判斷太寬**：`imeExitProblem` 用 truthy 判斷 `invalid`／`envError`，所以 `invalid` 為 `0`、`""`、`false`，或 `envError` 為 `0` 時，會判成 PASS。建議改成 `!= null`。
  - **漏查欄位**：沒有檢查 `envErrorSeen`。
  - **自測沒把關型別**：下列突變自測都抓不到：`pass !== true` 改成 `!pass`、`failed !== 0` 改成 `> 0`、拿掉 `typeof failed`、拿掉 `Array.isArray`。

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
