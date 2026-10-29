import * as React from "react";
import { useFx } from "./useFx";

/** 亂跳的總次數與總時長（規格 FX-07：6～8 次、400ms）。 */
const TICKS = 7;
const DURATION_MS = 400;

/**
 * 把 `text` 裡「還沒鎖定」的數字換成隨機數字。progress 0～1：由左到右依序鎖定，1 時等於原文。
 * 非數字字元（逗號、小數點、單位）原樣保留，所以長度與每個字元的位置都不變。
 */
export function scrambleText(text: string, progress: number, rand: () => number = Math.random): string {
  const digits = [...text].filter((c) => c >= "0" && c <= "9").length;
  let seen = 0;
  return [...text]
    .map((c) => {
      if (c < "0" || c > "9") return c;
      const locked = (seen + 1) / digits <= progress;
      seen += 1;
      return locked ? c : String(Math.floor(rand() * 10));
    })
    .join("");
}

/**
 * KPI 數字：先亂跳再鎖定成真實值（FX-07）。
 * 無障礙（規格 §3.5）：真實數字放在 `sr-only` 的 span，亂跳的那份是 `aria-hidden`，動畫一結束就移除，
 * 之後 DOM 裡只剩一份純文字（`getByText` 不會找到兩個）。
 * `useFx()` 為 false（標準主題、減少動態效果、jsdom）或沒有數字時直接輸出文字，DOM 與沒有這個元件時相同。
 * 數值改變（例如切換範圍）會重播。
 */
export function ScrambleNumber({ value }: { value: string | number }) {
  const text = String(value);
  const fx = useFx();
  const [scrambled, setScrambled] = React.useState<string | null>(null);

  // layout effect：在畫面繪出前就換成亂碼，不會先閃一下真實值
  React.useLayoutEffect(() => {
    if (!fx || !/\d/.test(text)) {
      setScrambled(null);
      return;
    }
    let tick = 0;
    setScrambled(scrambleText(text, 0));
    const id = window.setInterval(() => {
      tick += 1;
      if (tick >= TICKS) {
        window.clearInterval(id);
        setScrambled(null);
      } else {
        setScrambled(scrambleText(text, tick / TICKS));
      }
    }, DURATION_MS / TICKS);
    return () => window.clearInterval(id);
  }, [text, fx]);

  if (scrambled === null) return <>{text}</>;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{scrambled}</span>
    </>
  );
}
