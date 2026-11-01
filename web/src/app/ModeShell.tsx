import * as React from "react";
import { Navigate, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { setMode, useMode } from "@/lib/mode";
import { AppShell } from "./AppShell";
import { loadOsShell, type OsNavState } from "./osEntry";

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
 * 例外：側欄按鈕是「先導覽到 /os（帶 enterOs），抵達後才 setMode("os")」——
 * 導覽先走 router，頁面上的 useBlocker（未儲存變更）才攔得到；使用者取消就不會切換模式，也不會卸載表單。
 * 只在 PUSH／REPLACE 抵達時有效（上一頁回到舊的歷史紀錄不算），而且切換後立刻把 state 清掉。
 * exitToWeb（OsShell 從工作站離開 OS 模式）：模式已切成網頁、router 還沒 replace 回原路徑的那一瞬間，不要導向儀表板。
 */
export function OsRouteElement() {
  const mode = useMode();
  const location = useLocation();
  const navigate = useNavigate();
  const navType = useNavigationType();
  const st = location.state as OsNavState | null;
  const fresh = mode === "web" && navType !== "POP";
  const entering = fresh && st?.enterOs === true;
  const leaving = fresh && !!st?.exitToWeb;
  React.useLayoutEffect(() => {
    if (!entering) return;
    setMode("os");
    void navigate(location.pathname + location.search, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entering]);
  return mode === "os" || entering || leaving ? null : <Navigate to="/dashboard" replace />;
}
