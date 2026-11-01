/*
 * 頻道表（docs/os-mode-spec.md §3.2、D4）：路徑 ↔ 頻道的唯一真相。
 * 頻道由路徑推導，OS 模式與網頁模式共用同一組路由。
 */

export type ChannelId = "CH-01" | "CH-02" | "CH-03" | "CH-04" | "CH-05" | "CH-06" | "CH-07";

export interface Channel {
  id: ChannelId;
  /** 中文名稱（HUD 按鈕、螢幕閱讀器公告） */
  name: string;
  /** 台標卡上的英文代號 */
  code: string;
  /** 從控制室進入時前往的路徑 */
  path: string;
  /** 屬於這個頻道的路由樣式（與 routes.tsx 的 path 一致，加上開頭的 "/"；:param 代表一段） */
  patterns: readonly string[];
}

export const CHANNELS: readonly Channel[] = [
  { id: "CH-01", name: "儀表板", code: "DASHBOARD", path: "/dashboard", patterns: ["/dashboard"] },
  { id: "CH-02", name: "紀錄", code: "RECORDS", path: "/records", patterns: ["/records", "/records/:id/edit"] },
  { id: "CH-03", name: "新增", code: "NEW", path: "/records/new", patterns: ["/records/new"] },
  { id: "CH-04", name: "日曆", code: "CALENDAR", path: "/calendar", patterns: ["/calendar"] },
  { id: "CH-05", name: "報表", code: "REPORT", path: "/report", patterns: ["/report"] },
  { id: "CH-06", name: "回收桶", code: "TRASH", path: "/trash", patterns: ["/trash"] },
  { id: "CH-07", name: "設定", code: "SETTINGS", path: "/settings", patterns: ["/settings"] },
];

/** 控制室的路由。 */
export const HUB_PATH = "/os";

function matches(pattern: string, pathname: string): boolean {
  const a = pattern.split("/");
  const b = pathname.split("/");
  if (a.length !== b.length) return false;
  return a.every((seg, i) => (seg.startsWith(":") ? !!b[i] : seg === b[i]));
}

function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/** 路徑 → 頻道；不屬於任何頻道（含控制室）回傳 null。 */
export function channelForPath(pathname: string): ChannelId | null {
  const p = normalize(pathname);
  for (const c of CHANNELS) if (c.patterns.some((pat) => matches(pat, p))) return c.id;
  return null;
}

export function getChannel(id: ChannelId): Channel {
  return CHANNELS.find((c) => c.id === id)!;
}

export function isHubPath(pathname: string): boolean {
  return normalize(pathname) === HUB_PATH;
}
