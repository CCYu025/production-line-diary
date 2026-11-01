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

export const ENTER_TOTAL_CAP_MS = 1200;
export const EXIT_TOTAL_CAP_MS = 900;
