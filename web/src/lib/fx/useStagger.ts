import * as React from "react";
import { useMediaQuery } from "../useMediaQuery";
import { useFx } from "./useFx";

/** 依序進場的上限（規格 §6.1 規則 4）：桌面（≥ 768）20 項、手機 10 項；超過的直接出現，不排隊。 */
export const STAGGER_CAP_DESKTOP = 20;
export const STAGGER_CAP_MOBILE = 10;

/** 依視窗寬度回傳目前的依序進場上限。 */
export function useStaggerCap(): number {
  return useMediaQuery("(min-width: 768px)") ? STAGGER_CAP_DESKTOP : STAGGER_CAP_MOBILE;
}

/** 要展開到元素上的屬性：`data-fx-in` 標示「這個元素要播進場」，`--i` 是第幾項（CSS 用它乘以間隔算 animation-delay）。 */
export interface StaggerProps {
  "data-fx-in"?: "";
  style?: React.CSSProperties;
}

const NONE: StaggerProps = Object.freeze({});

/**
 * 列表、長條的依序進場延遲（規格 §3.5，FX-09／12／14／16）。
 * 回傳 `(index) => props`：只有 `useFx()` 為 true 且 `index` 在 `[0, min(count, cap))` 內才有屬性，
 * 其餘（標準主題、減少動態效果、jsdom、超過上限的項目）都是空物件——DOM 與沒有這個 hook 時完全相同。
 * 純視覺：只輸出屬性與一個 CSS 變數，不改 DOM 順序、不延後渲染。實際的動畫與間隔寫在 cyber.css。
 */
export function useStagger(count: number, cap: number): (index: number) => StaggerProps {
  const fx = useFx();
  const limit = Math.max(0, Math.min(count, cap));
  return React.useCallback(
    (index: number): StaggerProps => {
      if (!fx || !Number.isInteger(index) || index < 0 || index >= limit) return NONE;
      return { "data-fx-in": "", style: { "--i": index } as React.CSSProperties };
    },
    [fx, limit],
  );
}
