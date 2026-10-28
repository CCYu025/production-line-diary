import * as React from "react";
import { getAppliedTheme, subscribeTheme } from "../theme";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function reducedMotionQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION) : null;
}

function subscribe(onChange: () => void): () => void {
  const unsubscribeTheme = subscribeTheme(onChange);
  const mql = reducedMotionQuery();
  mql?.addEventListener?.("change", onChange);
  return () => {
    unsubscribeTheme();
    mql?.removeEventListener?.("change", onChange);
  };
}

function getSnapshot(): boolean {
  if (getAppliedTheme() !== "cyber") return false;
  return !(reducedMotionQuery()?.matches ?? false);
}

/**
 * 是否要播 cyber 的 JS 動畫：只有 data-theme="cyber" 而且沒有開啟「減少動態效果」時才是 true。
 * 兩者任一改變都會即時更新。所有 JS 動畫（lib/fx）都要先檢查它；jsdom 沒有 data-theme，所以測試裡永遠是 false。
 */
export function useFx(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}
