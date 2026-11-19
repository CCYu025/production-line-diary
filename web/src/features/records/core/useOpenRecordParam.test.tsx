import { act, renderHook } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { DiaryRecord } from "@/lib/types";
import { makeRecord } from "@/test/recordsHarness";
import { useOpenRecordParam } from "./useOpenRecordParam";

const RECORDS: DiaryRecord[] = [1, 2, 3].map((id) => makeRecord({ id }));

function setup(initial: string, active: DiaryRecord[] = RECORDS, loaded = true) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={["/prev", initial]} initialIndex={1}>
      {children}
    </MemoryRouter>
  );
  return renderHook(
    (props: { active: DiaryRecord[]; loaded: boolean }) => ({
      h: useOpenRecordParam(props.active, props.loaded),
      loc: useLocation(),
      nav: useNavigate(),
    }),
    { wrapper, initialProps: { active, loaded } },
  );
}
const open = (r: { current: { loc: { search: string } } }) => new URLSearchParams(r.current.loc.search).get("open");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useOpenRecordParam", () => {
  it("網址上的 ?open=<id> 解析出紀錄", () => {
    const { result } = setup("/records?open=2");
    expect(result.current.h.openRecord?.id).toBe(2);
  });

  it("開面板用 push：上一頁一次就回到沒開面板的狀態", () => {
    const { result } = setup("/records");
    const btn = document.body.appendChild(document.createElement("button"));
    act(() => result.current.h.openDetail(2, btn));
    expect(open(result)).toBe("2");
    expect(result.current.h.openRecord?.id).toBe(2);
    act(() => result.current.nav(-1));
    expect(result.current.loc.pathname).toBe("/records");
    expect(open(result)).toBeNull();
  });

  it("closeDetail：自己 push 開的 → back（回到開之前的那一層）", () => {
    const { result } = setup("/records");
    const btn = document.body.appendChild(document.createElement("button"));
    act(() => result.current.h.openDetail(2, btn));
    act(() => result.current.h.closeDetail());
    expect(result.current.loc.pathname).toBe("/records");
    expect(open(result)).toBeNull();
  });

  it("closeDetail：直接用網址開的 → replace 拿掉 open（不離開頁面）", () => {
    const { result } = setup("/records?open=2");
    act(() => result.current.h.closeDetail());
    expect(result.current.loc.pathname).toBe("/records");
    expect(open(result)).toBeNull();
    act(() => result.current.nav(-1));
    expect(result.current.loc.pathname).toBe("/prev");
  });

  it("上一筆／下一筆用 replace：上一頁一次就離開（不是回到前一筆）", () => {
    const { result } = setup("/records?open=2");
    act(() => result.current.h.switchDetail(3));
    expect(open(result)).toBe("3");
    act(() => result.current.nav(-1));
    expect(result.current.loc.pathname).toBe("/prev");
  });

  it("switchDetail 保留 detailPush 標記：之後 closeDetail 仍走 back", () => {
    const { result } = setup("/records");
    const btn = document.body.appendChild(document.createElement("button"));
    act(() => result.current.h.openDetail(1, btn));
    act(() => result.current.h.switchDetail(2));
    act(() => result.current.h.closeDetail());
    expect(result.current.loc.pathname).toBe("/records");
    expect(open(result)).toBeNull();
  });

  it.each(["abc", "0x1", "0", "-1", "1e0", " 1", ""])("無效值 open=%j 馬上被拿掉（replace）", (v) => {
    const { result } = setup(`/records?open=${encodeURIComponent(v)}`, [], false);
    expect(result.current.loc.search).toBe("");
    expect(result.current.h.openRecord).toBeNull();
    act(() => result.current.nav(-1));
    expect(result.current.loc.pathname).toBe("/prev");
  });

  it("不存在的 id：資料載入前保留，載入後拿掉", () => {
    const { result, rerender } = setup("/records?open=999", [], false);
    expect(open(result)).toBe("999");
    rerender({ active: RECORDS, loaded: true });
    expect(open(result)).toBeNull();
  });

  it("已刪除（不在 active 內）的 id 載入後也拿掉；其他 query 保留", () => {
    const { result } = setup("/records?status=待處理&open=4", RECORDS, true);
    expect(open(result)).toBeNull();
    expect(new URLSearchParams(result.current.loc.search).get("status")).toBe("待處理");
  });

  it("關閉後焦點回到觸發元素；觸發元素已脫離 DOM 時找同 id 的列", () => {
    const { result } = setup("/records");
    const btn = document.body.appendChild(document.createElement("button"));
    expect(result.current.h.getReturnFocus()).toBeNull();
    act(() => result.current.h.openDetail(2, btn));
    expect(result.current.h.getReturnFocus()).toBe(btn);
    btn.remove();
    const row = document.body.appendChild(document.createElement("tr"));
    row.setAttribute("data-record-id", "2");
    expect(result.current.h.getReturnFocus()).toBe(row);
  });
});
