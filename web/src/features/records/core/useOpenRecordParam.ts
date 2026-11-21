import * as React from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { DiaryRecord } from "@/lib/types";

/** ?open=<id>：詳情面板開著哪一筆。不是正整數就當作沒開。 */
function parseOpenId(v: string | null): number | null {
  return v && /^[1-9]\d*$/.test(v) ? Number(v) : null;
}

/** 開面板時記在 history state：代表這一層是我們自己 push 的，關閉時可以直接 back（不會留下重複的歷史）。 */
interface DetailState {
  detailPush?: boolean;
}

/**
 * 詳情面板 ⇄ 網址（?open=）的協議：
 * 開面板用 push、上一筆／下一筆用 replace、無效或不存在的值在資料載入後清除（replace）、
 * 關閉面板後焦點回到觸發元素。
 * @param active 全部「有效」紀錄；@param loaded 紀錄資料是否已載入（沒載入前不判定「不存在」）
 */
export function useOpenRecordParam(active: readonly DiaryRecord[], loaded: boolean) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const rawOpen = searchParams.get("open");
  const openId = parseOpenId(rawOpen);
  const openRecord = openId !== null ? (active.find((r) => r.id === openId) ?? null) : null;

  const triggerRef = React.useRef<{ el: HTMLElement; id: number } | null>(null);

  const setOpenParam = (id: number | null, opts: { replace?: boolean; state?: DetailState } = {}) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (id === null) p.delete("open");
        else p.set("open", String(id));
        return p;
      },
      opts,
    );

  const openDetail = (id: number, trigger: HTMLElement) => {
    triggerRef.current = { el: trigger, id };
    setOpenParam(id, { state: { detailPush: true } });
  };
  const closeDetail = () => {
    if ((location.state as DetailState | null)?.detailPush) navigate(-1);
    else setOpenParam(null, { replace: true });
  };
  const switchDetail = (id: number) => setOpenParam(id, { replace: true, state: (location.state as DetailState | null) ?? {} });

  // 網址指到不存在（或已刪除）的紀錄：資料載入後把 ?open 拿掉
  React.useEffect(() => {
    // 無效的值（abc、0、-1）馬上拿掉；指到不存在／已刪除紀錄的 id 等資料載入後再拿掉
    const invalid = rawOpen !== null && openId === null;
    const missing = openId !== null && loaded && !openRecord;
    if (invalid || missing) setOpenParam(null, { replace: true });
  }, [loaded, rawOpen, openId, openRecord]);

  const getReturnFocus = (): HTMLElement | null => {
    const t = triggerRef.current;
    if (!t) return null;
    if (t.el.isConnected) return t.el;
    return document.querySelector<HTMLElement>(`[data-record-id="${t.id}"]`);
  };

  return { openRecord, openDetail, closeDetail, switchDetail, getReturnFocus };
}
