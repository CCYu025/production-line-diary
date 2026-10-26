import { useQueryClient } from "@tanstack/react-query";
import { useRestoreRecord, useSoftDeleteRecord, useUpdateRecord } from "@/lib/queries";
import { queryKeys } from "@/lib/queryKeys";
import type { DiaryRecord, RecordInput } from "@/lib/types";

/**
 * 詳情面板的快速操作。成功後除了讓相關查詢失效重抓（紀錄、彙總、meta、回收桶筆數徽章，
 * 由 lib/queries 的 mutation 負責），也先把伺服器回傳的那一筆直接寫回快取，畫面不用等重抓就更新。
 */
export function usePatchRecord() {
  const qc = useQueryClient();
  const update = useUpdateRecord();
  return {
    isPending: update.isPending,
    /** PUT 只送要改的欄位，例如 { status } 或 { rootCause }。丟錯時由呼叫端決定怎麼提示。 */
    patch: async (id: number, input: Partial<RecordInput>): Promise<DiaryRecord> => {
      const record = await update.mutateAsync({ id, input });
      qc.setQueryData<DiaryRecord[]>(queryKeys.records, (old) => old?.map((r) => (r.id === record.id ? record : r)));
      return record;
    },
  };
}

export function useSoftDeleteWithUndo() {
  const softDelete = useSoftDeleteRecord();
  const restore = useRestoreRecord();
  return {
    isPending: softDelete.isPending,
    remove: (id: number) => softDelete.mutateAsync(id),
    undo: (id: number) => restore.mutateAsync(id),
  };
}
