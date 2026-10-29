import { Terminal } from "lucide-react";
import { flushSync } from "react-dom";
import { switchTheme } from "@/lib/theme";
import { useThemePreference } from "@/lib/useThemePreference";
import { cn } from "@/lib/utils";

/**
 * 「CYBER 介面」切換按鈕的共用定義（docs/cyber-theme-spec.md D1）。
 * 桌面側欄、平板圖示列、手機「更多」面板各自用自己的版型，但都從這裡取文字、圖示、行為與狀態標記，不各寫一份。
 *
 * 語意：<button type="button" aria-pressed>，可存取名稱固定為 label，不隨狀態改名——狀態由 aria-pressed 表達，
 * 視覺上的「開／關」標記是 aria-hidden。點下去立刻切換並記住偏好；不重新整理、不移動焦點、不跳 toast。
 */
export const THEME_TOGGLE = { label: "CYBER 介面", icon: Terminal } as const;

type ViewTransitionDoc = Document & { startViewTransition?: (update: () => void) => { finished: Promise<unknown> } };

/**
 * FX-38：只有「切到 cyber」且沒有減少動態效果、瀏覽器支援 View Transitions 時，用 VT 掃描一次（300ms，cyber.css 的 data-vt="theme"）；
 * 切回標準、減少動態效果、不支援的瀏覽器都是直接切換。切換前 data-theme 還不是 cyber，所以 useFx() 此時一定是 false，要自己檢查減少動態效果。
 */
function switchToCyber(): void {
  const doc = document as ViewTransitionDoc;
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof doc.startViewTransition !== "function") {
    switchTheme("cyber");
    return;
  }
  const root = document.documentElement;
  root.dataset.vt = "theme";
  const clear = () => {
    delete root.dataset.vt;
  };
  try {
    const transition = doc.startViewTransition(() => flushSync(() => switchTheme("cyber")));
    void transition.finished.then(clear, clear);
  } catch {
    clear();
    switchTheme("cyber");
  }
}

export function useThemeToggle() {
  const isCyber = useThemePreference() === "cyber";
  return {
    isCyber,
    toggle: () => (isCyber ? switchTheme("standard") : switchToCyber()),
  };
}

/** 右側的小狀態標記：關＝ink-muted、開＝accent-text。aria-hidden，不影響按鈕的可存取名稱。 */
export function ThemeToggleState({ isCyber, className }: { isCyber: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("text-xs font-medium", isCyber ? "text-accent-text" : "text-ink-muted", className)}>
      {isCyber ? "開" : "關"}
    </span>
  );
}
