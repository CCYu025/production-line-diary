import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { invalidateMeta, invalidateRecordData, queryKeys } from "./queryKeys";
import type { EquipmentMapEntry, RangeKey, RecordInput } from "./types";

/* ---------- 讀取 ---------- */

export function useMeta() {
  return useQuery({ queryKey: queryKeys.meta, queryFn: ({ signal }) => api.getMeta(signal) });
}

/** 全部紀錄（含已軟刪除的）。列表／日曆／回收桶都從這份資料前端篩選（`@shared/aggregate` 的 filterRecords 等）。 */
export function useRecords() {
  return useQuery({ queryKey: queryKeys.records, queryFn: ({ signal }) => api.listRecords(signal) });
}

export function useAggregate(range: RangeKey = "all") {
  return useQuery({ queryKey: queryKeys.aggregate(range), queryFn: ({ signal }) => api.getAggregate(range, signal) });
}

/** 回收桶裡的筆數（側欄徽章用）。資料還沒載入時回傳 undefined。 */
export function useTrashCount(): number | undefined {
  const { data } = useRecords();
  return data ? data.filter((r) => r.deleted).length : undefined;
}

/* ---------- 寫入（成功後自動讓相關查詢失效重抓；toast 由呼叫端決定） ---------- */

export function useCreateRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordInput) => api.createRecord(input),
    onSuccess: () => invalidateRecordData(qc),
  });
}

export function useUpdateRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: Partial<RecordInput> }) => api.updateRecord(id, input),
    onSuccess: () => invalidateRecordData(qc),
  });
}

export function useSoftDeleteRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.softDeleteRecord(id),
    onSuccess: () => invalidateRecordData(qc),
  });
}

export function useRestoreRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.restoreRecord(id),
    onSuccess: () => invalidateRecordData(qc),
  });
}

export function usePurgeRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.purgeRecord(id),
    onSuccess: () => invalidateRecordData(qc),
  });
}

export function useSaveEquipmentMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (list: EquipmentMapEntry[]) => api.saveEquipmentMap(list),
    onSuccess: () => invalidateMeta(qc),
  });
}

export function useExportXlsx() {
  return useMutation({ mutationFn: () => api.exportXlsx() });
}
