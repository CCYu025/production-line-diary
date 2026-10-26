import type * as React from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** 標籤前的小標記（色條、狀態圖示…），純裝飾 */
  prefix?: React.ReactNode;
  /** 筆數（facet counts）；0 會淡化但仍可點 */
  count?: number;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 群組的名稱（輔助科技唸出來），例如「處理狀態」 */
  label: string;
  className?: string;
}

/**
 * 分段按鈕（常駐、單選）。每顆是真正的 <button aria-pressed>，Tab / Space / Enter 可操作。
 * 用在儀表板範圍切換與紀錄列表的狀態、嚴重度篩選。
 */
export function SegmentedControl<T extends string>({ options, value, onChange, label, className }: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex flex-wrap gap-0.5 max-md:grid max-md:flex-nowrap max-md:grid-flow-col max-md:auto-cols-fr rounded-md border border-line-strong bg-surface-raised p-0.5", className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex min-h-11 min-w-11 items-center justify-center whitespace-nowrap rounded-sm px-1 text-sm transition-colors max-md:flex-col max-md:py-1 md:min-h-9 md:gap-1.5 md:px-2.5",
              on ? "bg-accent font-bold text-accent-ink" : "text-ink-2 hover:bg-surface hover:text-ink-1",
              !on && o.count === 0 && "text-ink-muted",
            )}
          >
            <span className="inline-flex items-center gap-1">
              {o.prefix}
              {o.label}
            </span>
            {o.count !== undefined ? (
              <>
                {/* 視覺上是數字；輔助科技唸「待處理，3 筆」，不要唸成「待處理3」 */}
                <span aria-hidden="true" className={cn("num text-xs", on ? "opacity-90" : "text-ink-muted")}>
                  {o.count}
                </span>
                <span className="sr-only">，{o.count} 筆</span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
