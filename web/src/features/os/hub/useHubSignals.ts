import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { DiaryRecord } from "@/lib/types";
import { computeSignals, refetchIntervalFor, type HubSignals } from "./signals";

/** 文件是否可見（visibilitychange）。 */
export function useDocumentVisible(): boolean {
  return React.useSyncExternalStore(
    (cb) => {
      document.addEventListener("visibilitychange", cb);
      return () => document.removeEventListener("visibilitychange", cb);
    },
    () => document.visibilityState !== "hidden",
    () => true,
  );
}

export interface HubData {
  /** 全部紀錄（含已刪除）；沒載入時 undefined */
  records: DiaryRecord[] | undefined;
  /** 每個頻道的訊號；沒載入時只有名稱 */
  signals: HubSignals;
  /** 最後一次抓到資料的時間（毫秒）；沒資料是 0 */
  dataUpdatedAt: number;
  /** 查詢不在抓取中（雷達基準線要在「抓完」的資料上取） */
  settled: boolean;
}

/**
 * 控制室資料：沿用現有的 ["records"] 查詢快取（同 key、同 queryFn，不新增端點），
 * 只在 inHub（導演狀態是 HUB）且文件可見時每 30 秒重抓；其他時候 refetchInterval 為 false（停止）。
 * 「今天」隨每次資料更新重算（跨日也會在下一次更新時換日）。
 */
export function useHubData(inHub: boolean): HubData {
  const visible = useDocumentVisible();
  const q = useQuery({
    queryKey: queryKeys.records,
    queryFn: ({ signal }) => api.listRecords(signal),
    refetchInterval: refetchIntervalFor(inHub, visible),
    refetchIntervalInBackground: false,
  });
  const signals = React.useMemo(() => computeSignals(q.data, new Date()), [q.data, q.dataUpdatedAt]);
  return { records: q.data, signals, dataUpdatedAt: q.dataUpdatedAt, settled: !q.isFetching };
}
