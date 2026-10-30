import * as React from "react";
import { useFx } from "./useFx";

/**
 * 「不重掛的重播」：資料簽名改變時，相位在 "a"／"b" 之間切換；簽名沒變（例如 refetch 回來資料相同）相位不變。
 * 呼叫端把相位輸出成 data-fx-phase，CSS 依相位在內容相同、名稱不同的兩組 @keyframes（如 cyber-bar-grow／cyber-bar-grow-b）之間切換
 * animation-name——瀏覽器看到名稱改變就重播，DOM 節點與 key 完全不動（可聚焦元素不會被重掛、焦點不會掉）。
 * 標準主題與減少動態效果時回傳 undefined（不輸出屬性，DOM 與以前完全相同）。
 */
export function useReplayPhase(signature: string): "a" | "b" | undefined {
  const fx = useFx();
  const [state, setState] = React.useState({ signature, n: 0 });
  if (state.signature !== signature) setState({ signature, n: state.n + 1 });
  if (!fx) return undefined;
  return state.n % 2 === 0 ? "a" : "b";
}
