import * as React from "react";
import { Navigate } from "react-router-dom";
import { getMode } from "@/lib/mode";
import { AppShell } from "./AppShell";

// OS 外殼整個延遲載入：網頁模式永遠不會執行這行 import()，所以不下載任何 3D 程式碼（docs/os-mode-spec.md §3.2、A5）。
const OsShell = React.lazy(() => import("@/features/os/OsShell"));

/** 根路由的外殼：網頁模式是現有 AppShell（沒有任何額外 DOM），OS 模式是延遲載入的 OsShell。 */
export function ModeShell() {
  if (getMode() === "os") {
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
  return <Navigate to={getMode() === "os" ? "/os" : "/dashboard"} replace />;
}

/** /os 路由：控制室只在 OS 模式存在；網頁模式導向儀表板。OS 模式下由 OsShell 自己畫控制室，這裡什麼都不畫。 */
export function OsRouteElement() {
  return getMode() === "os" ? null : <Navigate to="/dashboard" replace />;
}
