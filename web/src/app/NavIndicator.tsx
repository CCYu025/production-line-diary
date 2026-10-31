import * as React from "react";
import { useLocation } from "react-router-dom";
import { useThemePreference } from "@/lib/useThemePreference";

/**
 * FX-04 nav-indicator（docs/cyber-theme-spec.md §3.3）：側欄／圖示列的高亮條。
 * 一個 aria-hidden 的 <span>，只在 cyber 渲染（標準主題的 DOM 與 AX tree 完全不變）。位置由目前路由決定——
 * 量「目前頁連結（aria-current="page"）」在導覽列內的 offsetTop，寫進 CSS 變數 --nav-y，由 cyber.css 用 transform 位移並加 220ms 過渡。
 * 第一次量測完成前不啟用過渡（data-ready），所以首次渲染／切換到 cyber 時不會從 0 滑過去；沒有目前頁（例如新增紀錄）就淡出。
 */
/** React 18 的型別沒有 inert；字串值會原樣輸出成屬性（不可點、不可聚焦、不進輔助科技樹）。 */
const INERT = { inert: "" } as object;

export function NavIndicator() {
  const cyber = useThemePreference() === "cyber";
  return cyber ? <Indicator /> : null;
}

function Indicator() {
  const ref = React.useRef<HTMLSpanElement>(null);
  const { pathname } = useLocation();

  const measure = React.useCallback(() => {
    const el = ref.current;
    const nav = el?.parentElement;
    if (!el || !nav) return;
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) {
      el.dataset.state = "off";
      return;
    }
    // 導覽列在 cyber 下是定位基準（cyber.css），所以 offsetTop 就是相對導覽列內容頂端的位置（含捲動）
    el.style.setProperty("--nav-y", `${active.offsetTop}px`);
    el.dataset.state = "on";
  }, []);

  React.useLayoutEffect(() => {
    measure();
  }, [measure, pathname]);

  // 第一次量測後的下一個影格才開啟過渡
  React.useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (ref.current) ref.current.dataset.ready = "true";
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // 視窗寬度改變（桌面側欄 ⇄ 圖示列，項目高度與群組標題不同）或導覽列內容改變時重新量測（不播放過渡）
  React.useEffect(() => {
    const nav = ref.current?.parentElement;
    const remeasure = () => {
      const el = ref.current;
      if (!el) return;
      const ready = el.dataset.ready;
      delete el.dataset.ready;
      measure();
      if (ready) requestAnimationFrame(() => ref.current && (ref.current.dataset.ready = "true"));
    };
    window.addEventListener("resize", remeasure);
    const ro = typeof ResizeObserver === "function" && nav ? new ResizeObserver(remeasure) : null;
    if (nav) ro?.observe(nav);
    return () => {
      window.removeEventListener("resize", remeasure);
      ro?.disconnect();
    };
  }, [measure]);

  return <span ref={ref} aria-hidden="true" {...INERT} data-fx-indicator="" data-state="off" />;
}
