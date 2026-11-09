/*
 * 控制台引線（docs/holo-mode-spec.md §7.2；H0）：選中的頻道鍵 → 3D 選中螢幕之間的一條 1px 線。純幾何，不碰 DOM。
 * 螢幕在畫面上的位置用 hub/faceRect 的投影（含桶狀弧面與選取偏航）；只在選取、視窗大小、CRT 強度改變時才重算，不每幀量測。
 */
import type { ChannelId } from "../channels";
import { baseAnchorAt, faceRectAt } from "../hub/faceRect";
import { hudArcDepthPx, hudBasePx, hudInsets, hudKeyPx, selectYawDeg } from "../hub/layout";
import { channelIndex, CHANNELS } from "../channels";

export interface LeaderInput {
  /** 視窗（HUD 容器）大小，px */
  width: number;
  height: number;
  channel: ChannelId;
  /** 目前 CRT 強度的桶狀係數（強度「關」為 0） */
  barrelK: number;
  /** 選中頻道鍵的矩形（相對於 HUD 容器，px；已含弧形位移） */
  key: { left: number; top: number; width: number };
}

export interface Leader {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 引線端點與螢幕、鍵之間留的空隙（px） */
export const LEADER_GAP_PX = 3;
/** 短於這個長度就不畫（鍵已經貼在螢幕底下） */
export const LEADER_MIN_PX = 12;

/** 回傳引線端點（HUD 容器座標，px；上端在螢幕底座、下端在鍵的上緣正中央）；算不出來或太短回傳 null。 */
export function leaderGeometry(input: LeaderInput): Leader | null {
  const { width, height, channel, barrelK, key } = input;
  if (width <= 0 || height <= 0 || key.width <= 0) return null;
  const a = baseAnchorAt(width / height, channel, barrelK, hudInsets(height), selectYawDeg(channelIndex(channel)));
  if (!a) return null;
  const x1 = a.x * width;
  const y1 = a.y * height + LEADER_GAP_PX;
  const x2 = key.left + key.width / 2;
  const y2 = key.top - LEADER_GAP_PX;
  if (y2 - y1 < LEADER_MIN_PX) return null;
  return { x1, y1, x2, y2 };
}

/* ---------- 控制台鍵的水平對位（H0 r2） ---------- */

/** 鍵寬上限／下限（px；下限放得下精簡文字）、相鄰鍵最小間距、鍵在遮罩實心區內的左右邊界（占視窗寬度） */
export const KEY_MAX_PX = 176;
export const KEY_MIN_PX = 84;
export const KEY_GAP_PX = 4;
export const KEY_EDGE_FRAC = 0.035;

export interface KeyLayout {
  /** 每個鍵的水平中心（px，視窗座標，依頻道順序） */
  x: number[];
  /** 統一的鍵寬（px） */
  w: number;
}

/**
 * 每個鍵的水平中心對齊該台螢幕在休息鏡頭下的投影中心（含桶狀弧面），鍵寬依相鄰中心的最小距離縮放（上限 KEY_MAX_PX）。
 * 空間不夠（算出的寬度 < KEY_MIN_PX）或算不出投影時回傳 null，由呼叫端退回平均排列。yawDeg 是目前的選取偏航（度）：選取改變時鏡頭偏航 ≤ 3°，螢幕在畫面上平移，鍵跟著（CSS 用同樣的 250ms 緩動）。
 */
export function keyLayout(width: number, height: number, barrelK: number, yawDeg = 0): KeyLayout | null {
  if (width <= 0 || height <= 0) return null;
  const hud = hudInsets(height);
  const aspect = width / height;
  const cx: number[] = [];
  for (const ch of CHANNELS) {
    const r = faceRectAt(aspect, ch.id, 0, barrelK, hud, yawDeg);
    if (!Number.isFinite(r.x) || !(r.w > 0)) return null;
    cx.push((r.x + r.w / 2) * width);
  }
  let minDist = Infinity;
  for (let i = 1; i < cx.length; i++) minDist = Math.min(minDist, cx[i]! - cx[i - 1]!);
  const w = Math.min(KEY_MAX_PX, Math.floor(minDist - KEY_GAP_PX));
  if (!(w >= KEY_MIN_PX)) return null;
  const lo = width * KEY_EDGE_FRAC + w / 2;
  const hi = width * (1 - KEY_EDGE_FRAC) - w / 2;
  const x = cx.map((v) => Math.min(hi, Math.max(lo, v)));
  for (let i = 1; i < x.length; i++) if (x[i]! - x[i - 1]! < w + KEY_GAP_PX - 1e-6) return null;
  return { x, w };
}

/** 第 1–7 個鍵的抬升比例（二次曲線；與 os.css 的 li:nth-child 的 --lift 同值，osCss.test 檢查） */
export const KEY_LIFT = [0, 0.556, 0.889, 1, 0.889, 0.556, 0] as const;

/**
 * 對位排列時，第 index 個鍵的最終矩形（視窗座標，px）——用 keyLayout 的數學與 CSS 的 --hud-arc／--hud-key／--hud-base 同一組公式算出，
 * 不量 DOM：鍵的 left 有 250ms 過場，在過場開始時量 DOM 會量到舊位置。
 */
export function keyTarget(layout: KeyLayout, index: number, height: number): { left: number; top: number; width: number } {
  const arc = hudArcDepthPx(height);
  const top = height - hudBasePx(height) - hudKeyPx(height) - KEY_LIFT[index]! * arc;
  return { left: layout.x[index]! - layout.w / 2, top, width: layout.w };
}

/** 完整文字（"儀表板 · 待處理 128"）在鍵裡需要的寬度估計（px）：CJK 全形字約 12.5px，其餘約 8px，加上左右內距 24px 與 6px 餘裕。 */
export function fullTextNeedPx(text: string): number {
  let w = 0;
  for (const ch of text) w += /[　-鿿＀-￯]/.test(ch) ? 12.5 : 8;
  return Math.ceil(w) + 24 + 6;
}

/** 鍵寬放不下任何一個完整文字就該改顯示精簡文字（texts＝各頻道去掉 "CH-0x " 之後的完整文字）。 */
export function needsCompact(keyWidth: number, texts: readonly string[]): boolean {
  return texts.some((t) => fullTextNeedPx(t) > keyWidth);
}
