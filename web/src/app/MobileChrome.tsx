import { CalendarDays, Ellipsis, LayoutDashboard, List, Loader2, Plus } from "lucide-react";
import * as React from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useFx } from "@/lib/fx";
import { useTrashCount } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { MORE_ITEMS, MORE_PATHS, type NavEntry } from "./nav";
import { CountBadge } from "./Sidebar";
import { THEME_TOGGLE, ThemeToggleState, useThemeToggle } from "./themeToggle";
import { titleTypeProps } from "@/lib/fx/titleType";
import { useExportAction } from "./useExportAction";

/** 手機（< 768px）頂部標題列：只放頁面標題（品牌字不換行成直排）。 */
export function MobileTopBar({ title }: { title: string }) {
  const fx = useFx();
  return (
    <header data-fx="topbar" className="sticky top-0 z-30 flex h-14 items-center border-b border-line bg-page px-4 pt-[env(safe-area-inset-top)] md:hidden print:hidden">
      {/* 視覺標題；頁面真正的 <h1> 在 PageHeader（手機版僅供輔助科技讀取），避免標題重複 */}
      <p key={title} aria-hidden="true" data-fx="page-title" className="truncate text-lg font-bold" {...titleTypeProps(title, fx)}>
        {title}
      </p>
    </header>
  );
}

const tabClass =
  "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium text-ink-muted transition-colors";

function Tab({ to, label, icon: Icon }: { to: string; label: string; icon: typeof List }) {
  return (
    <NavLink
      to={to}
     
      end={to === "/records"}
      data-fx="nav-item"
      className={({ isActive }) => cn(tabClass, isActive && "font-bold text-accent-text")}
    >
      <Icon className="size-6" aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  );
}

function MoreRow({ entry, onDone }: { entry: NavEntry; onDone: () => void }) {
  const trashCount = useTrashCount();
  const exporter = useExportAction();
  const Icon = entry.icon;
  const rowClass =
    "flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-base font-medium text-ink-1 hover:bg-surface";

  if (entry.kind === "action") {
    return (
      <button
        type="button"
        data-fx="nav-item"
        className={rowClass}
        disabled={exporter.pending}
        aria-busy={exporter.pending}
        onClick={() => {
          onDone();
          void exporter.run();
        }}
      >
        {exporter.pending ? (
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        ) : (
          <Icon className="size-5 text-ink-muted" aria-hidden="true" />
        )}
        {entry.label}
      </button>
    );
  }
  return (
    <SheetClose asChild>
      <Link to={entry.to} data-fx="nav-item" className={rowClass}>
        <Icon className="size-5 text-ink-muted" aria-hidden="true" />
        {entry.label}
        {entry.badge === "trash" && <CountBadge count={trashCount} className="ml-auto" />}
      </Link>
    </SheetClose>
  );
}

/** 「更多」面板的最後一列：介面主題切換。就地動作，按下後面板不關閉。 */
function ThemeToggleRow() {
  const { isCyber, toggle } = useThemeToggle();
  const Icon = THEME_TOGGLE.icon;
  return (
    <button
      type="button"
      data-fx="nav-item"
      aria-pressed={isCyber}
      onClick={toggle}
      className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-base font-medium text-ink-1 hover:bg-surface"
    >
      <Icon className={cn("size-5", isCyber ? "text-accent-text" : "text-ink-muted")} aria-hidden="true" />
      {THEME_TOGGLE.label}
      <ThemeToggleState isCyber={isCyber} className="ml-auto text-sm" />
    </button>
  );
}

/**
 * 手機底部分頁列：儀表板／列表／（中央突出）新增／日曆／更多。
 * 「更多」開底部面板：報表、匯出、設定、回收桶。
 */
export function MobileTabBar() {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const { pathname } = useLocation();
  const moreButtonRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  // 開啟當下的路徑；關閉時若路徑變了（選了連結、或按瀏覽器上一頁），焦點交給 AppShell 的「換頁後聚焦主內容」，不要搶回「更多」。
  const openedAtRef = React.useRef(pathname);
  const pathnameRef = React.useRef(pathname);
  pathnameRef.current = pathname;

  // 換頁（含瀏覽器上一頁／下一頁）時關掉「更多」面板
  React.useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);
  const moreActive = MORE_PATHS.some((p) => pathname.startsWith(p));
  const trashCount = useTrashCount();

  return (
    <>
      <nav
        aria-label="底部導覽"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-raised pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5">
          <Tab to="/dashboard" label="儀表板" icon={LayoutDashboard} />
          <Tab to="/records" label="列表" icon={List} />

          <NavLink
            to="/records/new"
           
            data-fx="nav-item"
            className={({ isActive }) => cn(tabClass, "relative", isActive && "font-bold text-accent-text")}
          >
            {/* 中央突出的圓形＋按鈕（絕對定位往上凸出），文字標籤與其他分頁同一條基線 */}
            <span data-fx="fab" className="absolute -top-6 left-1/2 flex size-14 -translate-x-1/2 items-center justify-center rounded-full border-4 border-surface-raised bg-accent text-accent-ink shadow-pop">
              <Plus className="size-7" aria-hidden="true" />
            </span>
            <span className="size-6" aria-hidden="true" />
            <span>新增</span>
          </NavLink>

          <Tab to="/calendar" label="日曆" icon={CalendarDays} />

          <button
            ref={moreButtonRef}
            type="button"
            data-fx="nav-item"
            onClick={() => {
              openedAtRef.current = pathname;
              setMoreOpen(true);
            }}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={cn(tabClass, "relative", moreActive && "font-bold text-accent-text")}
            aria-current={moreActive ? "page" : undefined}
          >
            <span className="relative">
              <Ellipsis className="size-6" aria-hidden="true" />
              {trashCount ? (
                <span aria-hidden="true" className="absolute -right-1 -top-0.5 size-2.5 rounded-full bg-critical" />
              ) : null}
            </span>
            <span>更多</span>
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="gap-2 pb-4"
          // 受控、沒有 Trigger：自己決定開啟時焦點在第一個項目、關閉後焦點回到「更多」按鈕
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            listRef.current?.querySelector<HTMLElement>("a, button")?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (pathnameRef.current === openedAtRef.current) {
              moreButtonRef.current?.focus();
            } else {
              // 面板開著時換了頁（選連結、瀏覽器上一頁）：AppShell 的「換頁後聚焦主內容」跑的當下 Radix 還抓著焦點，
              // 所以等面板真正關完（這個回呼）再把焦點交給主內容，不然會掉到 body。
              document.getElementById("main")?.focus({ preventScroll: true });
            }
          }}
        >
          <SheetHeader>
            <SheetTitle>更多</SheetTitle>
            <SheetDescription className="sr-only">報表、匯出、設定與回收桶</SheetDescription>
          </SheetHeader>
          <ul ref={listRef} className="flex flex-col gap-1 px-3 pb-2">
            {MORE_ITEMS.map((entry) => (
              <li key={entry.label}>
                <MoreRow entry={entry} onDone={() => setMoreOpen(false)} />
              </li>
            ))}
          </ul>
          {/* 導覽清單之外的最後一列（不改變既有導覽清單的項目數與結構） */}
          <div className="mx-3 border-t border-line pb-2 pt-2">
            <ThemeToggleRow />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
