import * as React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/lib/feedback";
import { useRecords } from "@/lib/queries";
import { RecordForm } from "./RecordForm";

function FormSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4" aria-busy="true" aria-label="載入中">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

/** `#/records/new` 與 `#/records/new?copy=<id>`（列表／詳情的〔複製〕入口）。 */
export function RecordNewPage() {
  const [params] = useSearchParams();
  const rawCopy = params.get("copy");
  const copyId = rawCopy && /^[1-9]\d*$/.test(rawCopy) ? Number(rawCopy) : null;
  const recordsQuery = useRecords();

  const copyFrom = React.useMemo(
    () => (copyId === null ? null : (recordsQuery.data?.find((r) => r.id === copyId && !r.deleted) ?? null)),
    [copyId, recordsQuery.data],
  );
  const missing = copyId !== null && recordsQuery.isSuccess && !copyFrom;
  React.useEffect(() => {
    if (missing) notify.error("找不到要複製的紀錄，請直接填寫");
  }, [missing, copyId]);

  const waitingForCopy = copyId !== null && !recordsQuery.isSuccess && !recordsQuery.isError;

  return (
    <>
      <PageHeader title="新增紀錄" description="選設備、寫問題、填耗時就能送出；送出後會即時反映在儀表板與列表" />
      {waitingForCopy ? (
        <FormSkeleton />
      ) : (
        // 載入失敗也照常顯示空白表單（只是無法帶入），不要讓「讀不到舊紀錄」擋住新增
        <RecordForm mode="new" copyFrom={copyFrom} />
      )}
    </>
  );
}

/** `#/records/:id/edit` */
export function RecordEditPage() {
  const { id: rawId } = useParams();
  const id = rawId && /^[1-9]\d*$/.test(rawId) ? Number(rawId) : null;
  const recordsQuery = useRecords();
  const record = id === null ? undefined : recordsQuery.data?.find((r) => r.id === id);

  let body: React.ReactNode;
  if (id === null || (recordsQuery.isSuccess && (!record || record.deleted))) {
    body = (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3 rounded-lg border border-line bg-surface p-6">
        <p className="font-bold">找不到這筆紀錄</p>
        <p className="text-sm text-ink-2">它可能已被刪除（已移到回收桶的紀錄要先復原才能編輯）。</p>
        <Button asChild variant="secondary">
          <Link to="/records">回紀錄列表</Link>
        </Button>
      </div>
    );
  } else if (recordsQuery.isError) {
    body = (
      <ErrorState
        title="載入紀錄失敗"
        error={recordsQuery.error}
        onRetry={() => void recordsQuery.refetch()}
        retrying={recordsQuery.isFetching}
      />
    );
  } else if (!record) {
    body = <FormSkeleton />;
  } else {
    // key：換成另一筆時整個表單重來（狀態、照片 session 都不沿用）
    body = <RecordForm key={record.id} mode="edit" record={record} />;
  }

  return (
    <>
      <PageHeader title="編輯紀錄" description="修改後按「儲存變更」；移除既有照片要儲存後才會真的刪除" />
      {body}
    </>
  );
}
