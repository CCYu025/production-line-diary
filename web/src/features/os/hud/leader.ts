/*
 * 控制台引線（docs/holo-mode-spec.md §7.2；H0）：選中的頻道鍵 → 3D 選中螢幕之間的一條 1px 線。純幾何，不碰 DOM。
 * 螢幕在畫面上的位置用 hub/faceRect 的投影（含桶狀弧面與選取偏航）；只在選取、視窗大小、CRT 強度改變時才重算，不每幀量測。
 */
import type { ChannelId } from "../channels";
import { baseAnchorAt } from "../hub/faceRect";
import { hudInsets, selectYawDeg } from "../hub/layout";
import { channelIndex } from "../channels";

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
