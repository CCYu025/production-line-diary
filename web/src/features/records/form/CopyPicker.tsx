import { Search } from "lucide-react";
import * as React from "react";
import { commonProblems, sortByDate } from "@shared/aggregate";
import { inputClass } from "@/components/Combobox";
import { cn } from "@/lib/utils";
import type { DiaryRecord } from "@/lib/types";

type Tab = "recent" | "common";

interface PickerItem {
  key: string;
  record: DiaryRecord;
  title: string;
  meta: string;
}

const shortDate = (r: DiaryRecord) => r.date.slice(5).replace("-", "/");

function matches(r: DiaryRecord, kw: string): boolean {
  if (!kw) return true;
  return [r.problem, r.equipment, r.category, r.action, r.rootCause ?? ""].join(" ").toLowerCase().includes(kw);
}

/** 「最近紀錄」：複製特定那一筆。「常見問題」：依「分類＋問題」歸併，以最近一筆當範本。 */
export function buildPickerItems(records: readonly DiaryRecord[], tab: Tab, query: string, limit = 8): PickerItem[] {
  const kw = query.trim().toLowerCase();
  const alive = records.filter((r) => !r.deleted);
  if (tab === "recent") {
    return sortByDate(alive, true)
      .filter((r) => matches(r, kw))
      .slice(0, limit)
      .map((r) => ({
        key: `r${r.id}`,
        record: r,
        title: r.problem,
        meta: `${shortDate(r)} ${r.time}・${r.equipment}・${r.category}`,
      }));
  }
  return commonProblems(alive)
    .filter((g) => matches(g.record, kw))
    .slice(0, limit)
    .map((g) => ({
      key: `c${g.category}\u0000${g.problem}`,
      record: g.record,
      title: g.problem,
      meta: `累計 ${g.count} 次・${g.category}・最近 ${shortDate(g.record)} ${g.record.equipment}`,
    }));
}

interface CopyPickerProps {
  records: readonly DiaryRecord[];
  onPick: (record: DiaryRecord) => void;
}

const LISTBOX_ID = "cp-listbox";

/**
 * 頂端「從過去紀錄帶入」：搜尋（問題／設備／分類／處理／根本原因）＋「最近紀錄／常見問題」兩個分頁，
 * ↓↑ 移動、Enter 帶入、Esc 收合。「常見」chips 也在這裡（整個畫面只有這一處，不再有問題欄下方的重複建議列）。
 */
export function CopyPicker({ records, onPick }: CopyPickerProps) {
  const [query, setQuery] = React.useState("");
  const [tab, setTab] = React.useState<Tab>("recent");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null); // 輸入框＋下拉清單

  const items = React.useMemo(() => buildPickerItems(records, tab, query), [records, tab, query]);
  const chips = React.useMemo(() => commonProblems(records.filter((r) => !r.deleted)).slice(0, 4), [records]);

  React.useEffect(() => {
    setActive(items.length ? 0 : -1);
  }, [items]);

  React.useEffect(() => {
    if (open && active >= 0) document.getElementById(`cp-opt-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  const pick = (record: DiaryRecord) => {
    setOpen(false);
    setQuery("");
    onPick(record);
  };

  return (
    <section
      aria-labelledby="cp-title"
      className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-3 md:p-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 id="cp-title" className="text-sm font-bold">
          從過去紀錄帶入
        </h2>
        <span className="text-xs text-ink-muted">選一筆，只需再改日期／時間／設備</span>
      </div>

      <div
        ref={rootRef}
        className="relative"
        // 焦點離開「輸入框＋下拉清單（含分頁鈕）」才收起——Tab 到下方的「常見」chips 就會收起；
        // 焦點在輸入框與分頁鈕之間移動不收
        onBlur={(e) => {
          if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `cp-opt-${active}` : undefined}
          aria-label="搜尋過去紀錄"
          placeholder="搜尋過去紀錄：問題、設備、處理內容…"
          autoComplete="off"
          value={query}
          className={cn(inputClass, "pl-9")}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (open) {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }
              return;
            }
            if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setOpen(true);
              return;
            }
            if (!items.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % items.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + items.length) % items.length);
            } else if (e.key === "Enter" && open) {
              e.preventDefault();
              const it = items[active];
              if (it) pick(it.record);
            }
          }}
        />

        {open ? (
          <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-line-strong bg-surface-raised shadow-pop">
            <div role="tablist" aria-label="帶入來源" className="flex border-b border-line">
              {(
                [
                  ["recent", "最近紀錄"],
                  ["common", "常見問題"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  // 不讓輸入框失焦；鍵盤使用者仍可用 Tab 走到分頁鈕
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setTab(value)}
                  className={cn(
                    "h-11 flex-1 text-sm font-medium text-ink-2 md:h-10",
                    tab === value ? "border-b-2 border-accent font-bold text-ink-1" : "hover:bg-surface",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <ul id={LISTBOX_ID} role="listbox" tabIndex={-1} aria-label={tab === "recent" ? "最近紀錄" : "常見問題"} className="max-h-72 overflow-auto py-1">
              {items.length ? (
                items.map((it, i) => (
                  <li
                    key={it.key}
                    id={`cp-opt-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => setActive(i)}
                    onClick={() => pick(it.record)}
                    className={cn("cursor-pointer px-3 py-2", i === active ? "bg-accent-wash" : "hover:bg-surface")}
                  >
                    <div className="truncate text-sm font-bold">{it.title}</div>
                    <div className="num truncate text-xs text-ink-2">{it.meta}</div>
                    <div className="truncate text-xs text-ink-muted">處理：{it.record.action || "（未填寫）"}</div>
                  </li>
                ))
              ) : (
                <li role="presentation" className="px-3 py-3 text-sm text-ink-muted">
                  {query.trim() ? "找不到符合的紀錄，直接在下方手動填寫即可" : "還沒有可帶入的紀錄"}
                </li>
              )}
            </ul>
            <p className="border-t border-line px-3 py-1.5 text-xs text-ink-muted">
              {tab === "recent" ? "複製「那一筆」的內容" : "同分類＋問題歸併，以最近一筆當範本"}
            </p>
          </div>
        ) : null}
      </div>

      {chips.length ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="常見問題">
          <span className="text-xs text-ink-muted">常見：</span>
          {chips.map((g) => (
            <button
              key={`${g.category}\u0000${g.problem}`}
              type="button"
              onClick={() => pick(g.record)}
              className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-line-strong bg-surface-raised px-3 text-sm text-ink-1 hover:bg-accent-wash md:min-h-9"
            >
              <span className="min-w-0 truncate">{g.problem}</span>
              <span className="num shrink-0 text-xs text-ink-muted">×{g.count}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
