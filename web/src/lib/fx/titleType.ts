import type * as React from "react";

/**
 * FX-03 標題打字：打字動畫的步數與長度由字數決定（--chars）。
 * 只在 cyber 且沒有減少動態效果（useFx() 為 true）時輸出 style；標準主題與測試環境不輸出，DOM 與原本完全相同。
 * 文字從一開始就完整存在於 DOM，動畫只是 clip-path 遮罩，輔助科技不受影響。
 */
export function titleTypeProps(title: string, fx: boolean): { style?: React.CSSProperties } {
  if (!fx) return {};
  return { style: { "--chars": Math.max(1, Math.min(Array.from(title).length, 16)) } as React.CSSProperties };
}
