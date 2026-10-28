import * as React from "react";
import { StatusGlyph } from "@/components/badges";
import type { Aggregate, RankEntry, Severity, Status } from "@/lib/types";
import { cn, labelOrUnfilled } from "@/lib/utils";

/*
 * 儀表板圖表。全部是手刻 HTML / SVG（沒有圖表函式庫）。
 * 規則（docs/refactor-plan.md §2）：依維度拆分的圖表一律用「次數」；分鐘只出現在 KPI 的純量。
 * 每個可點的長條／圖例／趨勢柱都是真正的 <button>（鍵盤 Tab + Enter/Space 可觸發篩選）。
 */

export function ChartCard({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} data-fx="panel" className={cn("min-w-0 rounded-lg border border-line bg-surface-raised p-4 md:p-5", className)}>
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-base font-bold">
          {title}
        </h2>
        {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function ChartEmpty({ children = "這個範圍還沒有紀錄" }: { children?: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-ink-muted">{children}</p>;
}

/* ---------- 橫條圖（設備發生次數、問題分類發生次數） ---------- */

export function HBarChart({
  rows,
  onSelect,
  actionLabel,
}: {
  rows: readonly RankEntry[];
  onSelect: (label: string) => void;
  /** 例如「查看設備」，用在按鈕的無障礙名稱 */
  actionLabel: string;
}) {
  if (rows.length === 0) return <ChartEmpty />;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="flex flex-col gap-0.5">
      {rows.map((r) => (
        <li key={r.label}>
          <button
            type="button"
            data-fx="bar-row"
            onClick={() => onSelect(r.label)}
            aria-label={`${actionLabel}：${labelOrUnfilled(r.label)}，${r.count} 次`}
            className="grid min-h-11 w-full grid-cols-[minmax(3.5rem,7rem)_minmax(0,1fr)_3.5rem] items-center gap-3 rounded-md px-2 text-left hover:bg-surface md:min-h-9"
          >
            {/* 舊資料可能設備／分類是空字串：顯示「（未填）」，但點下去仍帶入 ""（精確篩到那些紀錄） */}
            <span className={cn("truncate text-sm", r.label.trim() === "" && "text-ink-muted")} title={labelOrUnfilled(r.label)}>
              {labelOrUnfilled(r.label)}
            </span>
            <span data-fx="bar-track" className="h-2.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <span
                data-fx="bar"
                className="block h-full rounded-full bg-accent"
                style={{ width: `${Math.max(4, Math.round((r.count / max) * 100))}%` }}
              />
            </span>
            <span className="num text-right text-sm">{r.count} 次</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ---------- 嚴重度分布（甜甜圈，stroke-dasharray 技巧） ---------- */

const SEVERITY_STROKE: Record<Severity, string> = {
  輕微: "stroke-good",
  一般: "stroke-warning",
  嚴重: "stroke-serious",
  重大: "stroke-critical",
};
const SEVERITY_FILL: Record<Severity, string> = {
  輕微: "bg-good",
  一般: "bg-warning",
  嚴重: "bg-serious",
  重大: "bg-critical",
};

export function SeverityDonut({
  counts,
  onSelect,
}: {
  counts: Aggregate["severityCounts"];
  onSelect: (severity: Severity) => void;
}) {
  const total = counts.reduce((s, r) => s + r.count, 0);
  const cx = 60;
  const cy = 60;
  const r = 42;
  const sw = 22;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-8">
      <svg viewBox="0 0 120 120" role="img" aria-label={`嚴重度分布，共 ${total} 次`} className="size-40 shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={sw} className="stroke-line" />
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          {counts
            .filter((s) => s.count > 0)
            .map((s) => {
              const len = total ? (s.count / total) * circ : 0;
              const el = (
                <circle
                  key={s.label}
                  data-fx="sev"
                  data-severity={s.label}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  strokeWidth={sw}
                  strokeDasharray={`${len} ${circ - len}`}
                  strokeDashoffset={-offset}
                  className={cn(SEVERITY_STROKE[s.label], "cursor-pointer")}
                  onClick={() => onSelect(s.label)}
                >
                  <title>{`${s.label} ${s.count} 次`}</title>
                </circle>
              );
              offset += len;
              return el;
            })}
        </g>
        <text x={cx} y={cy - 2} textAnchor="middle" dominantBaseline="central" className="num fill-ink-1 text-[22px] font-bold">
          {total}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" className="fill-ink-muted text-[9px]">
          次
        </text>
      </svg>
      <ul className="grid w-full max-w-xs grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-1">
        {counts.map((s) => (
          <li key={s.label}>
            <button
              type="button"
              onClick={() => onSelect(s.label)}
              className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-surface md:min-h-9"
            >
              <span
                aria-hidden="true"
                data-fx="sev"
                data-severity={s.label}
                className={cn("size-3 shrink-0 rounded-sm", SEVERITY_FILL[s.label])}
              />
              <span>{s.label}</span>
              <span className="num ml-auto font-bold">{s.count}</span>
              <span className="text-ink-muted">次</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- 處理狀態總覽（堆疊條）：形狀 + 中性色，不再與嚴重度共用紅綠 ---------- */

const STATUS_FILL: Record<Status, string> = {
  待處理: "bg-ink-muted/35",
  追蹤中: "bg-ink-muted/70",
  已解決: "bg-ink-2",
};

export function StatusStack({
  counts,
  onSelect,
}: {
  counts: Aggregate["statusCounts"];
  onSelect: (status: Status) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* 堆疊條本身只給滑鼠點（aria-hidden、不佔 Tab）；鍵盤與輔助科技走下面的圖例按鈕，內容完全相同 */}
      <div className="flex h-11 w-full gap-0.5 overflow-hidden rounded-md bg-line md:h-8" aria-hidden="true">
        {counts
          .filter((s) => s.count > 0)
          .map((s) => (
            <button
              key={s.label}
              type="button"
              data-status={s.label}
              onClick={() => onSelect(s.label)}
              tabIndex={-1}
              title={`${s.label} ${s.count} 筆`}
              className={cn("h-full min-w-2 hover:brightness-110", STATUS_FILL[s.label])}
              style={{ flexGrow: s.count, flexBasis: 0 }}
            />
          ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
        {counts.map((s) => (
          <li key={s.label} className="min-w-[8rem] flex-1">
            <button
              type="button"
              onClick={() => onSelect(s.label)}
              className="flex min-h-11 w-full items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm hover:bg-surface md:min-h-9"
            >
              <span aria-hidden="true" className={cn("size-3 shrink-0 rounded-sm", STATUS_FILL[s.label])} />
              <StatusGlyph status={s.label} className="text-ink-2" />
              <span>{s.label}</span>
              <span className="num ml-auto font-bold">{s.count}</span>
              <span className="text-ink-muted">筆</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- 每日異常次數趨勢 ---------- */

function fmtDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${m}/${d}`;
}

const TREND_MAX_PX = 96;

export function TrendChart({
  trend,
  onSelect,
}: {
  trend: Aggregate["trend"];
  onSelect: (date: string) => void;
}) {
  const scroller = React.useRef<HTMLDivElement>(null);
  // 最新的日子在右邊：一開始就捲到最右
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [trend]);
  if (trend.length === 0) return <ChartEmpty />;
  const max = Math.max(...trend.map((t) => t.count), 1);
  return (
    <div ref={scroller} className="overflow-x-auto pb-1">
      <ol className="flex min-w-max items-end gap-1">
        {trend.map((t) => (
          <li key={t.date}>
            <button
              type="button"
              data-fx="trend-col"
              data-date={t.date}
              onClick={() => onSelect(t.date)}
              aria-label={`${t.date}，${t.count} 次，查看紀錄`}
              className="flex w-11 flex-col items-center justify-end gap-1 rounded-md px-0.5 pb-1 pt-2 hover:bg-surface md:w-10"
            >
              <span className="num text-xs">{t.count}</span>
              <span
                aria-hidden="true"
                data-fx="trend-bar"
                className="block w-5 rounded-sm bg-accent"
                style={{ height: Math.max(8, Math.round((t.count / max) * TREND_MAX_PX)) }}
              />
              <span className="num text-xs text-ink-muted">{fmtDate(t.date)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
