import { pickCopyFields, severityFromDuration, toISODate } from "@shared/aggregate";
import type { DiaryRecord, EquipmentMapEntry, Meta, RecordInput, Severity, Shift, Status } from "@/lib/types";

/*
 * 新增／編輯共用表單的純邏輯（沒有 React、沒有網路，方便單元測試）。
 * 行為依據：docs/refactor-plan.md §2（複製既有紀錄、照片、耗時）與 §4 U5。
 */

export const SHIFTS: readonly Shift[] = ["早", "中", "晚"];
export const MAX_CAPTION_LENGTH = 100;

/** 表單裡每個欄位的字串值（耗時也是字串：輸入框裡的原樣內容，送出前才驗證／轉數字）。 */
export interface FormValues {
  date: string;
  time: string;
  shift: Shift;
  equipment: string;
  problem: string;
  category: string;
  duration: string;
  severity: Severity;
  action: string;
  rootCause: string;
  status: Status;
  /** 只有編輯模式使用（新增模式由設備對照表自動帶入快照） */
  productCode: string;
  materialCategory: string;
}

export type FieldName = keyof FormValues | "photos";
export type FieldErrors = Partial<Record<FieldName, string>>;

export const FIELD_LABELS: Record<FieldName, string> = {
  date: "日期",
  time: "時間",
  shift: "班別",
  equipment: "設備",
  problem: "問題",
  category: "問題分類",
  duration: "耗時",
  severity: "嚴重度",
  action: "處理",
  rootCause: "根本原因",
  status: "處理狀態",
  productCode: "品號",
  materialCategory: "原料類別",
  photos: "照片",
};

/** 複製帶入後標「請確認」的欄位（使用者動過就消失，永遠不擋送出）。 */
export const REVIEW_FIELDS = ["date", "shift", "time", "duration", "equipment"] as const;
export type ReviewField = (typeof REVIEW_FIELDS)[number];

