import { act, renderHook } from "@testing-library/react";
import type * as React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { useRecordFilterParams } from "./urlQuery";

function setup(initial = "/records") {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
  return renderHook(() => ({ hook: useRecordFilterParams(), location: useLocation() }), { wrapper });
}

describe("useRecordFilterParams", () => {
  it("讀得到網址上的條件", () => {
    const { result } = setup("/records?status=追蹤中&equipment=F3");
    expect(result.current.hook[0].status).toBe("追蹤中");
    expect(result.current.hook[0].equipment).toEqual(["F3"]);
  });

  it("同一個 tick 連續兩次 setFilter 不會互相覆蓋（status 不會被吃掉）", () => {
    const { result } = setup();
    act(() => {
      const [, setFilter] = result.current.hook;
      setFilter((f) => ({ ...f, status: "待處理" }));
      setFilter((f) => ({ ...f, equipment: [...f.equipment, "F3"] }));
    });
    const [filter] = result.current.hook;
    expect(filter.status).toBe("待處理");
    expect(filter.equipment).toEqual(["F3"]);
    expect(result.current.location.search).toContain("status=");
    expect(result.current.location.search).toContain("equipment=F3");
  });

  it("同一個 tick 三次（物件式與函式式混用）也都保留", () => {
    const { result } = setup("/records?open=12");
    act(() => {
      const [filter, setFilter] = result.current.hook;
      setFilter({ ...filter, severity: "嚴重" });
      setFilter((f) => ({ ...f, query: "卡料" }), { replace: true });
      setFilter((f) => ({ ...f, category: ["缺料"] }));
    });
    const [filter] = result.current.hook;
    expect(filter).toMatchObject({ severity: "嚴重", query: "卡料", category: ["缺料"] });
    expect(new URLSearchParams(result.current.location.search).get("open")).toBe("12");
  });

  it("連續兩次、分開的 act 也能累加", () => {
    const { result } = setup();
    act(() => result.current.hook[1]((f) => ({ ...f, status: "已解決" })));
    act(() => result.current.hook[1]((f) => ({ ...f, severity: "重大" })));
    expect(result.current.hook[0]).toMatchObject({ status: "已解決", severity: "重大" });
  });
});
