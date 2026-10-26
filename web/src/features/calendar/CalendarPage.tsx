import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { aggregate, emptyFilter } from "@shared/aggregate";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecords } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { recordFilterToParams } from "@/lib/urlQuery";
import {
  buildMonthGrid,
  colorStep,
  formatMonthParam,
  monthOf,
  parseMonthParam,
  sameMonth,
  shiftMonth,
  STEP_CLASS,
  todayIso,
  WEEKDAYS,
  WEEKDAY_NAMES,
  type YearMonth,
} from "./calendarModel";

const cellBase =
  "relative flex h-full min-h-[3.25rem] w-full flex-col rounded-sm p-1 text-left md:min-h-[5.5rem] md:rounded-md md:p-2";

function useCalendarMonth() {
  const [searchParams, setSearchParams] = useSearchParams();
  const current = monthOf(new Date());
  const month = parseMonthParam(searchParams.get("month")) ?? current;
  // 預設的「本月」不寫進網址；換月用 push，瀏覽器上一頁就回到上一個月
  const go = (next: YearMonth) => {
    const params = new URLSearchParams(searchParams);
    if (sameMonth(next, current)) params.delete("month");
    else params.set("month", formatMonthParam(next));
    setSearchParams(params);
  };
  return { month, current, go };
}

export function CalendarPage() {
  const { data: records, isPending, isError, error, refetch, isRefetching } = useRecords();
  const navigate = useNavigate();
  const { month, current, go } = useCalendarMonth();

  const { countByDate, maxCount } = React.useMemo(() => {
    const trend = records ? aggregate(records).trend : [];
    return {
      countByDate: new Map(trend.map((t) => [t.date, t.count])),
      maxCount: trend.reduce((m, t) => Math.max(m, t.count), 0),
    };
  }, [records]);

  const weeks = React.useMemo(() => buildMonthGrid(month), [month]);
  const today = todayIso();
  const label = `${month.year} 年 ${month.month} 月`;

  // 點格子 → 紀錄列表，先清掉其他條件，只帶入那一天（from = to）
  const drillTo = (date: string) => {
    const params = recordFilterToParams({ ...emptyFilter(), from: date, to: date });
    navigate({ pathname: "/records", search: `?${params.toString()}` });
  };

  return (
    <>
      <PageHeader title="日曆" description="依日期彙整當日異常事件次數，顏色越深代表當日次數越多" />

      {isError ? (
        <ErrorState title="載入紀錄失敗" error={error} onRetry={() => void refetch()} retrying={isRefetching} />
      ) : (
        <div className="rounded-lg border border-line bg-surface-raised p-2 md:p-5">
          <div className="mb-3 flex items-center justify-between gap-2 px-1 md:mb-4">
            <h2 className="whitespace-nowrap text-base font-bold" aria-live="polite">
              {label}
            </h2>
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="icon" aria-label="上個月" onClick={() => go(shiftMonth(month, -1))}>
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                variant="secondary"
                className="px-3"
                onClick={() => go(current)}
                disabled={sameMonth(month, current)}
              >
                本月
              </Button>
              <Button variant="secondary" size="icon" aria-label="下個月" onClick={() => go(shiftMonth(month, 1))}>
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </div>

          {isPending ? (
            <div role="status" aria-label="載入中">
              <Skeleton className="h-[26rem] w-full" />
            </div>
          ) : (
            <table className="w-full table-fixed border-separate border-spacing-0.5 md:border-spacing-1.5" aria-label={label}>
              <thead>
                <tr>
                  {WEEKDAYS.map((d, i) => (
                    <th
                      key={d}
                      scope="col"
                      abbr={WEEKDAY_NAMES[i]}
                      className="pb-1 text-center text-xs font-medium text-ink-muted md:text-sm"
                    >
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, wi) => (
                  <tr key={wi}>
                    {week.map((cell, di) => {
                      if (!cell) return <td key={di} aria-hidden="true" />;
                      const count = countByDate.get(cell.date) ?? 0;
                      const isToday = cell.date === today;
                      // 今天：日期數字加粗＋底線（不用外框——外框會跟鍵盤焦點環混在一起）
                      const todayNum = isToday && "font-bold underline decoration-2 underline-offset-2";
                      const dayLabel = `${month.month} 月 ${cell.day} 日${isToday ? "（今天）" : ""}`;
                      if (count === 0) {
                        return (
                          <td key={di} className="p-0 align-top">
                            <div
                              className={cn(cellBase, "border border-line bg-surface text-ink-2")}
                              aria-current={isToday ? "date" : undefined}
                              aria-label={`${dayLabel}，無紀錄`}
                            >
                              <span className={cn("num text-xs md:text-sm", todayNum)}>{cell.day}</span>
                            </div>
                          </td>
                        );
                      }
                      const step = colorStep(count, maxCount);
                      return (
                        <td key={di} className="p-0 align-top">
                          <button
                            type="button"
                            data-step={step}
                            data-date={cell.date}
                            className={cn(
                              cellBase,
                              "cursor-pointer transition-[filter] hover:brightness-110",
                              STEP_CLASS[step],
                            )}
                            aria-current={isToday ? "date" : undefined}
                            aria-label={`${dayLabel}，${count} 筆紀錄，查看當日紀錄`}
                            onClick={() => drillTo(cell.date)}
                          >
                            <span className={cn("num text-xs opacity-90 md:text-sm", todayNum)} aria-hidden="true">
                              {cell.day}
                            </span>
                            <span
                              className="num mt-auto self-center text-base font-bold leading-none md:mb-1 md:text-xl"
                              aria-hidden="true"
                            >
                              {count}
                              <span className="hidden text-xs font-medium md:inline"> 次</span>
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-ink-muted md:mt-4 md:text-sm">
            <span>事件次數：</span>
            <Swatch className="border border-line bg-surface" label="無紀錄" />
            <Swatch className="bg-seq-300" label="較少" />
            <Swatch className="bg-seq-700" label="較多" />
          </div>
        </div>
      )}
    </>
  );
}

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn("size-3.5 rounded-sm", className)} />
      {label}
    </span>
  );
}
