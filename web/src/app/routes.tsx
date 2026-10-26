import { createHashRouter, Navigate } from "react-router-dom";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { RecordNewPage } from "@/features/records/RecordNewPage";
import { RecordsPage } from "@/features/records/RecordsPage";
import { ReportPage } from "@/features/report/ReportPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { TrashPage } from "@/features/trash/TrashPage";
import { AppShell, type RouteHandle } from "./AppShell";
import { PAGE_TITLES } from "./nav";

const handle = (title: string): RouteHandle => ({ title });

/**
 * Hash 路由（#/dashboard …）。用 hash 是因為 Express 不需要為前端路由做 fallback，
 * 而且網址可直接複製、書籤、瀏覽器上一頁都能用。
 *   #/dashboard  #/records?status=待處理  #/records/new  #/calendar  #/report  #/trash  #/settings
 */
export const routes = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "dashboard", element: <DashboardPage />, handle: handle(PAGE_TITLES.dashboard) },
      { path: "records", element: <RecordsPage />, handle: handle(PAGE_TITLES.records) },
      { path: "records/new", element: <RecordNewPage />, handle: handle(PAGE_TITLES.recordsNew) },
      { path: "calendar", element: <CalendarPage />, handle: handle(PAGE_TITLES.calendar) },
      { path: "report", element: <ReportPage />, handle: handle(PAGE_TITLES.report) },
      { path: "trash", element: <TrashPage />, handle: handle(PAGE_TITLES.trash) },
      { path: "settings", element: <SettingsPage />, handle: handle(PAGE_TITLES.settings) },
      // 元件預覽只在開發模式（npm run dev:web）存在；正式建置時整段（含頁面程式碼）會被移除。
      ...(import.meta.env.DEV
        ? [
            {
              path: "_ui",
              lazy: async () => ({ Component: (await import("@/features/ui-preview/UiPreviewPage")).UiPreviewPage }),
              handle: handle(PAGE_TITLES.uiPreview),
            },
          ]
        : []),
      // 不認得的網址一律回儀表板
      { path: "*", element: <Navigate to="/dashboard" replace /> },
    ],
  },
];

export const createRouter = () => createHashRouter(routes);
