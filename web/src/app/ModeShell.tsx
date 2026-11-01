import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { setMode, useMode } from "@/lib/mode";
import { AppShell } from "./AppShell";
import { loadOsShell } from "./osEntry";

export { ENTER_OS_STATE, preloadOsShell } from "./osEntry";

// OS 外殼整個延遲載入：網頁模式永遠不會執行這行 import()，所以不下載任何 3D 程式碼（docs/os-mode-spec.md §3.2、A5）。
const OsShell = React.lazy(loadOsShell);

/**
 * 根路由的外殼：網頁模式是現有 AppShell（沒有任何額外 DOM），OS 模式是延遲載入的 OsShell。
 * 以 useMode() 訂閱：執行期切換模式（側欄「OS 模式」、EXIT TO WEB、WebGL 後備）不需要重新載入頁面。
 */
export function ModeShell() {
  const mode = useMode();
  const previous = React.useRef(mode);

  // OS → 網頁：AppShell 剛掛上，把焦點移到主要內容（子元件的 effect 先跑，所以 #main 已經存在）
  React.useEffect(() => {
    const before = previous.current;
    previous.current = mode;
    if (before === "os" && mode === "web") document.getElementById("main")?.focus({ preventScroll: true });
  }, [mode]);

  if (mode === "os") {
    return (
      <React.Suspense fallback={null}>
        <OsShell />
      </React.Suspense>
    );
  }
  return <AppShell />;
}

/** index 路由（/）：網頁模式 → 儀表板，OS 模式 → 控制室。 */
export function IndexRedirect() {
  const mode = useMode();
  return <Navigate to={mode === "os" ? "/os" : "/dashboard"} replace />;
}

/**
 * /os 路由：控制室只在 OS 模式存在；網頁模式導向儀表板。OS 模式下由 OsShell 自己畫控制室，這裡什麼都不畫。
 * 例外：側欄按鈕是「先導覽到 /os（帶 ENTER_OS_STATE），抵達後才 setMode("os")」——
 * 導覽先走 router，頁面上的 useBlocker（未儲存變更）才攔得到；使用者取消就不會切換模式，也不會卸載表單。
 */
export function OsRouteElement() {
  const mode = useMode();
  const location = useLocation();
  const entering = mode === "web" && (location.state as { enterOs?: boolean } | null)?.enterOs === true;
  React.useLayoutEffect(() => {
    if (entering) setMode("os");
  }, [entering]);
  return mode === "os" || entering ? null : <Navigate to="/dashboard" replace />;
}
