import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { emptyFilter, SEVERITY_ORDER, STATUS_ORDER } from "@shared/aggregate";
import type { RecordFilter } from "./types";

/*
 * 紀錄列表的篩選條件 ⇄ URL query（hash 路由，例如 #/records?equipment=F3&status=待處理）。
 * 好處：重新整理、複製網址、瀏覽器上一頁都能回到同一組條件。
 * 原則：預設值（空）不寫進網址；陣列用「重複的 key」（equipment=F3&equipment=F4）而不是逗號，
 * 因為設備／分類是開放清單，名稱裡可能有逗號。無法辨識的值直接忽略，不丟錯。
 */

export const FILTER_KEYS = ["equipment", "category", "severity", "status", "problem", "from", "to", "q"] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

export function parseRecordFilter(params: URLSearchParams): RecordFilter {
  const f = emptyFilter();
  f.equipment = uniqueNonEmpty(params.getAll("equipment"));
  f.category = uniqueNonEmpty(params.getAll("category"));

  const severity = params.get("severity");
  f.severity = SEVERITY_ORDER.find((s) => s === severity) ?? "";
  const status = params.get("status");
  f.status = STATUS_ORDER.find((s) => s === status) ?? "";

  f.problem = params.get("problem")?.trim() ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  f.from = DATE_RE.test(from) ? from : "";
  f.to = DATE_RE.test(to) ? to : "";
  f.query = params.get("q")?.trim() ?? "";
  return f;
}

/**
 * 把篩選條件寫回 `base`（其他不相關的 query，例如之後詳情面板的 `?open=12`，原樣保留），回傳新的 URLSearchParams。
 */
export function applyRecordFilter(base: URLSearchParams, f: RecordFilter): URLSearchParams {
  const next = new URLSearchParams(base);
  for (const key of FILTER_KEYS) next.delete(key);
  for (const v of f.equipment) next.append("equipment", v);
  for (const v of f.category) next.append("category", v);
  if (f.severity) next.set("severity", f.severity);
  if (f.status) next.set("status", f.status);
  if (f.problem) next.set("problem", f.problem);
  if (f.from) next.set("from", f.from);
  if (f.to) next.set("to", f.to);
  if (f.query) next.set("q", f.query);
  return next;
}

export function recordFilterToParams(f: RecordFilter): URLSearchParams {
  return applyRecordFilter(new URLSearchParams(), f);
}

type FilterUpdate = RecordFilter | ((prev: RecordFilter) => RecordFilter);

/**
 * 篩選條件放在網址裡的 hook。
 *   const [filter, setFilter] = useRecordFilterParams();
 *   setFilter((f) => ({ ...f, status: "待處理" }));            // 預設 push：瀏覽器上一頁可以回到上一組條件
 *   setFilter((f) => ({ ...f, query: text }), { replace: true }); // 打字搜尋用 replace，不要塞滿歷史紀錄
 */
export function useRecordFilterParams() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = React.useMemo(() => parseRecordFilter(searchParams), [searchParams]);

  const setFilter = React.useCallback(
    (update: FilterUpdate, opts?: { replace?: boolean }) => {
      setSearchParams(
        (prev) => {
          const current = parseRecordFilter(prev);
          const nextFilter = typeof update === "function" ? update(current) : update;
          return applyRecordFilter(prev, nextFilter);
        },
        { replace: opts?.replace ?? false },
      );
    },
    [setSearchParams],
  );

  return [filter, setFilter] as const;
}
