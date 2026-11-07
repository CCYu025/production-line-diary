import * as React from "react";
import { Navigate, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { setMode, useMode } from "@/lib/mode";
import { AppShell } from "./AppShell";
import { loadOsShell, type OsNavState } from "./osEntry";

export { ENTER_OS_STATE, preloadOsShell } from "./osEntry";

// OS 外殼整個延遲載入：網頁模式永遠不會執行這行 import()，所以不下載任何 3D 程式碼（docs/os-mode-spec.md §3.2、A5）。
const OsShell = React.lazy(loadOsShell);

/**
 * 「幽靈」/os 紀錄的處理（X5）：側欄進入 OS 模式時 /os 是一筆 PUSH，從工作站離開後它還留在歷史中間（… 原頁、/os、目前頁）。
 * 網頁模式下 /os 一律導向儀表板，所以上一頁要按兩次（第一次落在儀表板，第二次才回原頁）。
 * 修法：網頁模式經 POP 抵達 /os 時，沿著同一個方向（上一頁／下一頁）再走一步，使用者感覺不到這筆紀錄。
 * 方向由 react-router 存在 history.state 的位置序號 idx 判斷（IdxTracker 記下上一個位置的 idx）；
 * 讀不到 idx（記憶體路由）、或那個方向沒有紀錄可走，就維持原本的行為（導向儀表板）。
 */
const historyIdx = (): number | null => {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx : null;
};
let lastIdx: number | null = null;

/** 每次換位置之後記下 idx（effect 先於它的子孫跑，所以 OsRouteElement 讀到的是「上一個位置」的 idx）。 */
function IdxTracker() {
  const location = useLocation();
  React.useEffect(() => {
    lastIdx = historyIdx();
  }, [location]);
  return null;
}

/** 這個 POP 抵達的 /os 該再走幾步（-1／1）；0＝不處理。 */
function ghostStep(): -1 | 0 | 1 {
  const cur = historyIdx();
  if (cur === null || lastIdx === null || cur === lastIdx) return 0;
  if (cur < lastIdx) return cur > 0 ? -1 : 0;
  return cur < window.history.length - 1 ? 1 : 0;
}

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

  return (
    <>
      {mode === "os" ? (
        <React.Suspense fallback={null}>
          <OsShell />
        </React.Suspense>
      ) : (
        <AppShell />
      )}
      <IdxTracker />
    </>
  );
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
  // 網頁模式經上一頁／下一頁抵達的 /os 是幽靈紀錄：沿同方向再走一步（走不了就導向儀表板）
  const step = React.useMemo(() => (mode === "web" && navType === "POP" ? ghostStep() : 0), [mode, navType, location.key]);
  const [gaveUp, setGaveUp] = React.useState(false);
  React.useEffect(() => {
    if (step === 0) return;
    void navigate(step);
    const t = window.setTimeout(() => setGaveUp(true), 800);
    return () => window.clearTimeout(t);
  }, [step, navigate, location.key]);
  React.useLayoutEffect(() => {
    if (!entering) return;
    setMode("os");
    void navigate(location.pathname + location.search, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entering]);
  return mode === "os" || entering || leaving || (step !== 0 && !gaveUp) ? null : <Navigate to="/dashboard" replace />;
}
