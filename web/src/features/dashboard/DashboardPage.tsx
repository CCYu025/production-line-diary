import { aggregate } from "@shared/aggregate";
import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDrillTo } from "@/lib/drill";
import { useRecords } from "@/lib/queries";
import type { RangeKey } from "@/lib/types";
import { ChartCard, HBarChart, SeverityDonut, StatusStack, TrendChart } from "./charts";
import { KpiCards } from "./KpiCards";

const RANGE_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "month", label: "本月" },
  { value: "week", label: "本週" },
] as const satisfies readonly { value: RangeKey; label: string }[];

const RANGE_LABEL: Record<RangeKey, string> = { all: "全部", month: "本月", week: "本週" };

function parseRange(v: string | null): RangeKey {
  return v === "month" || v === "week" ? v : "all";
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">載入中…</span>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-lg border border-line bg-surface-raised p-5">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-4 h-9 w-20" />
            <Skeleton className="mt-3 h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-line bg-surface-raised px-4 py-3">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="mt-3 h-6 w-16" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-line bg-surface-raised p-5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-5 h-3 w-full" />
            <Skeleton className="mt-3 h-3 w-4/5" />
            <Skeleton className="mt-3 h-3 w-3/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 總覽儀表板（docs/refactor-plan.md §4 U2）。資料來自 GET /api/records，彙總由
 * `@shared/aggregate` 在瀏覽器端算（與後端、舊 UI 同一份邏輯）。範圍切換存在網址（?range=）。
 * 所有圖表、KPI 點下去都走 drillTo：清掉舊條件、只帶入這一個值，然後切到紀錄列表。
 */
export function DashboardPage() {
  const records = useRecords();
  const drillTo = useDrillTo();
  const [searchParams, setSearchParams] = useSearchParams();
  const range = parseRange(searchParams.get("range"));

  const setRange = (next: RangeKey) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === "all") p.delete("range");
        else p.set("range", next);
        return p;
      },
      { replace: true },
    );

  const agg = React.useMemo(() => (records.data ? aggregate(records.data, range) : null), [records.data, range]);
  const equipmentByCount = React.useMemo(
    () => (agg ? agg.equipmentRanked.slice().sort((a, b) => b.count - a.count) : []),
    [agg],
  );
  const hasAnyRecord = records.data ? records.data.some((r) => !r.deleted) : false;

  return (
    <>
      <PageHeader
        title="儀表板"
        description={agg ? `檢視範圍：${RANGE_LABEL[range]}　共 ${agg.totalEvents} 筆紀錄` : undefined}
        actions={<SegmentedControl label="檢視範圍" options={RANGE_OPTIONS} value={range} onChange={setRange} />}
      />

      {records.isPending ? (
        <DashboardSkeleton />
      ) : records.isError ? (
        <ErrorState
          title="載入紀錄失敗"
          error={records.error}
          retrying={records.isFetching}
          onRetry={() => void records.refetch()}
        />
      ) : agg ? (
        <div className="flex flex-col gap-4">
          {!hasAnyRecord ? (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line-strong bg-surface p-6 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-bold">還沒有任何紀錄</p>
                <p className="text-sm text-ink-muted">新增第一筆異常紀錄後，這裡就會出現統計與圖表。</p>
              </div>
              <Button variant="primary" asChild>
                <Link to="/records/new">新增紀錄</Link>
              </Button>
            </div>
          ) : null}

          <KpiCards agg={agg} onDrill={(status) => drillTo("status", status)} />

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="設備發生次數">
              <HBarChart rows={equipmentByCount} onSelect={(v) => drillTo("equipment", v)} actionLabel="查看設備" />
            </ChartCard>
            <ChartCard title="問題分類發生次數">
              <HBarChart rows={agg.categoryRanked} onSelect={(v) => drillTo("category", v)} actionLabel="查看分類" />
            </ChartCard>
            <ChartCard title="嚴重度分布">
              <SeverityDonut counts={agg.severityCounts} onSelect={(v) => drillTo("severity", v)} />
            </ChartCard>
            <ChartCard title="處理狀態總覽">
              <StatusStack counts={agg.statusCounts} onSelect={(v) => drillTo("status", v)} />
            </ChartCard>
            <ChartCard title="每日異常次數趨勢" hint="點一天查看當天紀錄" className="lg:col-span-2">
              <TrendChart trend={agg.trend} onSelect={(v) => drillTo("date", v)} />
            </ChartCard>
          </div>
        </div>
      ) : null}
    </>
  );
}
