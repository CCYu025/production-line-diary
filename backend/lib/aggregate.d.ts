// backend/lib/aggregate.js 的型別宣告（aggregate.js 維持純 JS，前後端共用同一份邏輯；
// web/ 透過 alias `@shared/aggregate` 引用它，型別由這個檔案提供）。
// 改了 aggregate.js 的匯出或回傳形狀，請同步改這裡——web/src/lib/shared.test.ts
// 會檢查「這裡宣告的匯出名稱」與 aggregate.js 實際匯出一致。

import type {
  Aggregate,
  DatePreset,
  DiaryRecord,
  FacetKey,
  RangeKey,
  RecordFilter,
  Severity,
  Status,
} from "./types";

export const SEVERITY_ORDER: readonly Severity[];
export const STATUS_ORDER: readonly Status[];

export function knownEquipment(records: readonly DiaryRecord[]): string[];
export function knownCategories(records: readonly DiaryRecord[]): string[];
export function knownProductCodes(records: readonly DiaryRecord[]): string[];
export function knownMaterialCategories(records: readonly DiaryRecord[]): string[];

export function severityFromDuration(minutes: number): Severity;
export function withinRange(dateStr: string, range: RangeKey | undefined, now?: Date): boolean;
export function aggregate(allRecords: readonly DiaryRecord[], range?: RangeKey, now?: Date): Aggregate;

export const COPY_FIELDS: readonly ["category", "severity", "duration", "problem", "action", "rootCause"];
export interface CopyFields {
  category: string | null;
  severity: Severity | null;
  duration: number | null;
  problem: string | null;
  action: string | null;
  rootCause: string | null;
}
export function pickCopyFields(record: Partial<DiaryRecord>): CopyFields;

export interface CommonProblem {
  category: string;
  problem: string;
  count: number;
  /** 同類事件中最近的一筆（當範本） */
  record: DiaryRecord;
}
export function commonProblems(records: readonly DiaryRecord[]): CommonProblem[];

export function emptyFilter(): RecordFilter;
export function hasActiveFilter(f: RecordFilter): boolean;
export function filterRecords(records: readonly DiaryRecord[], f: RecordFilter): DiaryRecord[];
export function facetCounts(records: readonly DiaryRecord[], f: RecordFilter, key: FacetKey): Record<string, number>;
export function sortByDate(records: readonly DiaryRecord[], desc?: boolean): DiaryRecord[];
export function datePresets(now?: Date): DatePreset[];
