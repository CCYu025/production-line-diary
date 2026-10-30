import { emptyFilter } from "@shared/aggregate";
import { useNavigate } from "react-router-dom";
import * as React from "react";
import type { RecordFilter } from "./types";
import { recordFilterToParams } from "./urlQuery";

export type DrillKey = "equipment" | "category" | "severity" | "status" | "date";

/**
 * 從儀表板圖表、KPI 卡片、（日曆格子）點進列表：**先清掉舊條件，再帶入單一值**（舊 UI 的 drillTo）。
 * 設備／分類是陣列；日期是 from = to（單日）；其餘是單一字串。
 */
export function drillFilter(key: DrillKey, value: string): RecordFilter {
  const f = emptyFilter();
  if (key === "equipment" || key === "category") f[key] = [value];
  else if (key === "date") {
    f.from = value;
    f.to = value;
  } else if (key === "severity") f.severity = value as RecordFilter["severity"];
  else f.status = value as RecordFilter["status"];
  return f;
}

/** 紀錄列表的網址（hash 路由內的 path + query）。 */
export function recordsLocation(filter: RecordFilter): { pathname: string; search: string } {
  const search = recordFilterToParams(filter).toString();
  return { pathname: "/records", search: search ? `?${search}` : "" };
}

export function useDrillTo() {
  const navigate = useNavigate();
  return React.useCallback(
    (key: DrillKey, value: string) => {
      void navigate(recordsLocation(drillFilter(key, value)));
    },
    [navigate],
  );
}
