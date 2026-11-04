/*
 * 開機決策（docs/os-mode-spec.md §5.5、D3）：純函式＋sessionStorage 存取。
 * - 完整開機（≤ 4s）：這個分頁工作階段第一次顯示控制室。
 * - 短開機（≤ 1s，只有 B3＋B4）：之後控制室再度掛載（重新整理、重新進入 OS 模式）。
 * - 從工作站回控制室不是「掛載」，導演走離開轉場，不開機。
 * - 直接載入工作站（深層連結）：不開機、也不寫 key。
 * - 減少動態效果：不開機（key 也不寫：沒有播過、也沒有被跳過）。
 * key 在開機播完或被跳過時才寫（markBootDone）。
 */
import type { Place } from "./reducer";

export const BOOT_STORAGE_KEY = "pld.os.boot";

export type BootKind = "full" | "short";

export interface BootDecisionInput {
  /** 第一個路徑決定的位置 */
  place: Place;
  /** prefers-reduced-motion: reduce */
  reduced: boolean;
  /** 這個分頁工作階段是否已經開過機（sessionStorage key 已寫） */
  done: boolean;
}

/** 決定這次掛載要不要開機、開哪一種；null＝不開機。 */
export function decideBoot({ place, reduced, done }: BootDecisionInput): BootKind | null {
  if (reduced) return null;
  if (place.kind !== "hub") return null;
  return done ? "short" : "full";
}

let doneInMemory = false;

/** 這個分頁工作階段是否開過機（sessionStorage 讀取失敗時只靠記憶體變數）。 */
export function readBootDone(): boolean {
  if (doneInMemory) return true;
  try {
    return window.sessionStorage.getItem(BOOT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 開機播完或被跳過：寫 key。 */
export function markBootDone(): void {
  doneInMemory = true;
  try {
    window.sessionStorage.setItem(BOOT_STORAGE_KEY, "1");
  } catch {
    /* 隱私模式：只靠記憶體變數 */
  }
}

/** 測試用：回到「還沒開過機」。 */
export function resetBootDoneForTest(): void {
  doneInMemory = false;
  try {
    window.sessionStorage.removeItem(BOOT_STORAGE_KEY);
  } catch {
    /* 略 */
  }
}
