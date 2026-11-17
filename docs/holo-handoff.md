# 全像模式（HOLO）交接文件

> 用途：任何新的 session（或新的人）接手全像模式開發時，**先讀這份**。
> 維護規則：每次合併 PR、每完成一期、使用者說「handoff」（停機或離開）時都要更新。最後更新：2026-11-17。

## 1. 一分鐘現況

| 項目 | 狀態 |
|---|---|
| 目前階段 | H2 共用核心進行中，停在 **H2-0（`npm run verify:holo`）**：驗證工具修正已補完（4× 門檻、known-on-main 對照規則、文件），已 rebase 到 main `c8bc1b9`；待協調者交工驗證結果、L1、補 L2、開 PR（2026-11-17） |
| main | `c8bc1b9`（PR #66：交接文件更新） |
| 進行中分支 | `feat/holo-h2-0-verify`（已 rebase 到 `c8bc1b9`；最新 commit 見 `git log`），worktree `pld-wt/h2-0`。**遠端還停在 rebase 前的 `93a4e0f`**：推新 commit 需要 force push，被自動模式權限擋下，新 commit 只在本機。baseline worktree `pld-wt/h2-base`（main `3d8a1ce`，產品程式碼與 `c8bc1b9` 相同）。設計師的 `pld-wt/holo-h15-spec` 由設計師處理 |
| 伺服器 | 3114–3116 都已停止；沒有背景中的協調者或驗證者 |
| L2 拆分結果（2026-11-16） | 上一輪 L2 範圍太大逾時，改拆三位：**L2-a**（靜態）：可疑 ③④⑤⑥ 屬實（紅線 2 可繞過、紅線 3 只掃新增檔、lockfile 等欄位漏、工作區不乾淨照樣 PASS）、`osHandoff4x` 暫定門檻與 main 實測矛盾、範圍與文件全部符合；**L2-b**：找到缺陷——holo-ime C3 的「ㄈ」不比對任何選項，拿掉 `isComposing` 也 PASS；探針後計數歸零符合規格；**真實失焦→INVALID、`--full` 小樣本、1× DEVIATED 上限→INVALID 三項沒有有效實測**；**L2-c**：c1-web 故意改壞（按鈕 `px-4`→`px-5`）FAIL、858 處差異；DeviceGate 1000×700 時工作站仍在 DOM 且 `hidden`＋`inert`＋`aria-hidden`、表單值保留，與 main 的 DOM 與截圖位元組完全相同 |
| 裁定（設計師 2026-11-16） | 1 修 holo-ime C3：保留「ㄈ」、加會比對到選項的「F」，兩者都檢查值沒被換成選項——這是修正測不到缺陷的輸入，不是放寬；2 4× 門檻：同一 commit 共跑 3 次完整 4×、取最差訂 `conclusiveMin` 與明確 DEVIATED 上限，baseline 註明「4× 只能抓 FAIL，輸入閘主要證據來自 1×」與原始數字；3 個人路徑另開 docs PR（已以 PR #65 合併） |
| 新紅線（2026-11-16） | 協調者與驗證者**不得執行 `git config`**（`--local`／`--global` 都不行）、不得改 `.git/config` 與 hooks，突變只改 worktree 內的追蹤檔案（暫時 commit 用 `git -c user.name=… -c user.email=… commit`）；**寫檔一律用絕對路徑**（PowerShell 的 .NET 檔案 API 相對路徑以行程啟動目錄為準，曾因此誤寫主 checkout） |
| L2 發現處理狀態 | **已完成（已 commit）**：① holo-ime C3 加「比對到選項」情境（`F`）；自證：拿掉 `isComposing` 判斷 → `holo-ime` FAIL（4 項，皆為 matches-options 情境），乾淨分支 PASS，檢查數 30（`holoIme.checks` 已改 30）；② 紅線規則 2（引號包住的偏好 key，ts/tsx/js/mjs，排除註解與測試）、規則 3b（所有檔案新增行掃使用者家目錄路徑）、規則 4（lockfile 任何變動、`overrides`／`resolutions`／`workspaces`／`bundledDependencies`）都用 L2-a 的情境重驗：別名、括號、換行、.js、修改既有檔加路徑、lockfile、overrides、workspaces 原本漏的現在都 FAIL，註解與測試檔、乾淨分支 PASS；③ 工作區不乾淨時 `tests-untouched`／`redline-grep` 為 INVALID（exit 2）、JSON 有 `dirty`；④ baseline 小項（`measuredOn` 補 Chrome、螢幕、4× 日期；`hp1WarnFps20k` 45 警戒；`labBundle.holoCoreMaxBytes` 由 baseline 讀；刪死欄位）；⑤ README／CLAUDE／AGENTS 已同步；⑥ 已 rebase 到 `a172c5f`。**4× 門檻已補（2026-11-17）**：同一份 main 程式碼三次完整 4×：102／確定通過 23／DEVIATED 79／FAIL 0；102／37／64／FAIL 1（I2 階段逾時）；102／24／78／FAIL 0；取最差訂 `osHandoff4x.conclusiveMin` 20、`deviatedMax` 90（含原始數字與「4× 只能抓 FAIL，輸入閘主要證據來自 1×」註記，寫在 `holo-baseline.json`）。**known-on-main 規則（設計師 2026-11-17 裁定）**：`--full` 的 4× 若 FAIL 全是允許清單內的 I2 階段逾時，同一次執行對 `--base` 重測 I2 4×，main 也逾時 → INVALID（`knownOnMain: true`），否則 FAIL；其他 FAIL 不對照；1× 不套用（見 `scripts/verify/README.md`）。**未完成**：補 L2。|
| 補充 L2-d 結果與裁定（2026-11-17） | L2-d 找出四點：① `holo-ime` 在沒改過的程式碼上約 7 次 2 次偶發 FAIL（C3 `設備XYF`、C2 `ㄏㄠˇ好`，都只在 freeze=0）；② 焦點判定；③ 突變 M2（只拿掉 keyCode 229）與 M4（只守 Enter 不守 ↑↓）沒被抓到；④ 紅線規則 2 的 `*` 開頭行可繞過、多行區塊註解內不以 `*` 開頭的行會誤報、小寫 Windows 路徑漏掃。設計師裁定並已修（見 commit）：焦點規格改為「已啟用焦點模擬、不受作業系統焦點影響，只有探針組字沒觸發才 INVALID」，並加 `--kill-probe` 突變開關；M2 補單元測試 `imeKeyCode229.test.tsx`（拿掉 229 判斷會變紅），README 寫明 E2E 的已知限制；M4 加斷言「選字中 ↓↑ 不改 `aria-activedescendant`、清單開著」；紅線抽成 `redline-rules.mjs`（真正追蹤區塊註解、Windows 路徑不分大小寫）加 `redline-rules.selftest.mjs`，已知範圍寫進 README。階段 2 實測結果（2026-11-17，HEAD 見 `git log`）：乾淨程式碼連跑 `--only holo-ime` 10/10 PASS（44 項，`holoIme.checks` 已改 44），另有一組 10/10 在改前版本；10 次都沒有 INVALID、沒有 FAIL，軌跡也沒有視窗失焦，所以「失焦」推論**沒有證據**，已撤銷「失焦期間的 FAIL 改判 INVALID」（只留軌跡當診斷證據，避免掩蓋真 FAIL）。偶發失敗在改成「等頁面可觀察狀態」後 20 次完整執行不再出現（C3 結束時 `aria-expanded` 40/40 為 true，舊版時真時假）；根本原因的結論只能到「舊腳本用固定 sleep 與下一步搶時序（組字在 commit 前已結束、清單已被收起）」，確切是哪一個事件仍未抓到，因為新腳本下不再重現。突變：M4（只守 Enter）→ FAIL 4 項（皆為 activedescendant 斷言）；拿掉整個保護 3/3 FAIL（各 8 項）；`--kill-probe` → INVALID（exit 2）；M2 由單元測試負責（拿掉 229 判斷 9 個測試全紅）。known-on-main 改比率規則（設計師 2026-11-17）：INVALID 要 base 至少逾時 1 次，且 `分支逾時 ≤ 3 × base逾時 × (分支樣本 ÷ base樣本) + 2`；value 帶 `branchTimeouts`／`branchSamples`／`baseTimeouts`／`baseSamples`／`limit`；base 重跑失敗為 FAIL，訊息寫「無法對照」。**待機偵測（2026-11-17，L1 第 5 輪 c1-web 卡住是 Windows Modern Standby 凍住 node 與 Chrome，事件 506／507 吻合）**：`verify-holo` 每 5 秒記牆鐘心跳，兩次間隔嚴格大於 60 秒就是暫停；執行期間重疊的項目一律判 INVALID「system suspended (gap Ns at HH:MM:SS), rerun required」，優先於逾時判定，`value.suspendedGaps` 與原判定／證據都保留，頂層 JSON 有 `suspended`／`suspendedGaps`，摘要行註明；沒重疊的 FAIL 不改。L1 遇到這種 INVALID 要回報「環境暫停，需重跑」。純函式在 `suspend.mjs`，自測 `suspend.selftest.mjs`；不做任何防睡眠（使用者自己決定）。待 L2 驗瀏覽器流程 |
| L2-i 修正（2026-11-17） | L2-i 找出的問題已依設計師裁定修完，每項都有回歸測試並實測「拿掉修正會失敗」：舊 `result.json` 在每次啟動子程序前先刪、紅線掃描器正確處理 regex 字面值（`/\/*/` 不再吞掉後面整個檔案）、個人路徑規則只比對真正的家目錄、base 伺服器起不來或建置失敗一律 FAIL、逾時殺掉時已有 FAIL 就維持 FAIL、待機改 INVALID 只套用在標為與時間有關的項目（建置、測試、掃描類的 FAIL 不再被待機吃掉）、known-on-main 的 phase 名稱改由 `os-phases.mjs`（與產品 `Phase` 型別對照）產生、`os-handoff` 的 exit code 與 summary 矛盾判 FAIL。新增自測 `os-phases.selftest.mjs`、`verify-holo.selftest.mjs`（不開瀏覽器、不佔連接埠）。細節見 `scripts/verify/README.md` |
| holo-ime 補強（2026-11-17） | 設計師裁定：① 補測不到的缺口——選字中 Enter／Esc 後 Combobox 的 `aria-expanded` 必須仍是 `true`，並加「滑鼠停在某選項上（有反白）再按 Enter」情境，只拿掉 Enter 或 Esc 其中一個防護也會 FAIL；② 環境類例外（頁面未就緒、CDP 中斷、目標關閉；清單是 `ime-env.mjs` 的 `ENV_ERROR_KINDS`）改判 INVALID，`verify-holo` 就地重試一次（連兩次同種 → FAIL；重試 PASS 仍是 INVALID；結果與摘要都記 `retried 1x`）；③ 失敗與例外時 `result.json` 多記診斷（`diag`／`diagFull`），只增加紀錄不改判定。細節見 `scripts/verify/README.md`。 |
| 2026-11-17 handoff 狀態 | `6aef487` 完整 L1 19/19 PASS（exit 0，無待機）。補充 L2 兩份（L2-i 靜態、L2-h 瀏覽器）完成；比率規則、DEVIATED 邊界、待機偵測（真實暫停 70 秒）都通過。發現已依設計師裁定修在 `f943b12`、`c0dd613`、`ab98462`、`5e57eda`，**這四個 commit 還沒跑 L1 與複驗**。holo-ime 乾淨程式碼偶發失敗（L2-h 5 次中 2 次：選字在 Enter／ArrowDown 後自行結束、值變「ㄋㄧˇ你好」、freeze 時 slate 位移 45px；另一次 freeze=0 頁 frames 逾時）。根因第一輪：main 12/12、分支 12/12、分支＋CPU 滿載 6/6 全 PASS，失敗那次沒有失焦。第二輪（`5e57eda`，holo-ime 與 `os-handoff.mjs --headed --throttles 4` 同時跑）10/10 PASS，無重試、`diag` 全正常（節點沒被換、frames 有前進）；但背景負載不完整（第一輪背景腳本中途 CDP 逾時崩潰、第二輪被 handoff 停掉），信心中低。依設計師規則屬「沒重現」→ 照已知問題處理 |
| 下一步 | ① 把 holo-ime 偶發失敗記為已知問題（README 與本文件 §5：L2-h 2/5 → 根因第一輪 0/30、第二輪 0/10、兩種症狀、`diag`／`diagFull` 欄位），不自動重跑，並成為下一個動到輸入／slate／freeze 的 H2 PR 的阻擋項（先請設計師確認第二輪結果適用此規則）；② 完整 L1；③ 新的 Sonnet 複驗：Enter／Esc 突變 FAIL、環境例外與重試紀錄（拿掉 `retried` 紀錄自測要失敗）、base 起不來一律 FAIL（含 c1、entry-delta）、SELFTEST 三條保護（含 `VERIFY_HOLO_SELFTEST_BASE_FAIL`／`_IME` 是否只在 `VERIFY_HOLO_SELFTEST=1` 下生效、CI 下拒絕）；④ force push（需使用者授權）、開 PR（本文寫 `holo-baseline.json` 每處變動理由與 main 多出 1816 B 的前 5 名模組）、CI、送設計師審查 |
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

**已知問題（2026-11-17，設計師裁定記錄）**：4× 下 OS 轉場 I2 階段逾時（`timeout waiting for phase …-post (have …-pre>…)`；main 也會出現，不是分支造成）：可能是轉場在慢機器上太慢，或腳本逾時設定太緊。H3 開工前查清楚；若是產品問題，排進 H8（轉場）。`verify:holo --full` 對這一種 FAIL 有 known-on-main 對照規則（見 `scripts/verify/README.md`），其他 FAIL 不受影響。

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
