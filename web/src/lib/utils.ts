import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合併 class（後者覆蓋前者的 Tailwind 衝突）。shadcn/ui 慣用的 cn()。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 舊資料裡設備／分類可能是空字串（搬遷來的紀錄）；畫面上用這個佔位字顯示，不要顯示成空白。實際值（篩選、網址）仍是 ""。 */
export const UNFILLED_LABEL = "（未填）";
export function labelOrUnfilled(value: string): string {
  return value.trim() === "" ? UNFILLED_LABEL : value;
}

/** YYYY-MM-DD 而且是真實存在的日期（2026-13-45、2026-02-30 都不是）。 */
export function isRealIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
