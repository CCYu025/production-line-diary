import { aggregate } from "@shared/aggregate";
import * as React from "react";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeta, useRecords } from "@/lib/queries";

function Stat({ label, value, unit, hint }: { label: string; value: number; unit: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-raised p-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1">
        <span className="num text-3xl font-bold leading-none">{value.toLocaleString()}</span>
        <span className="text-sm font-medium text-ink-2">{unit}</span>
      </p>
      {hint ? <p className="mt-1.5 truncate text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div role="status" aria-busy="true" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <span className="sr-only">載入中…</span>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="rounded-lg border border-line bg-surface-raised p-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-3 h-8 w-20" />
          <Skeleton className="mt-3 h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

/**
 * 空殼（圖表與 KPI 在 WP3a）。目前只證明「資料有成功載入」：
 * 紀錄筆數來自 GET /api/records，彙總數字由 @shared/aggregate 在瀏覽器端算，建議清單來自 GET /api/meta。
 */
export function DashboardPage() {
  const records = useRecords();
  const meta = useMeta();

  const summary = React.useMemo(() => (records.data ? aggregate(records.data, "all") : null), [records.data]);
  const trashed = records.data ? records.data.filter((r) => r.deleted).length : 0;

  return (
    <>
      <PageHeader title="儀表板" description="新介面預覽版：圖表與 KPI 尚未實作（預計於 WP3a 完成）。" />

      {records.isPending || meta.isPending ? (
        <StatsSkeleton />
      ) : records.isError || meta.isError ? (
        <ErrorState
          title="載入資料失敗"
          error={records.error ?? meta.error}
          retrying={records.isFetching || meta.isFetching}
          onRetry={() => {
            void records.refetch();
            void meta.refetch();
          }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <p role="status" className="text-sm text-ink-2">
            資料載入成功：共 <span className="num font-bold text-ink-1">{summary?.totalEvents ?? 0}</span> 筆有效紀錄
            （另有 <span className="num font-bold text-ink-1">{trashed}</span> 筆在回收桶）。
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="累計事件數" value={summary?.totalEvents ?? 0} unit="筆" />
            <Stat label="累計時間" value={summary?.totalMinutes ?? 0} unit="分鐘" />
            <Stat
              label="設備種類"
              value={meta.data.equipment.length}
              unit="種"
              hint={meta.data.equipment.slice(0, 6).join("・")}
            />
            <Stat
              label="問題分類"
              value={meta.data.categories.length}
              unit="種"
              hint={meta.data.categories.slice(0, 4).join("・")}
            />
          </div>
        </div>
      )}
    </>
  );
}
