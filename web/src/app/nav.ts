import {
  CalendarDays,
  FileSpreadsheet,
  LayoutDashboard,
  List,
  Printer,
  Settings,
  Trash2,
  type LucideIcon,
} from "lucide-react";

/** 導覽項目：頁面連結（to）或動作按鈕（action）。桌面側欄、平板圖示列、手機「更多」共用同一份。 */
export type NavEntry =
  | { kind: "link"; to: string; label: string; icon: LucideIcon; end?: boolean; badge?: "trash" }
  | { kind: "action"; action: "export"; label: string; icon: LucideIcon };

export interface NavGroup {
  label: string;
  items: NavEntry[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "檢視",
    items: [
      { kind: "link", to: "/dashboard", label: "儀表板", icon: LayoutDashboard },
      // end：/records/new 不要讓「紀錄列表」也亮起來
      { kind: "link", to: "/records", label: "紀錄列表", icon: List, end: true },
      { kind: "link", to: "/calendar", label: "日曆", icon: CalendarDays },
    ],
  },
  {
    label: "輸出",
    items: [
      { kind: "link", to: "/report", label: "列印報表", icon: Printer },
      { kind: "action", action: "export", label: "匯出 Excel", icon: FileSpreadsheet },
    ],
  },
  {
    label: "管理",
    items: [
      { kind: "link", to: "/settings", label: "設備對照設定", icon: Settings },
      { kind: "link", to: "/trash", label: "回收桶", icon: Trash2, badge: "trash" },
    ],
  },
];

/** 手機底部分頁列「更多」裡的項目 */
export const MORE_ITEMS: NavEntry[] = [
  NAV_GROUPS[1]!.items[0]!, // 列印報表
  NAV_GROUPS[1]!.items[1]!, // 匯出 Excel
  NAV_GROUPS[2]!.items[0]!, // 設備對照設定
  NAV_GROUPS[2]!.items[1]!, // 回收桶
];

/** 屬於「更多」的路徑——這些頁面開著時，底部分頁列的「更多」要亮起來。 */
export const MORE_PATHS = ["/report", "/settings", "/trash"];

/** 各頁面標題（手機頂部標題列、document.title 用） */
export const PAGE_TITLES = {
  dashboard: "儀表板",
  records: "紀錄列表",
  recordsNew: "新增紀錄",
  calendar: "日曆",
  report: "列印報表",
  trash: "回收桶",
  settings: "設備對照設定",
  uiPreview: "元件預覽",
  notFound: "找不到頁面",
} as const;
