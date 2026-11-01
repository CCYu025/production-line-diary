/*
 * 裝置門檻（docs/os-mode-spec.md §7）：視窗寬度 < 1024 或高度 < 600 時，不渲染控制室／WebGL／頁面，
 * 只顯示終端機風格訊息與「改用網頁模式」；視窗放大後自動進入（子樹重新掛載，直接落在目前路徑對應的狀態，沒有轉場）。
 */
import * as React from "react";
import { setMode } from "@/lib/mode";

export const MIN_WIDTH = 1024;
export const MIN_HEIGHT = 600;

export function isDesktopViewport(width: number, height: number): boolean {
  return width >= MIN_WIDTH && height >= MIN_HEIGHT;
}

/** 視窗大小是否達到門檻（resize 時更新）。 */
export function useDesktopViewport(): boolean {
  const subscribe = React.useCallback((onChange: () => void) => {
    window.addEventListener("resize", onChange);
    return () => window.removeEventListener("resize", onChange);
  }, []);
  return React.useSyncExternalStore(
    subscribe,
    () => isDesktopViewport(window.innerWidth, window.innerHeight),
    () => true,
  );
}

export function DeviceGate({ children }: { children: React.ReactNode }) {
  const ok = useDesktopViewport();
  if (ok) return <>{children}</>;
  return (
    <div className="os-gate" data-os="device-gate">
      <h1 className="os-gate-title">PLD/OS</h1>
      <p>&gt; PLD/OS 需要桌面終端機（≥1024×600）</p>
      <p>&gt; 放大視窗後會自動進入；也可以改用網頁模式。</p>
      <button type="button" className="os-gate-button" data-os="device-gate-web" onClick={() => setMode("web")}>
        改用網頁模式
      </button>
    </div>
  );
}
