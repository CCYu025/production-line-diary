import * as React from "react";
import { useFx } from "@/lib/fx";

/**
 * FX-01 開機畫面（docs/cyber-theme-spec.md §6.2、D4）：App 冷啟動、儀表板資料還在載入時，用終端機印出的載入步驟取代骨架的「視覺」。
 * 規則：
 *  - 只在 cyber 且沒有減少動態效果（useFx()）時出現；每個瀏覽器分頁只出現一次（sessionStorage），換頁、重新整理都不再出現。
 *  - 載入不到約 150ms 完全不顯示（那段時間只有載入狀態的無障礙文字，沒有任何視覺）；資料一到就由呼叫端換成內容，不延後任何東西。
 *  - 開機行一律 aria-hidden；載入狀態的無障礙文字與骨架相同（role="status"、aria-busy、「載入中…」）。
 *  - 按任意鍵或點擊跳過（改回一般骨架）；不攔截、不吞掉那次按鍵。
 */
export const BOOT_SHOW_DELAY_MS = 150;
const BOOT_KEY = "pld.boot";

let consumed = false;

function readConsumed(): boolean {
  if (consumed) return true;
  try {
    return window.sessionStorage.getItem(BOOT_KEY) === "1";
  } catch {
    return false;
  }
}

/** 這個分頁的開機畫面已用掉（顯示過、被跳過、或第一個畫面根本不是儀表板）。 */
export function consumeBoot(): void {
  consumed = true;
  try {
    window.sessionStorage.setItem(BOOT_KEY, "1");
  } catch {
    /* 隱私模式：只靠模組變數，本次載入內不會再出現 */
  }
}

/** 測試用：回到「還沒開過機」。 */
export function resetBootForTest(): void {
  consumed = false;
  try {
    window.sessionStorage.removeItem(BOOT_KEY);
  } catch {
    /* 略 */
  }
}

const LINES = ["> 連線本機伺服器…", "> 讀取紀錄…"];

/**
 * 載入中的外殼：呼叫端傳入原本的骨架（fallback）。符合條件時先空白 150ms，之後印開機行；否則直接是骨架。
 * 無障礙結構在兩種畫面都一樣（role="status"、aria-busy、sr-only「載入中…」）。
 */
export function BootLoading({ skeleton }: { skeleton: React.ReactNode }) {
  const fx = useFx();
  const [mode] = React.useState<"boot" | "plain">(() => (fx && !readConsumed() ? "boot" : "plain"));
  const [phase, setPhase] = React.useState<"wait" | "boot" | "skipped">("wait");

  React.useEffect(() => {
    if (mode !== "boot") return;
    const t = window.setTimeout(() => setPhase((p) => (p === "wait" ? "boot" : p)), BOOT_SHOW_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [mode]);

  // 資料到了（卸載）或畫面被跳過：這個分頁的開機畫面就用掉了
  React.useEffect(() => {
    if (mode !== "boot") return;
    return () => consumeBoot();
  }, [mode]);

  React.useEffect(() => {
    if (mode !== "boot" || phase === "skipped") return;
    const skip = () => {
      setPhase("skipped");
      consumeBoot();
    };
    window.addEventListener("keydown", skip, { passive: true });
    window.addEventListener("pointerdown", skip, { passive: true });
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [mode, phase]);

  if (mode === "plain" || phase === "skipped") return <>{skeleton}</>;

  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">載入中…</span>
      {phase === "boot" ? (
        <div aria-hidden="true" data-fx-boot="" className="flex flex-col gap-1 p-2 text-sm text-ink-2">
          {LINES.map((line, i) => (
            <p key={line} data-fx-boot-line="" style={{ "--i": i } as React.CSSProperties}>
              {line}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