/* ---------- 日期／時間 ---------- */

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 目前的本地日期與時間（不可用 toISOString：UTC 在台灣清晨會變成昨天）。 */
export function nowDateTime(now: Date = new Date()): { date: string; time: string } {
  return { date: toISODate(now), time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}` };
}

/** 「2026/10/26 14:05・早班」 */
export function formatDateSummary(v: Pick<FormValues, "date" | "time" | "shift">): string {
  const date = v.date ? v.date.replaceAll("-", "/") : "未選擇日期";
  const time = v.time || "--:--";
  return `${date} ${time}・${v.shift}班`;
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  if (y < 1900) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isValidTime(value: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

/* ---------- 耗時 ---------- */

/** 耗時只接受正整數（7 可以、7.5 與 0 不行）。回傳 null 表示不合法。 */
export function parseDurationInput(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** 依耗時建議的嚴重度；耗時不合法時回傳 null（不改動目前選擇）。 */
export function suggestSeverity(durationText: string): Severity | null {
  const n = parseDurationInput(durationText);
  return n === null ? null : severityFromDuration(n);
}

/* ---------- 初始值 ---------- */

export function initialNewValues(now: Date = new Date()): FormValues {
  const { date, time } = nowDateTime(now);
  return {
    date,
    time,
    shift: "早",
    equipment: "",
    problem: "",
    category: "",
    duration: "",
    severity: "輕微",
    action: "",
    rootCause: "",
    status: "待處理",
    productCode: "",
    materialCategory: "",
  };
}

export function valuesFromRecord(r: DiaryRecord): FormValues {
  return {
    date: r.date,
    time: r.time,
    shift: r.shift,
    equipment: r.equipment,
    problem: r.problem,
    category: r.category,
    duration: String(r.duration),
    severity: r.severity,
    action: r.action ?? "",
    rootCause: r.rootCause ?? "",
    status: r.status,
    productCode: r.productCode ?? "",
    materialCategory: r.materialCategory ?? "",
  };
}

/* ---------- 複製既有紀錄 ---------- */

export interface CopyInfo {
  id: number;
  /** 例如「10/20」 */
  dateLabel: string;
  equipment: string;
  problem: string;
}

export function copyInfoOf(rec: DiaryRecord): CopyInfo {
  return { id: rec.id, dateLabel: rec.date.slice(5).replace("-", "/"), equipment: rec.equipment, problem: rec.problem };
}

/**
 * 把舊紀錄套進表單值。複製哪些欄位由 `pickCopyFields()` 白名單決定（category / severity / duration /
 * problem / action / rootCause）；其餘：
 *   - 狀態一律重設為「待處理」；設備清空（品號／原料類別之後依新設備重新帶入）；照片不複製（表單另外處理）
 *   - 日期／時間／班別：預設重設為「現在」。但已經上傳照片時（`lockDateTime`）完全不動——照片是依當時日期存放的
 */
export function applyCopyToValues(
  current: FormValues,
  rec: DiaryRecord,
  opts: { lockDateTime: boolean; now?: Date },
): FormValues {
  const picked = pickCopyFields(rec);
  const next: FormValues = {
    ...current,
    category: picked.category ?? "",
    severity: picked.severity ?? current.severity,
    duration: picked.duration == null ? "" : String(picked.duration),
    problem: picked.problem ?? "",
    action: picked.action ?? "",
    rootCause: picked.rootCause ?? "",
    status: "待處理",
    equipment: "",
    productCode: "",
    materialCategory: "",
  };
  if (!opts.lockDateTime) {
    const { date, time } = nowDateTime(opts.now);
    next.date = date;
    next.time = time;
    next.shift = "早";
  }
  return next;
}

/** 套用複製後要標「請確認」的欄位。日期被鎖住（已有照片）時不標——使用者根本改不了它。 */
/** 帶入時「真的被填了值」的欄位（cyber 主題 FX-27 帶入閃爍用；純展示，不影響表單值）。 */
export function copiedFieldsOf(rec: DiaryRecord): FieldName[] {
  const picked = pickCopyFields(rec);
  const out: FieldName[] = [];
  if (picked.problem) out.push("problem");
  if (picked.category) out.push("category");
  if (picked.duration != null) out.push("duration");
  if (picked.action) out.push("action");
  if (picked.rootCause) out.push("rootCause");
  return out;
}

export function reviewFieldsAfterCopy(lockDateTime: boolean): ReviewField[] {
  return REVIEW_FIELDS.filter((f) => !(lockDateTime && f === "date"));
}

/* ---------- 驗證 ---------- */

export function validateValues(v: FormValues): FieldErrors {
  const errors: FieldErrors = {};
  if (!v.date) errors.date = "請選擇日期";
  else if (!isRealDate(v.date)) errors.date = "日期不正確";
  if (!v.time) errors.time = "請輸入時間";
  else if (!isValidTime(v.time)) errors.time = "時間格式不正確";
  if (!v.equipment.trim()) errors.equipment = "請選擇或輸入設備";
  if (!v.problem.trim()) errors.problem = "請描述發生的問題";
  if (!v.duration.trim()) errors.duration = "請輸入耗時（分鐘）";
  else if (parseDurationInput(v.duration) === null) errors.duration = "耗時請輸入 1 以上的整數（分鐘）";
  return errors;
}

const SERVER_FIELD_RE =
  /^(date|time|shift|duration|equipment|category|problem|severity|action|rootCause|status|productCode|materialCategory|photos|photoCaptions)\s+(.*)$/s;

/**
 * 伺服器回的 `errors[]`（例如「duration 須為正整數（分鐘）」）盡量對應到欄位；對不上的當作整體錯誤。
 * 欄位名稱換成畫面上的標籤（「耗時 須為正整數（分鐘）」）。
 */
export function mapServerErrors(errors: readonly string[]): { fields: FieldErrors; general: string[] } {
  const fields: FieldErrors = {};
  const general: string[] = [];
  for (const message of errors) {
    const m = SERVER_FIELD_RE.exec(message);
    if (!m) {
      general.push(message);
      continue;
    }
    const key = m[1] as keyof FormValues | "photos" | "photoCaptions";
    const field: FieldName = key === "photoCaptions" ? "photos" : key;
    const label = key === "photoCaptions" ? "圖片說明" : FIELD_LABELS[field];
    const text = `${label} ${m[2]}`;
    fields[field] = fields[field] ? `${fields[field]}；${text}` : text;
  }
  return { fields, general };
}

/* ---------- 建立送出的資料 ---------- */

export function findEquipmentMapEntry(
  equipmentMap: readonly EquipmentMapEntry[] | undefined,
  equipment: string,
): EquipmentMapEntry | undefined {
  const name = equipment.trim();
  if (!name) return undefined;
  return equipmentMap?.find((m) => m.equipment === name);
}

/** 設備對照表有對應的品號／原料類別才算「有對照」（新增畫面的唯讀預覽只在這時顯示）。 */
export function hasMapping(entry: EquipmentMapEntry | undefined): entry is EquipmentMapEntry {
  return !!entry && !!(entry.productCode || entry.materialCategory);
}

export interface BuildInputContext {
  mode: "new" | "edit";
  equipmentMap?: readonly EquipmentMapEntry[] | undefined;
  /** 要存進紀錄的照片檔名（編輯：保留的既有照片＋本次新上傳的）與其說明 */
  photos: readonly { filename: string; caption: string }[];
}

export function buildRecordInput(v: FormValues, ctx: BuildInputContext): RecordInput {
  const duration = parseDurationInput(v.duration);
  if (duration === null) throw new Error("耗時不是正整數");
  const equipment = v.equipment.trim();

  let productCode: string | null;
  let materialCategory: string | null;
  if (ctx.mode === "new") {
    // 品號／原料類別是「建立當下」的設備對照快照，新增畫面不可手改
    const entry = findEquipmentMapEntry(ctx.equipmentMap, equipment);
    productCode = entry?.productCode || null;
    materialCategory = entry?.materialCategory || null;
  } else {
    productCode = v.productCode.trim() || null;
    materialCategory = v.materialCategory.trim() || null;
  }

  const photoCaptions: Record<string, string> = {};
  for (const p of ctx.photos) {
    const c = p.caption.trim().slice(0, MAX_CAPTION_LENGTH);
    if (c) photoCaptions[p.filename] = c;
  }

  return {
    date: v.date,
    time: v.time,
    shift: v.shift,
    duration,
    equipment,
    category: v.category.trim() || "其他",
    problem: v.problem.trim(),
    severity: v.severity,
    action: v.action.trim(),
    rootCause: v.rootCause.trim() || null,
    status: v.status,
    productCode,
    materialCategory,
    photos: ctx.photos.map((p) => p.filename),
    photoCaptions,
  };
}

/* ---------- 建議清單 ---------- */

export const DEFAULT_EQUIPMENT = ["原材區1", "原材區2", "F3", "F4", "F7"];
export const DEFAULT_CATEGORIES = ["取料異常", "缺料", "尺寸異常", "沾模", "材料損傷", "設備異常", "其他"];

function mergeSorted(...lists: ReadonlyArray<readonly string[]>): string[] {
  return Array.from(new Set(lists.flat().filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

/** 設備建議 = 預設 ∪ 資料裡出現過的 ∪ 設備對照表（皆可自由輸入新值）。 */
export function equipmentSuggestions(meta: Meta | undefined): string[] {
  return mergeSorted(DEFAULT_EQUIPMENT, meta?.equipment ?? [], meta?.equipmentMap.map((m) => m.equipment) ?? []);
}

export function categorySuggestions(meta: Meta | undefined): string[] {
  return mergeSorted(DEFAULT_CATEGORIES, meta?.categories ?? []);
}
