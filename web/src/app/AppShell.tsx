import * as React from "react";
import { Outlet, useLocation, useMatches } from "react-router-dom";
import { MobileTabBar, MobileTopBar } from "./MobileChrome";
import { Sidebar } from "./Sidebar";

export interface RouteHandle {
  title?: string;
}

function useRouteTitle(): string {
  const matches = useMatches();
  for (let i = matches.length - 1; i >= 0; i--) {
    const handle = matches[i]?.handle as RouteHandle | undefined;
    if (handle?.title) return handle.title;
  }
  return "產線日誌";
}

/**
 * App 外殼（docs/refactor-plan.md §4 U1）：
 *   ≥ 1024px  左側欄
 *   768–1023  圖示列（tooltip 標示名稱）
 *   < 768     頂部標題列 + 底部分頁列
 */
export function AppShell() {
  const title = useRouteTitle();
  const { pathname } = useLocation();
  const mainRef = React.useRef<HTMLElement>(null);
  const firstRender = React.useRef(true);

  React.useEffect(() => {
    document.title = title === "產線日誌" ? title : `${title}｜產線日誌`;
  }, [title]);

  // 換頁後把焦點移到主要內容，鍵盤／螢幕閱讀器使用者才知道頁面換了（第一次載入不搶焦點）。
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1320px] print:block print:min-h-0 print:max-w-none">
      <button
        type="button"
        className="sr-only z-[60] rounded-md bg-accent px-4 py-2 font-bold text-accent-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3 print:hidden"
        onClick={() => mainRef.current?.focus()}
      >
        跳到主要內容
      </button>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar title={title} />
        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 pb-28 pt-5 focus:outline-none md:px-7 md:pb-16 md:pt-6 print:p-0"
        >
          <Outlet />
        </main>
      </div>
      <MobileTabBar />
    </div>
  );
}
