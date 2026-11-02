/*
 * 轉場時間 token（docs/os-mode-spec.md §5.1–5.3；毫秒）。所有轉場時間只在這裡定義，timing.test.ts 檢查總長上限。
 */

export const ENTER = {
  /** 總長上限 ≤ 1,200ms */
  total: 1200,
  /** 交接點（E3 中段，雜訊遮蔽下工作站現身） */
  handoff: 875,
  E1: [0, 600],
  E2: [600, 750],
  E3: [750, 1000],
  E4: [1000, 1200],
} as const;

export const EXIT = {
  /** 總長上限 ≤ 900ms */
  total: 900,
  /** 交接點（亮點出現、控制室與 HUD 開始顯示） */
  handoff: 300,
  X1: [0, 150],
  X2: [150, 300],
  X3: [300, 400],
  X4: [300, 900],
} as const;

/** 短轉場（§5.4，頻道之間切換）：雜訊 150ms＋訊號鎖定 150ms。 */
export const SWITCH = {
  /** 總長上限 ≤ 300ms */
  total: 300,
  /** 交接點（雜訊遮蔽下目的地現身） */
  handoff: 75,
  /** 雜訊（不透明度 0.85，從 t=0 蓋住目的地台標卡直到交接點之後） */
  noise: [0, 150],
  /** 訊號鎖定（雜訊淡出） */
  lock: [150, 300],
} as const;

export const ENTER_TOTAL_CAP_MS = 1200;
export const EXIT_TOTAL_CAP_MS = 900;
export const SWITCH_TOTAL_CAP_MS = 300;

/**
 * 開機序列（§5.5；X2）。B1（PRESS ANY KEY）留到 X4，開機從 B2 自動開始。
 * 完整版 ≤ 4,000ms（每個分頁工作階段只播一次）；短版（只有 B3＋B4）≤ 1,000ms。
 * 區間為相對於開機開始的毫秒 [起, 迄)，供 3D 層與 BIOS 文字疊層共用。
 */
export const BOOT_FULL = {
  /** 總長上限 ≤ 4,000ms */
  total: 3900,
  /** B2：BIOS 自檢文字逐行出現 */
  B2: [0, 2300],
  /** B3：一條亮線展開成全畫面 */
  B3: [2300, 2900],
  /** B4：線框從中心向外描繪 */
  B4: [2900, 3900],
} as const;

export const BOOT_SHORT = {
  /** 總長上限 ≤ 1,000ms（量到「控制室現身」要 ≤ 1,000：計時器到點後還有約 5–10ms 的狀態更新與提交，所以 B4 收在 980） */
  total: 980,
  B3: [0, 300],
  B4: [300, 980],
} as const;

export const BOOT_FULL_CAP_MS = 4000;
export const BOOT_SHORT_CAP_MS = 1000;

/** 待機巡視：控制室無輸入達這麼久（毫秒）就開始（§4.3）。 */
export const PATROL_IDLE_MS = 60_000;
