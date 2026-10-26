import type * as React from "react";
import { cn } from "@/lib/utils";
import type { Severity, Status } from "@/lib/types";

/*
 * 語意分離（docs/refactor-plan.md §4 U0）：
 *   嚴重度 → 用「顏色」：輕微綠、一般黃、嚴重橘、重大紅（色條 + 文字，文字永遠是 ink 色，確保對比）
 *   處理狀態 → 用「形狀」+ 中性色：待處理 ○、追蹤中 ◐、已解決 ●（不再與嚴重度共用紅色）
 */

export const SEVERITY_BG: Record<Severity, string> = {
  輕微: "bg-good",
  一般: "bg-warning",
  嚴重: "bg-serious",
  重大: "bg-critical",
};

interface BadgeProps extends React.ComponentProps<"span"> {
  /** 只顯示標記、不顯示文字（必須由外層提供文字替代，例如表格欄位標題） */
  compact?: boolean;
}

const pill = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line-strong bg-surface-raised py-0.5 pl-2 pr-2.5 text-xs font-medium text-ink-1";

export function SeverityBadge({ severity, compact, className, ...props }: BadgeProps & { severity: Severity }) {
  return (
    <span className={cn(pill, compact && "px-2", className)} data-severity={severity} {...props}>
      <span aria-hidden="true" className={cn("h-3.5 w-1 shrink-0 rounded-full", SEVERITY_BG[severity])} />
      <span className={cn(compact && "sr-only")}>{severity}</span>
    </span>
  );
}

export function StatusGlyph({ status, className }: { status: Status; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("size-3.5 shrink-0", className)}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      {status === "追蹤中" && <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />}
      {status === "已解決" && <circle cx="8" cy="8" r="6" fill="currentColor" />}
    </svg>
  );
}

export function StatusBadge({ status, compact, className, ...props }: BadgeProps & { status: Status }) {
  return (
    <span className={cn(pill, "text-ink-2", compact && "px-2", className)} data-status={status} {...props}>
      <StatusGlyph status={status} />
      <span className={cn(compact && "sr-only")}>{status}</span>
    </span>
  );
}
