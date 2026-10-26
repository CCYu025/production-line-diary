// 前端（web/）用的資料型別宣告。資料契約的「意義」請看 backend/data/schema.md，
// 這裡只是把它翻成 TypeScript。後端維持 JavaScript（ESM）＋ JSDoc，這個檔案不參與執行。

export type Severity = "輕微" | "一般" | "嚴重" | "重大";
export type Status = "待處理" | "追蹤中" | "已解決";
export type Shift = "早" | "中" | "晚";
export type RangeKey = "all" | "month" | "week";

/** data.json 的一筆紀錄（schemaVersion 1.2）。不叫 Record，避免和 TS 內建的 Record<K,V> 撞名。 */
export interface DiaryRecord {
  id: number;
  /** YYYY-MM-DD，同時決定照片資料夾（去掉 "-"） */
  date: string;
  shift: Shift;
  /** HH:MM（24 小時制） */
  time: string;
  /** 分鐘 */
  duration: number;
  equipment: string;
  category: string;
  problem: string;
  severity: Severity;
  action: string;
  /** null = 尚未填寫（誠實的「不知道」） */
  rootCause: string | null;
  status: Status;
  productCode: string | null;
  materialCategory: string | null;
  /** 照片檔名；實體檔在 照片/<date 去掉"-">/<檔名> */
  photos: string[];
  /** { 檔名: 一句話說明 }，最多 100 字；可省略 */
  photoCaptions?: Record<string, string>;
  /** ISO 8601；null = 從未編輯過 */
  updatedAt: string | null;
  deleted: boolean;
  /** ISO 8601；null = 未刪除 */
  deletedAt: string | null;
}

/** 設備 → 品號／原料類別的「目前」對照表（紀錄裡存的是建立當下的快照） */
export interface EquipmentMapEntry {
  equipment: string;
  productCode: string | null;
  materialCategory: string | null;
}

/** POST /api/records、PUT /api/records/:id 的 body */
export interface RecordInput {
  date: string;
  time: string;
  duration: number;
  equipment: string;
  problem: string;
  shift?: Shift;
  category?: string;
  severity?: Severity;
  action?: string;
  rootCause?: string | null;
  status?: Status;
  productCode?: string | null;
  materialCategory?: string | null;
  photos?: string[];
  photoCaptions?: Record<string, string>;
}

/** GET /api/meta */
export interface Meta {
  schemaVersion: string;
  equipment: string[];
  categories: string[];
  productCodes: string[];
  materialCategories: string[];
  equipmentMap: EquipmentMapEntry[];
}

/** data.json 的最外層結構 */
export interface Store {
  _meta: { schemaVersion: string; exportedAt?: string; app?: string };
  records: DiaryRecord[];
  equipmentMap: EquipmentMapEntry[];
}

export interface RankEntry {
  label: string;
  count: number;
  minutes: number;
}

export interface TrendPoint {
  date: string;
  minutes: number;
  count: number;
}

/** GET /api/aggregate?range=… 與 aggregate() 的回傳 */
export interface Aggregate {
  totalEvents: number;
  totalMinutes: number;
  withPhoto: number;
  avg: number;
  equipmentRanked: RankEntry[];
  categoryRanked: RankEntry[];
  problemRanked: RankEntry[];
  severityCounts: Array<{ label: Severity; count: number; minutes: number }>;
  statusCounts: Array<{ label: Status; count: number; minutes: number }>;
  trend: TrendPoint[];
  trackingRows: DiaryRecord[];
  trackingMinutes: number;
  rootCauseMissing: number;
}

/** 紀錄列表的篩選狀態（見 aggregate.js 的 emptyFilter / filterRecords） */
export interface RecordFilter {
  equipment: string[];
  category: string[];
  severity: Severity | "";
  status: Status | "";
  problem: string;
  /** YYYY-MM-DD 或 "" */
  from: string;
  to: string;
  query: string;
}

export type FacetKey = "equipment" | "category" | "severity" | "status";

export interface DatePreset {
  id: string;
  label: string;
  from: string;
  to: string;
}
