import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { createQueryClient } from "@/lib/queryClient";
import { useExportAction } from "./useExportAction";

afterEach(() => vi.restoreAllMocks());

function setup() {
  const client = createQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useExportAction(), { wrapper });
}

describe("useExportAction", () => {
  it("同一個 tick 連點多下只送出一個匯出請求", async () => {
    let resolve!: (v: { path: string }) => void;
    const spy = vi.spyOn(api, "exportXlsx").mockImplementation(() => new Promise((r) => (resolve = r)));
    const { result } = setup();

    await act(async () => {
      void result.current.run();
      void result.current.run();
      void result.current.run();
    });
    expect(spy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ path: "x.xlsx" });
    });
    // 結束後可以再匯出一次
    spy.mockResolvedValue({ path: "y.xlsx" });
    await act(async () => {
      await result.current.run();
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("失敗後也會解除鎖定，可以重試", async () => {
    const spy = vi.spyOn(api, "exportXlsx").mockRejectedValueOnce(new Error("壞了")).mockResolvedValue({ path: "z.xlsx" });
    const { result } = setup();
    await act(async () => {
      await result.current.run();
    });
    await act(async () => {
      await result.current.run();
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
