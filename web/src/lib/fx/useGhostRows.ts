import * as React from "react";
import { useFx } from "./useFx";

/** 被移除的列留下的視覺殘影時間（FX-31，規格 ≤ 250ms；CSS 的溶解動畫比它短一點）。 */
export const GHOST_MS = 250;

interface Ghost<T> {
  row: T;
  index: number;
  kind: string;
}

/**
 * FX-31 回收桶溶解：列從資料裡消失後，在原位置多留一個「殘影」250ms 給 CSS 播溶解動畫，結束就移除。
 * 殘影純屬視覺：API 呼叫、查詢快取、計數、徽章都照原本的時機更新（`rows` 本身一點都沒變，延後的只有畫面上那個節點）。
 * 殘影節點要用 `ghostProps(kind)` 標成 `inert`＋`aria-hidden`（不可聚焦、不可點、不進輔助科技樹）。
 * `useFx()` 為 false（標準主題、減少動態效果、jsdom）時直接回傳 `rows`，DOM 與沒有這個 hook 時相同。
 * `kindRef.current` 是移除當下的操作種類（例如 "restore"／"purge"），原樣寫進殘影的 `data-fx-ghost`。
 */
export function useGhostRows<T extends { id: number }>(rows: T[], kindRef: { current: string }) {
  const fx = useFx();
  const [prevRows, setPrevRows] = React.useState(rows);
  const [ghosts, setGhosts] = React.useState<Ghost<T>[]>([]);

  // 在 render 中比對新舊列表（React 文件的「由 props 推導 state」寫法），殘影與新列表在同一次 commit 出現，焦點中的按鈕不會先被卸載
  if (prevRows !== rows) {
    setPrevRows(rows);
    if (fx) {
      const ids = new Set(rows.map((r) => r.id));
      const gone = prevRows.flatMap((row, index) => (ids.has(row.id) ? [] : [{ row, index, kind: kindRef.current }]));
      if (gone.length) setGhosts((g) => [...g.filter((x) => !ids.has(x.row.id)), ...gone]);
    }
  }

  React.useEffect(() => {
    if (!ghosts.length) return;
    const id = window.setTimeout(() => setGhosts([]), GHOST_MS);
    return () => window.clearTimeout(id);
  }, [ghosts]);

  const list = React.useMemo(() => {
    if (!fx || !ghosts.length) return rows;
    const out = [...rows];
    const ids = new Set(rows.map((r) => r.id));
    for (const g of [...ghosts].filter((x) => !ids.has(x.row.id)).sort((a, b) => a.index - b.index)) out.splice(Math.min(g.index, out.length), 0, g.row);
    return out;
  }, [fx, rows, ghosts]);

  const kinds = React.useMemo(() => new Map(ghosts.map((g) => [g.row.id, g.kind])), [ghosts]);
  const kindOf = (id: number): string | undefined => (fx ? kinds.get(id) : undefined);
  return { list, kindOf };
}

/** React 18 的型別沒有 inert；字串值會原樣輸出成屬性。非殘影回傳空物件（不加任何屬性）。 */
export function ghostProps(kind: string | undefined): object {
  return kind ? { "data-fx-ghost": kind, "aria-hidden": true, inert: "" } : {};
}
