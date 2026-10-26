import { Factory, Loader2, Plus } from "lucide-react";
import * as React from "react";
import { Link, useMatch } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTrashCount } from "@/lib/queries";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, type NavEntry } from "./nav";
import { useExportAction } from "./useExportAction";

export const navItemClass =
  "relative flex h-11 w-full items-center justify-center gap-3 rounded-md px-3 text-sm font-medium text-ink-2 " +
  "transition-colors hover:bg-surface-raised hover:text-ink-1 lg:justify-start";

export function CountBadge({ count, className }: { count: number | undefined; className?: string }) {
  if (!count) return null;
  return (
    <span
      className={cn(
        "num inline-flex min-w-5 items-center justify-center rounded-full bg-critical px-1.5 text-xs font-bold leading-5 text-critical-ink",
        className,
      )}
    >
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{count} 筆</span>
    </span>
  );
}

/** 平板（768–1023）收合成圖示列時，文字隱藏，改用 tooltip 標示名稱；桌面有文字，不需要 tooltip。 */
function MaybeTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const isDesktop = useIsDesktop();
  return (
    <Tooltip {...(isDesktop ? { open: false } : {})}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function ExportItem({ entry }: { entry: Extract<NavEntry, { kind: "action" }> }) {
  const exporter = useExportAction();
  const Icon = entry.icon;
  return (
    <MaybeTooltip label={entry.label}>
      <button
        type="button"
        className={navItemClass}
        onClick={() => void exporter.run()}
        disabled={exporter.pending}
        aria-busy={exporter.pending}
      >
        {exporter.pending ? (
          <Loader2 className="size-5 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <Icon className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
        )}
        <span className="sr-only lg:not-sr-only">{exporter.pending ? "匯出中…" : entry.label}</span>
      </button>
    </MaybeTooltip>
  );
}

/**
 * 自己判斷「目前頁面」的導覽連結，className 是純字串——
 * 這樣才能放進 Radix 的 asChild（Slot 會把 className 當字串合併，NavLink 的 className 函式會被弄壞）。
 */
const RailLink = React.forwardRef<
  HTMLAnchorElement,
  Omit<React.ComponentProps<typeof Link>, "children"> & { to: string; end?: boolean; children: (active: boolean) => React.ReactNode }
>(function RailLink({ to, end, className, children, ...props }, ref) {
  const active = useMatch({ path: to, end: end ?? false }) !== null;
  return (
    <Link
      ref={ref}
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        navItemClass,
        active && "bg-accent-wash font-bold text-accent-text hover:bg-accent-wash hover:text-accent-text",
        className,
      )}
      {...props}
    >
      {children(active)}
    </Link>
  );
});

function LinkItem({ entry }: { entry: Extract<NavEntry, { kind: "link" }> }) {
  const trashCount = useTrashCount();
  const Icon = entry.icon;
  return (
    <MaybeTooltip label={entry.label}>
      <RailLink to={entry.to} end={entry.end ?? false}>
        {(active) => (
          <>
            <Icon className={cn("size-5 shrink-0", active ? "text-accent-text" : "text-ink-muted")} aria-hidden="true" />
            <span className="sr-only lg:not-sr-only">{entry.label}</span>
            {entry.badge === "trash" && (
              <CountBadge count={trashCount} className="absolute right-1 top-1 lg:static lg:ml-auto" />
            )}
          </>
        )}
      </RailLink>
    </MaybeTooltip>
  );
}

/**
 * 桌面（≥ 1024px）：完整側欄。平板（768–1023px）：收合成圖示列。手機（< 768px）不顯示，改用底部分頁列。
 */
export function Sidebar() {
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh w-16 shrink-0 flex-col gap-4 border-r border-line px-2 py-5 md:flex lg:w-56 lg:px-3.5 print:hidden",
      )}
    >
      <Link
        to="/dashboard"
        aria-label="產線日誌，回到儀表板"
        className="flex items-center justify-center gap-2.5 rounded-md border-b border-line px-1 pb-3 lg:justify-start lg:px-2"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-linear-to-br from-accent to-seq-600 text-white">
          <Factory className="size-5" aria-hidden="true" />
        </span>
        <span className="hidden min-w-0 flex-col leading-tight lg:flex">
          <span className="whitespace-nowrap text-base font-bold">產線日誌</span>
          <span className="whitespace-nowrap text-xs text-ink-muted">設備異常紀錄</span>
        </span>
      </Link>

      <MaybeTooltip label="新增紀錄">
        <Button asChild size="lg" variant="primary" className="w-full px-0 lg:px-5">
          <Link to="/records/new">
            <Plus className="size-5" aria-hidden="true" />
            <span className="sr-only lg:not-sr-only">新增紀錄</span>
          </Link>
        </Button>
      </MaybeTooltip>

      <nav aria-label="主要導覽" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {NAV_GROUPS.map((group, i) => (
          <div key={group.label} role="group" aria-label={group.label} className="flex flex-col gap-1">
            <h2 className={cn("hidden px-3 pb-1 pt-3 text-xs font-medium text-ink-muted lg:block", i === 0 && "pt-1")}>
              {group.label}
            </h2>
            {i > 0 && <hr className="mx-2 my-2 border-line lg:hidden" />}
            {group.items.map((entry) => (
              entry.kind === "action" ? (
              <ExportItem key={entry.label} entry={entry} />
            ) : (
              <LinkItem key={entry.label} entry={entry} />
            )
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
