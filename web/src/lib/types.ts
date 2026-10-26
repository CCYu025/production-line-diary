// 資料型別的單一來源在 backend/lib/types.d.ts（依 backend/data/schema.md 定義）。
// 前端一律從這裡 import，之後型別搬家只需要改這一個檔案。
export type {
  Aggregate,
  DatePreset,
  DiaryRecord,
  EquipmentMapEntry,
  FacetKey,
  Meta,
  RangeKey,
  RankEntry,
  RecordFilter,
  RecordInput,
  Severity,
  Shift,
  Status,
  Store,
  TrendPoint,
} from "@shared/types";
