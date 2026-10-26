import * as React from "react";
import { ErrorState } from "@/components/ErrorState";
import { useConfirm } from "@/components/ConfirmDialog";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/lib/feedback";
import { usePurgeRecord, useRecords, useRestoreRecord } from "@/lib/queries";
import type { DiaryRecord } from "@/lib/types";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { trashRows, formatDeletedAt } from "./trashModel";

const PURGE_DESCRIPTION =
  "這筆紀錄會被永久刪除，無法復原；它的照片也會一併從硬碟刪除（沒有其他紀錄使用的照片）。";

/** 回收桶（docs/refactor-plan.md §4 U7）：桌面表格、手機卡片；復原直接執行，永久刪除先確認。 */
export function TrashPage() {
  const { data: records, isPending, isError, error, refetch, isRefetching } = useRecords();
  const restore = useRestoreRecord();
  const purge = usePurgeRecord();
  const confirm = useConfirm();
  const isWide = useMediaQuery("(min-width: 768px)");
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const regionRef = React.useRef<HTMLDivElement>(null);

  const rows = React.useMemo(() => (records ? trashRows(records) : []), [records]);

  const description = !records
    ? "刪除的紀錄會先移到這裡，可復原或永久刪除，避免手滑遺失資料"
    : rows.length
      ? `共 ${rows.length} 筆已刪除紀錄，可復原或永久刪除`
      : "回收桶是空的，刪除的紀錄會先留在這裡，避免手滑遺失資料";

  // 列被移除後，按下的按鈕跟著消失；把焦點收回區塊本身，鍵盤使用者才不會掉到 body。
  const refocusRegion = () => regionRef.current?.focus({ preventScroll: true });

  const onRestore = async (record: DiaryRecord) => {
    if (busyId !== null) return;
    setBusyId(record.id);
    try {
      await restore.mutateAsync(record.id);
      notify.success("已復原紀錄");
      refocusRegion();
    } catch (err) {
      notify.error(err);
    } finally {
      setBusyId(null);
    }
  };

  const onPurge = async (record: DiaryRecord) => {
    if (busyId !== null) return;
    const ok = await confirm({
      title: "永久刪除這筆紀錄？",
      description: (
        <>
          <span className="mb-2 block font-medium text-ink-1">
            {record.date}　{record.equipment}　{record.problem}
          </span>
          {PURGE_DESCRIPTION}
        </>
      ),
      confirmLabel: "永久刪除",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(record.id);
    try {
      await purge.mutateAsync(record.id);
      notify.success("已永久刪除，無法復原");
      refocusRegion();
    } catch (err) {
      notify.error(err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader title="回收桶" description={description} />
      <div ref={regionRef} tabIndex={-1} className="focus:outline-none">
        {isError ? (
          <ErrorState title="載入回收桶失敗" error={error} onRetry={() => void refetch()} retrying={isRefetching} />
        ) : isPending ? (
          <div role="status" aria-label="載入中" className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-strong bg-surface p-8 text-center">
            <p className="font-bold">目前沒有已刪除的紀錄</p>
          </div>
        ) : isWide ? (
          <TrashTable rows={rows} busyId={busyId} onRestore={onRestore} onPurge={onPurge} />
        ) : (
          <TrashCards rows={rows} busyId={busyId} onRestore={onRestore} onPurge={onPurge} />
        )}
      </div>
    </>
  );
}

interface ListProps {
  rows: DiaryRecord[];
  busyId: number | null;
  onRestore: (r: DiaryRecord) => void;
  onPurge: (r: DiaryRecord) => void;
}

function RowActions({ record, busyId, onRestore, onPurge }: Omit<ListProps, "rows"> & { record: DiaryRecord }) {
  const busy = busyId === record.id;
  const label = `${record.date} ${record.equipment} ${record.problem}`;
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" disabled={busy} onClick={() => onRestore(record)} aria-label={`復原：${label}`}>
        復原
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className="border-critical text-critical"
        disabled={busy}
        onClick={() => onPurge(record)}
        aria-label={`永久刪除：${label}`}
      >
        永久刪除
      </Button>
    </div>
  );
}

function TrashTable({ rows, ...actions }: ListProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface-raised">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-muted">
            <th scope="col" className="w-36 px-4 py-3 font-medium">
              日期
            </th>
            <th scope="col" className="w-20 px-3 py-3 font-medium">
              設備
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              問題
            </th>
            <th scope="col" className="w-28 px-3 py-3 font-medium">
              刪除時間
            </th>
            <th scope="col" className="w-56 px-4 py-3 text-right font-medium">
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-b-0">
              <td className="num whitespace-nowrap px-4 py-3 align-top">{r.date}</td>
              <td className="px-3 py-3 align-top">
                <span className="inline-block max-w-full truncate rounded-sm bg-surface px-1.5 py-0.5 font-medium">
                  {r.equipment}
                </span>
              </td>
              <td className="px-3 py-3 align-top">
                <p className="line-clamp-2 break-words">{r.problem}</p>
              </td>
              <td className="num px-3 py-3 align-top text-xs text-ink-muted">{formatDeletedAt(r.deletedAt)}</td>
              <td className="px-4 py-2 align-top">
                <RowActions record={r} {...actions} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrashCards({ rows, ...actions }: ListProps) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.id} className="rounded-lg border border-line bg-surface-raised p-4">
          <p className="break-words font-bold">{r.problem}</p>
          <p className="mt-1 text-sm text-ink-2">
            <span className="font-medium">{r.equipment}</span>
            <span aria-hidden="true">・</span>
            <span className="num">{r.date}</span>
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            刪除時間 <span className="num">{formatDeletedAt(r.deletedAt)}</span>
          </p>
          <div className="mt-3">
            <RowActions record={r} {...actions} />
          </div>
        </li>
      ))}
    </ul>
  );
}
