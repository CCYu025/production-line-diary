import type { QueryClient } from "@tanstack/react-query";
import type { RangeKey } from "./types";

/**
 * TanStack Query 的 key 一律從這裡取，失效更新也走下面的 helper，
 * 不要在頁面裡手寫字串陣列——否則改了 key 結構會漏掉某個畫面。
 */
export const queryKeys = {
  meta: ["meta"] as const,
  records: ["records"] as const,
  aggregate: (range: RangeKey = "all") => ["aggregate", range] as const,
  aggregateAll: ["aggregate"] as const,
};

/**
 * 紀錄新增／修改／刪除／復原／永久刪除之後呼叫：
 * 列表、儀表板彙總、以及從紀錄動態算出來的建議清單（meta）都要重抓。
 */
export function invalidateRecordData(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.records }),
    qc.invalidateQueries({ queryKey: queryKeys.aggregateAll }),
    qc.invalidateQueries({ queryKey: queryKeys.meta }),
  ]);
}

/** 設備對照表存檔之後呼叫（對照表在 meta 裡）。 */
export function invalidateMeta(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: queryKeys.meta });
}
