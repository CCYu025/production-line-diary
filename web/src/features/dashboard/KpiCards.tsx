import { ChevronRight } from "lucide-react";
import type * as React from "react";
import { StatusGlyph } from "@/components/badges";
import type { Aggregate, Status } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * KPI 分兩級（docs/refactor-plan.md §4 U2）：
 *   主要（可行動）：待處理、追蹤中（含「n 筆待補根本原因」），較大、可點進列表（先清掉舊條件再帶入單一值）
 *   次要：累計事件數、累計時間、平均處理耗時、照片建檔率，較小的一列
 * 固定欄數（主要 2 欄；次要手機 2 欄、md 以上 4 欄），不會有孤立卡片換行。
 * 用語：「累計時間」——絕不寫「停機」（資料只記處理耗時，並不等於停機時間）。
 */

function ActionKpi({
  status,
  value,
  hint,
  onSelect,
}: {
  status: Status;
  value: number;
  hint: string;
  onSelect: () => void;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-sm font-medium text-ink-2">
        <StatusGlyph status={status} />
        {status}
      </span>
      <span className="mt-2 flex items-baseline gap-1">
        <span data-fx="kpi-num" className="num text-4xl font-bold leading-none">{value.toLocaleString()}</span>
        <span className="text-sm font-medium text-ink-2">筆</span>
      </span>
      <span className="mt-2 block text-xs text-ink-muted">{hint}</span>
    </>
  );
  const base = "block w-full rounded-lg border border-line bg-surface-raised p-4 text-left md:p-5";
  // 0 筆沒有東西可看，不做成按鈕（舊 UI 同樣只在有資料時才可點）
  // data-fx-alert：只有「待處理」> 0 才輸出（沒有警示時整個屬性不存在）；panel-cut 在 0 筆（<div>）與可點（<button>）兩種元素上都有
  const alertAttr = status === "待處理" && value > 0 ? { "data-fx-alert": "" } : {};
  if (value === 0)
    return (
      <div data-fx="panel-cut" className={base}>
        {body}
      </div>
    );
  return (
    <button
      type="button"
      data-fx="panel-cut"
      {...alertAttr}
      onClick={onSelect}
      aria-label={`${status} ${value} 筆，查看紀錄`}
      className={cn(base, "relative hover:border-accent hover:bg-surface")}
    >
      {body}
      <ChevronRight className="absolute right-3 top-4 size-5 text-ink-muted" aria-hidden="true" />
    </button>
  );
}

function MiniKpi({ label, value, unit, sub }: { label: string; value: React.ReactNode; unit: string; sub: string }) {
  return (
    <div data-fx="panel" className="rounded-lg border border-line bg-surface-raised px-4 py-3">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span data-fx="kpi-num" className="num text-2xl font-bold leading-none">{value}</span>
        <span className="text-xs font-medium text-ink-2">{unit}</span>
      </p>
      <p className="mt-1 truncate text-xs text-ink-muted">{sub}</p>
    </div>
  );
}

export function KpiCards({ agg, onDrill }: { agg: Aggregate; onDrill: (status: Status) => void }) {
  const pending = agg.statusCounts.find((s) => s.label === "待處理")?.count ?? 0;
  const tracking = agg.trackingRows.length;
  const photoPct = agg.totalEvents ? Math.round((agg.withPhoto / agg.totalEvents) * 100) : 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <ActionKpi status="待處理" value={pending} hint="尚未開始處理的事件" onSelect={() => onDrill("待處理")} />
        <ActionKpi
          status="追蹤中"
          value={tracking}
          hint={`${agg.rootCauseMissing} 筆待補根本原因`}
          onSelect={() => onDrill("追蹤中")}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniKpi label="累計事件數" value={agg.totalEvents.toLocaleString()} unit="筆" sub="所有已記錄之異常事件" />
        <MiniKpi
          label="累計時間"
          value={agg.totalMinutes.toLocaleString()}
          unit="分"
          sub={`約 ${(agg.totalMinutes / 60).toFixed(1)} 小時`}
        />
        <MiniKpi label="平均處理耗時" value={agg.avg.toFixed(1)} unit="分/件" sub="單次事件平均處理時間" />
        <MiniKpi
          label="照片建檔率"
          value={photoPct}
          unit="%"
          sub={`${agg.withPhoto} / ${agg.totalEvents} 筆附有照片`}
        />
      </div>
    </div>
  );
}
