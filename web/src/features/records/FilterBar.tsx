import { facetCounts, hasActiveFilter, SEVERITY_ORDER, STATUS_ORDER } from "@shared/aggregate";
import { ArrowDownUp, Search, X } from "lucide-react";
import * as React from "react";
import { SEVERITY_BG, StatusGlyph } from "@/components/badges";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { SegmentedControl, type SegmentedOption } from "@/components/SegmentedControl";
import type { DiaryRecord, RecordFilter, Severity, Status } from "@/lib/types";
import { cn, labelOrUnfilled } from "@/lib/utils";
import { DateRangeFilter } from "./DateRangeFilter";
import { dateLabel, multiOptions } from "./filterUtils";

type SetFilter = (update: RecordFilter | ((prev: RecordFilter) => RecordFilter), opts?: { replace?: boolean }) => void;

interface FilterBarProps {
  filter: RecordFilter;
  setFilter: SetFilter;
  /** 全部「有效」紀錄（未軟刪除）；筆數都從這裡算 */
  active: readonly DiaryRecord[];
  knownEquipment: readonly string[];
  knownCategories: readonly string[];
  sortDesc: boolean;
  onToggleSort: () => void;
  shown: number;
  total: number;
  onClear: () => void;
}

function sum(counts: Readonly<Record<string, number>>): number {
  return Object.values(counts).reduce((s, n) => s + n, 0);
}

/**
 * 紀錄列表的篩選列（docs/refactor-plan.md §2 紀錄列表篩選、§4 U3）。
 *   固定值（狀態、嚴重度）：常駐分段按鈕，帶筆數；
 *   開放清單（設備、分類）：可搜尋的多選下拉，帶筆數；
 *   日期：from～to 區間；
 *   筆數一律是 facetCounts：套用「其他所有條件」、不套用自己這一維，所以選了 F3 之後還能加選第二台。
 * 所有條件都在網址裡（useRecordFilterParams），所以重新整理、複製網址、上一頁都能回到同一組條件。
 */
export function FilterBar({
  filter,
  setFilter,
  active,
  knownEquipment,
  knownCategories,
  sortDesc,
  onToggleSort,
  shown,
  total,
  onClear,
}: FilterBarProps) {
  // 搜尋框：自己留一份文字（網址那份會被 trim，結尾的空白會被吃掉）；條件從別處改了（清除全部…）再同步回來。
  const [text, setText] = React.useState(filter.query);
  React.useEffect(() => {
    setText((cur) => (cur.trim() === filter.query ? cur : filter.query));
  }, [filter.query]);

  const statusCounts = facetCounts(active, filter, "status");
  const severityCounts = facetCounts(active, filter, "severity");
  const statusOptions: SegmentedOption<Status | "">[] = [
    { value: "", label: "全部", count: sum(statusCounts) },
    ...STATUS_ORDER.map((s) => ({
      value: s,
      label: s,
      count: statusCounts[s] ?? 0,
      prefix: <StatusGlyph status={s} className="text-ink-2" />,
    })),
  ];
  const severityOptions: SegmentedOption<Severity | "">[] = [
    { value: "", label: "全部", count: sum(severityCounts) },
    ...SEVERITY_ORDER.map((s) => ({
      value: s,
      label: s,
      count: severityCounts[s] ?? 0,
      prefix: <span aria-hidden="true" data-fx="sev" data-severity={s} className={cn("h-3.5 w-1 rounded-full", SEVERITY_BG[s])} />,
    })),
  ];

  const chips: { key: string; label: string; remove: () => void }[] = [
    ...filter.equipment.map((v) => ({
      key: `equipment:${v}`,
      label: `設備：${labelOrUnfilled(v)}`,
      remove: () => setFilter((f) => ({ ...f, equipment: f.equipment.filter((x) => x !== v) })),
    })),
    ...filter.category.map((v) => ({
      key: `category:${v}`,
      label: `分類：${labelOrUnfilled(v)}`,
      remove: () => setFilter((f) => ({ ...f, category: f.category.filter((x) => x !== v) })),
    })),
    ...(filter.from || filter.to
      ? [{ key: "date", label: `日期：${dateLabel(filter)}`, remove: () => setFilter((f) => ({ ...f, from: "", to: "" })) }]
      : []),
    ...(filter.problem
      ? [{ key: "problem", label: `問題：${filter.problem}`, remove: () => setFilter((f) => ({ ...f, problem: "" })) }]
      : []),
  ];

  return (
    <div className="-mx-4 border-b border-line bg-page px-4 pb-3 pt-1 lg:sticky lg:top-0 lg:z-20 lg:-mx-7 lg:px-7">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative basis-full lg:min-w-[14rem] lg:flex-1 lg:basis-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <input
            type="search"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFilter((f) => ({ ...f, query: e.target.value }), { replace: true });
            }}
            placeholder="搜尋設備、問題、處理內容、根本原因…"
            aria-label="搜尋紀錄"
            className="h-11 w-full rounded-md border border-line-strong bg-surface-raised pl-9 pr-3 text-sm placeholder:text-ink-muted md:h-10"
          />
        </div>
        <DateRangeFilter
          from={filter.from}
          to={filter.to}
          onChange={(range, opts) => setFilter((f) => ({ ...f, ...range }), opts)}
        />
        <MultiSelectFilter
          label="設備"
          options={multiOptions("equipment", knownEquipment, active, filter.equipment)}
          counts={facetCounts(active, filter, "equipment")}
          selected={filter.equipment}
          onChange={(next) => setFilter((f) => ({ ...f, equipment: next }))}
        />
        <MultiSelectFilter
          label="分類"
          options={multiOptions("category", knownCategories, active, filter.category)}
          counts={facetCounts(active, filter, "category")}
          selected={filter.category}
          onChange={(next) => setFilter((f) => ({ ...f, category: next }))}
        />
        <button
          type="button"
          onClick={onToggleSort}
          className="ml-auto inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-sm text-ink-2 hover:bg-surface-raised hover:text-ink-1 md:min-h-9 lg:ml-0"
        >
          <ArrowDownUp className="size-4" aria-hidden="true" />
          日期 {sortDesc ? "新 → 舊" : "舊 → 新"}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="處理狀態"
          options={statusOptions}
          value={filter.status}
          onChange={(v) => setFilter((f) => ({ ...f, status: v }))}
          className="max-md:w-full"
        />
        <SegmentedControl
          label="嚴重度"
          options={severityOptions}
          value={filter.severity}
          onChange={(v) => setFilter((f) => ({ ...f, severity: v }))}
          className="max-md:w-full"
        />
        <span className="ml-auto flex items-center gap-3 text-sm text-ink-2">
          {hasActiveFilter(filter) ? (
            <button type="button" onClick={onClear} className="inline-flex min-h-11 items-center text-accent-text hover:underline md:min-h-8">
              清除全部
            </button>
          ) : null}
          <span aria-live="polite" data-testid="result-count" className="whitespace-nowrap">
            共 <b className="num">{shown}</b> / {total} 筆
          </span>
        </span>
      </div>

      {chips.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="active-filters">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={c.remove}
              aria-label={`移除 ${c.label}`}
              data-fx="chip"
              className="inline-flex min-h-11 items-center gap-1 rounded-full border border-accent bg-accent-wash py-0.5 pl-3 pr-2 text-sm text-ink-1 hover:bg-surface md:min-h-8"
            >
              <span className="max-w-[16rem] truncate">{c.label}</span>
              <X className="size-3.5 text-ink-muted" aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
