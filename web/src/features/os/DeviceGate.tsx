/*
 * 裝置門檻（docs/os-mode-spec.md §7）：視窗寬度 < 1024 或高度 < 600 時顯示終端機風格訊息與「改用網頁模式」，蓋在最上面。
 * 已經掛載的舞台不卸載（縮小視窗不能丟掉表單內容、也不銷毀 WebGL context），只是隱藏＋inert，並由舞台暫停繪製與快速鍵；
 * 冷啟動時就太小則完全不掛載舞台，放大後才掛載，直接落在目前路徑對應的狀態（沒有轉場）。
 */
import * as React from "react";

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

export interface DeviceGateProps {
  /** 「改用網頁模式」：走和 EXIT TO WEB 相同的 route-first 路徑（未儲存的表單先經過 useBlocker 確認） */
  onUseWeb: () => void;
  /** active＝視窗達到門檻。子樹一旦掛載過就不再卸載（縮小視窗不能丟掉表單內容），只是隱藏＋inert，由 OsStage 自己暫停。 */
  children: (active: boolean) => React.ReactNode;
}

export function DeviceGate({ onUseWeb, children }: DeviceGateProps) {
  const ok = useDesktopViewport();
  // 冷啟動就太小：還沒掛載過舞台（不建 3D、不載入頁面）；放大後才掛載，直接落在目前路徑的狀態
  const [mounted, setMounted] = React.useState(ok);
  if (ok && !mounted) setMounted(true);
  const hiddenProps = ok ? undefined : { inert: "" };
  return (
    <>
      {mounted ? (
        <div data-os="stage-host" hidden={!ok} aria-hidden={ok ? undefined : true} {...(hiddenProps as object)}>
          {children(ok)}
        </div>
      ) : null}
      {ok ? null : (
        <div className="os-gate" data-os="device-gate">
          <div className="os-gate-term">
            <div className="os-gate-bar" aria-hidden="true">
              PLD/OS 1995 — TERMINAL
            </div>
            <div className="os-gate-body">
              <h1 className="os-gate-title">PLD/OS</h1>
              <p>&gt; PLD/OS 需要桌面終端機（≥1024×600）</p>
              <p>
                &gt; 放大視窗後會自動進入；也可以改用網頁模式。
                <span className="os-gate-cursor" aria-hidden="true">
                  ▮
                </span>
              </p>
              <button type="button" className="os-gate-button" data-os="device-gate-web" onClick={onUseWeb}>
                改用網頁模式
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
