import { datePresets } from "@shared/aggregate";
import { CalendarDays, ChevronDown } from "lucide-react";
import * as React from "react";
import { ResponsivePopover } from "@/components/ResponsivePopover";
import { cn } from "@/lib/utils";
import { dateLabel, isDateRangeReversed, plausibleDate } from "./filterUtils";

interface DateRangeFilterProps {
  from: string;
  to: string;
  /** replace = 打字中的中間值不要塞滿瀏覽歷史 */
  onChange: (range: Partial<{ from: string; to: string }>, opts?: { replace?: boolean }) => void;
}

const inputClass =
  "num h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface-raised px-2 text-sm text-ink-1 md:h-9";

/**
 * 日期區間：快捷（今天、本週、近 7 天、本月、近 30 天、全部）＋兩個原生日期輸入。
 * 為了不被瀏覽器的日期輸入框吃掉打到一半的值（Chrome 會重置）：
 *  - 輸入框的值自己留一份（打到一半的中間值只存在輸入框裡）；
 *  - 不設 min/max，也不自動改另一端；起 > 迄只顯示提示，列表為空；
 *  - 年份 < 1900 的中間值（逐位改年份時 0002 → 0020 → 0202 → 2026）不寫進條件。
 */
export function DateRangeFilter({ from, to, onChange }: DateRangeFilterProps) {
  const [open, setOpen] = React.useState(false);
  const [fromText, setFromText] = React.useState(from);
  const [toText, setToText] = React.useState(to);
  const hintId = React.useId();

  // 條件從別處改了（快捷、chip 的移除、清除全部、網址）就跟著更新輸入框；自己打字造成的更新值相同，不會改到。
  React.useEffect(() => setFromText(from), [from]);
  React.useEffect(() => setToText(to), [to]);

  const label = dateLabel({ from, to });
  const reversed = isDateRangeReversed({ from, to });

  return (
    <ResponsivePopover
      open={open}
      onOpenChange={setOpen}
      title="選擇日期"
      contentClassName="w-[19rem] p-4"
      trigger={
        <button
          type="button"
          className={cn(
            "inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-md border bg-surface-raised px-3 text-sm md:min-h-9",
            label ? "border-accent text-ink-1" : "border-line-strong text-ink-2 hover:text-ink-1",
          )}
        >
          <CalendarDays className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <span className="truncate">{label ? `日期：${label}` : "日期"}</span>
          <ChevronDown className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
        </button>
      }
    >
      <div className="px-4 pb-2 pt-1 md:p-0">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="日期快捷">
          {datePresets().map((p) => {
            const on = p.from === from && p.to === to;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ from: p.from, to: p.to })}
                className={cn(
                  "min-h-11 rounded-full border px-3 text-sm md:min-h-8",
                  on ? "border-accent bg-accent font-bold text-accent-ink" : "border-line-strong text-ink-2 hover:bg-surface",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <input
            type="date"
            aria-label="起日"
            aria-describedby={reversed ? hintId : undefined}
            className={inputClass}
            value={fromText}
            onChange={(e) => {
              setFromText(e.target.value);
              if (plausibleDate(e.target.value)) onChange({ from: e.target.value }, { replace: true });
            }}
          />
          <span aria-hidden="true" className="text-ink-muted">
            –
          </span>
          <input
            type="date"
            aria-label="迄日"
            aria-describedby={reversed ? hintId : undefined}
            className={inputClass}
            value={toText}
            onChange={(e) => {
              setToText(e.target.value);
              if (plausibleDate(e.target.value)) onChange({ to: e.target.value }, { replace: true });
            }}
          />
        </div>
        {reversed ? (
          <p id={hintId} role="status" className="mt-2 text-xs text-critical">
            起日晚於迄日，沒有符合的紀錄
          </p>
        ) : null}
      </div>
    </ResponsivePopover>
  );
}
