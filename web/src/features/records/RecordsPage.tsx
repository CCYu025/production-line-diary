import { emptyFilter, filterRecords, hasActiveFilter, sortByDate } from "@shared/aggregate";
import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeta, useRecords } from "@/lib/queries";
import type { DiaryRecord } from "@/lib/types";
import { useRecordFilterParams } from "@/lib/urlQuery";
import { useOpenRecordParam } from "./core/useOpenRecordParam";
import { chronological } from "./filterUtils";
import { FilterBar } from "./FilterBar";
import { RecordDetailSheet } from "./RecordDetailSheet";
import { RecordList } from "./RecordList";

const NO_RECORDS: readonly DiaryRecord[] = [];

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mt-4 flex flex-col gap-2">
      <span className="sr-only">載入中…</span>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="rounded-lg border border-line bg-surface-raised p-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="mt-2 h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

/**
 * 紀錄列表（docs/refactor-plan.md §4 U3、U4）。
 * 篩選條件、排序方向、開著哪一筆詳情（?open=）全部在網址裡：可以複製網址、重新整理、按上一頁。
 */
export function RecordsPage() {
  const records = useRecords();
  const meta = useMeta();
  const [filter, setFilter] = useRecordFilterParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const sortDesc = searchParams.get("sort") !== "asc"; // 預設新到舊

  const active = React.useMemo(() => (records.data ?? []).filter((r) => !r.deleted), [records.data]);
  const rows = React.useMemo(() => sortByDate(filterRecords(active, filter), sortDesc), [active, filter, sortDesc]);
  // 詳情的上一筆／下一筆：照「全部有效紀錄」的時間順序走，不跟列表的篩選或排序方向（刻意維持的既有行為）
  const sequence = React.useMemo(() => chronological(active), [active]);
  const { openRecord, openDetail, closeDetail, switchDetail, getReturnFocus } = useOpenRecordParam(active, !!records.data);

  const toggleSort = () =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (sortDesc) p.set("sort", "asc");
        else p.delete("sort");
        return p;
      },
      { replace: true },
    );

  const clearAll = () => setFilter(emptyFilter());

  return (
    <>
      <PageHeader title="紀錄列表" />

      {records.isPending ? (
        <ListSkeleton />
      ) : records.isError ? (
        <ErrorState
          title="載入紀錄失敗"
          error={records.error}
          retrying={records.isFetching}
          onRetry={() => void records.refetch()}
        />
      ) : (
        <>
          <FilterBar
            filter={filter}
            setFilter={setFilter}
            active={active}
            knownEquipment={meta.data?.equipment ?? []}
            knownCategories={meta.data?.categories ?? []}
            sortDesc={sortDesc}
            onToggleSort={toggleSort}
            shown={rows.length}
            total={active.length}
            onClear={clearAll}
          />

          <div className="mt-3">
            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line-strong bg-surface px-4 py-10 text-center">
                {active.length === 0 ? (
                  <>
                    <p className="font-bold">還沒有任何紀錄</p>
                    <Button variant="primary" className="mt-3" asChild>
                      <Link to="/records/new">新增紀錄</Link>
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="font-bold">沒有符合條件的紀錄</p>
                    {hasActiveFilter(filter) ? (
                      <Button className="mt-3" onClick={clearAll}>
                        清除全部條件
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            ) : (
              <RecordList
                rows={rows}
                sortDesc={sortDesc}
                onToggleSort={toggleSort}
                onOpen={openDetail}
                onCopy={(id) => navigate(`/records/new?copy=${id}`)}
              />
            )}
          </div>
        </>
      )}

      <RecordDetailSheet
        record={openRecord}
        sequence={sequence}
        records={records.data ?? NO_RECORDS}
        onNavigate={switchDetail}
        onClose={closeDetail}
        getReturnFocus={getReturnFocus}
      />
    </>
  );
}
