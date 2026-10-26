import type { EquipmentMapEntry } from "@/lib/types";

/**
 * 實際會生產、對應品號的機台——「設備對照設定」第一次打開時的預設列。
 * 原材區、RB2 是自動化設備裡的個別機構／區塊，沒有自己的品號，**不要**自動列入
 * （需要的話使用者按「＋ 新增一列」手動加；見 CLAUDE.md 核心不變量）。
 */
export const PRODUCTION_EQUIPMENT = ["F3", "F4", "G5", "G6", "F7", "F8"] as const;

/** 編輯中的一列（全部是字串，空值用 ""）。key 只用來讓 React 在刪除／新增時對得準。 */
export interface DraftRow {
  key: number;
  equipment: string;
  productCode: string;
  materialCategory: string;
}

type RowFields = Omit<DraftRow, "key">;

/**
 * 草稿 = 已儲存的對照表 ∪ 還沒出現在裡面的預設生產機台（依序接在後面）。
 * 兩者都沒有任何一列時，給一列空白，使用者才有地方開始填。
 */
export function composeDraft(saved: readonly EquipmentMapEntry[], nextKey: () => number): DraftRow[] {
  const rows: DraftRow[] = saved.map((m) => ({
    key: nextKey(),
    equipment: m.equipment,
    productCode: m.productCode ?? "",
    materialCategory: m.materialCategory ?? "",
  }));
  const seen = new Set(saved.map((m) => m.equipment));
  for (const equipment of PRODUCTION_EQUIPMENT) {
    if (!seen.has(equipment)) rows.push({ key: nextKey(), equipment, productCode: "", materialCategory: "" });
  }
  if (rows.length === 0) rows.push(blankRow(nextKey()));
  return rows;
}

/** 儲存後伺服器回傳的對照表 → 草稿（不再補預設列：使用者存的就是他要的）。 */
export function draftFromSaved(saved: readonly EquipmentMapEntry[], nextKey: () => number): DraftRow[] {
  return saved.map((m) => ({
    key: nextKey(),
    equipment: m.equipment,
    productCode: m.productCode ?? "",
    materialCategory: m.materialCategory ?? "",
  }));
}

export function blankRow(key: number): DraftRow {
  return { key, equipment: "", productCode: "", materialCategory: "" };
}

/** 要送給伺服器的內容：去頭尾空白，設備代號是空的整列丟掉（和舊 UI 一致；伺服器也會再丟一次）。 */
export function cleanDraft(rows: readonly DraftRow[]): RowFields[] {
  const out: RowFields[] = [];
  for (const r of rows) {
    const equipment = r.equipment.trim();
    if (!equipment) continue;
    out.push({ equipment, productCode: r.productCode.trim(), materialCategory: r.materialCategory.trim() });
  }
  return out;
}

/** 用來比較「有沒有未儲存的變更」：只看會被儲存的內容，所以新增了還沒填的空白列不算變更。 */
export function draftSignature(rows: readonly DraftRow[]): string {
  return JSON.stringify(cleanDraft(rows));
}
