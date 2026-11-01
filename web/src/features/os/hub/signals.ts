/*
 * 控制室即時訊號（docs/os-mode-spec.md §4.4）：純函式。輸入是現有 TanStack Query 快取裡的全部紀錄（含已刪除）與「現在」，
 * 輸出每個頻道的螢幕文字、HUD 短標籤與無障礙名稱。沒有新端點；日期一律用本機日期（toISODate）。
 *
 * 計算規則：
 * 3D 螢幕的字：不放小的中文——上方頻道代號、中央大字、下方短的英文大寫標籤（PENDING／TODAY／READY 沒有標籤／MONTH／TRASH／UNITS）；
 * CH-04 的大字是 MM/DD，標籤 TODAY，當日筆數用小字。HUD 按鈕仍是中文名稱。
 *  CH-01 待處理件數＝狀態「待處理」且未刪除 ｜ CH-02 今日新增筆數（紀錄日期＝本機今天，未刪除）｜ CH-03 閃爍 READY▮（與資料無關）
 *  CH-04 今天日期 MM/DD ＋ 當日筆數 ｜ CH-05 本月筆數（本機年月，未刪除）｜ CH-06 回收桶筆數（已刪除）
 *  CH-07 機台數＝未刪除紀錄的不重複設備（沿用 @shared/aggregate 的 knownEquipment）
 * 紀錄還沒載入（records 為 undefined）：hud／aria 只有名稱、螢幕沒有數字。
 */
import { knownEquipment, toISODate } from "@shared/aggregate";
import type { DiaryRecord } from "@/lib/types";
import { channelButtonLabel, CHANNELS, type Channel, type ChannelId } from "../channels";

/** 控制室資料的更新間隔（毫秒）：只在 HUB 且分頁可見時 */
export const HUB_REFETCH_MS = 30_000;

export interface ChannelSignal {
  id: ChannelId;
  /** 螢幕下方的短英文大寫標籤（"PENDING"、"TODAY"…）；CH-03 與資料沒載入時是 null */
  caption: string | null;
  /** 螢幕中央的大字（"3"、"READY"、CH-04 的 "11/01"）；資料沒載入時是 null（CH-03 永遠是 "READY"） */
  big: string | null;
  /** 標籤旁的小字（只有 CH-04：當日筆數）；其餘 null */
  small: string | null;
  /** CH-03：大字後面接閃爍的 ▮。▮ 用獨立小網格切換可見性，不重傳貼圖 */
  blinkCursor: boolean;
  /** HUD 短標籤（"今日 3"）；資料沒載入時是 undefined */
  hudLabel: string | undefined;
  /** HUD 窄版（視窗 < 1440px）的精簡文字 "CH-02 紀錄 3"（沒有「· 今日」）；資料沒載入時與 name 相同 */
  compact: string;
  /** HUD 按鈕的完整文字與（永遠是）accessible name："CH-02 紀錄 · 今日 3"；資料沒載入時只有 "CH-02 紀錄" */
  name: string;
}

export type HubSignals = Record<ChannelId, ChannelSignal>;

const isLive = (r: DiaryRecord) => !r.deleted;

/** 本機日期的 YYYY-MM-DD、YYYY-MM、MM/DD。 */
export function localDateParts(now: Date): { iso: string; month: string; short: string } {
  const iso = toISODate(now);
  return { iso, month: iso.slice(0, 7), short: `${iso.slice(5, 7)}/${iso.slice(8, 10)}` };
}

/** 各頻道的原始計數（測試與場景共用）。 */
export function countSignals(records: readonly DiaryRecord[], now: Date) {
  const { iso, month } = localDateParts(now);
  const live = records.filter(isLive);
  return {
    pending: live.filter((r) => r.status === "待處理").length,
    today: live.filter((r) => r.date === iso).length,
    month: live.filter((r) => r.date.startsWith(month)).length,
    trash: records.length - live.length,
    machines: knownEquipment(live).length,
  };
}

function nameOnly(ch: Channel): ChannelSignal {
  return {
    id: ch.id,
    caption: null,
    big: ch.id === "CH-03" ? "READY" : null,
    small: null,
    blinkCursor: ch.id === "CH-03",
    hudLabel: undefined,
    compact: channelButtonLabel(ch),
    name: channelButtonLabel(ch),
  };
}

export function computeSignals(records: readonly DiaryRecord[] | undefined, now: Date): HubSignals {
  const out = {} as HubSignals;
  if (!records) {
    for (const ch of CHANNELS) out[ch.id] = nameOnly(ch);
    return out;
  }
  const c = countSignals(records, now);
  const { short } = localDateParts(now);
  const spec: Record<ChannelId, { caption: string | null; big: string; small?: string; hud: string; value: string }> = {
    "CH-01": { caption: "PENDING", big: String(c.pending), hud: `待處理 ${c.pending}`, value: String(c.pending) },
    "CH-02": { caption: "TODAY", big: String(c.today), hud: `今日 ${c.today}`, value: String(c.today) },
    "CH-03": { caption: null, big: "READY", hud: "READY", value: "READY" },
    "CH-04": { caption: "TODAY", big: short, small: String(c.today), hud: `今日 ${c.today}`, value: String(c.today) },
    "CH-05": { caption: "MONTH", big: String(c.month), hud: `本月 ${c.month}`, value: String(c.month) },
    "CH-06": { caption: "TRASH", big: String(c.trash), hud: `${c.trash} 筆`, value: String(c.trash) },
    "CH-07": { caption: "UNITS", big: String(c.machines), hud: `${c.machines} 台`, value: String(c.machines) },
  };
  for (const ch of CHANNELS) {
    const s = spec[ch.id];
    out[ch.id] = {
      id: ch.id,
      caption: s.caption,
      big: s.big,
      small: s.small ?? null,
      blinkCursor: ch.id === "CH-03",
      hudLabel: s.hud,
      compact: `${channelButtonLabel(ch)} ${s.value}`,
      name: `${channelButtonLabel(ch)} · ${s.hud}`,
    };
  }
  return out;
}

/** 螢幕貼圖的內容鍵：內容沒變就不重畫、不重傳（場景用它判斷）。 */
export function signalKey(s: ChannelSignal): string {
  return `${s.caption ?? ""}|${s.big ?? ""}|${s.small ?? ""}`;
}

/** 資料更新間隔：只在導演是 HUB 且文件可見時才輪詢；否則 false（停止）。 */
export function refetchIntervalFor(inHub: boolean, visible: boolean): number | false {
  return inHub && visible ? HUB_REFETCH_MS : false;
}

/** 開機 BIOS 文字用的真實計數（B2）：機台數＝未刪除紀錄的不重複設備，紀錄數＝未刪除紀錄筆數。資料還沒載入＝null。 */
export function bootCounts(records: readonly DiaryRecord[] | undefined): { machines: number | null; records: number | null } {
  if (!records) return { machines: null, records: null };
  const live = records.filter(isLive);
  return { machines: knownEquipment(live).length, records: live.length };
}
