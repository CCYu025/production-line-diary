import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { createQueryClient } from "@/lib/queryClient";
import { setViewportWidth } from "@/test/recordsHarness";

const preload = vi.hoisted(() => vi.fn());
vi.mock("./osEntry", async (orig) => ({ ...(await orig<typeof import("./osEntry")>()), preloadOsShell: preload }));

import { Sidebar } from "./Sidebar";

let loc: ReturnType<typeof useLocation>;
function Loc() {
  loc = useLocation();
  return null;
}

function shell() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/records"]}>
          <Loc />
          <Sidebar />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const button = () => document.querySelector<HTMLElement>('[data-os="enter-os"]');

beforeEach(() => {
  vi.spyOn(api, "listRecords").mockResolvedValue([]);
  preload.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  setViewportWidth(0);
});

describe("側欄「OS 模式」按鈕", () => {
  it("≥ 1024 才渲染（文字「OS 模式」，在「CYBER 介面」旁）；平板與手機完全不輸出節點", () => {
    for (const [w, want] of [
      [1280, true],
      [1024, true],
      [1023, false],
      [900, false],
      [768, false],
      [375, false],
    ] as const) {
      setViewportWidth(w);
      const { unmount } = shell();
      if (want) {
        expect(button(), `${w}px`).not.toBeNull();
        expect(button()!.textContent).toBe("OS 模式");
        expect(button()!.previousElementSibling?.textContent).toContain("CYBER 介面");
      } else {
        expect(button(), `${w}px`).toBeNull();
        expect(screen.queryByText("OS 模式")).toBeNull();
      }
      unmount();
    }
  });

  it("點擊：導覽到 /os 並帶 enterOs state（抵達後才切換模式）", () => {
    setViewportWidth(1280);
    shell();
    act(() => button()!.click());
    expect(loc.pathname).toBe("/os");
    expect(loc.state).toEqual({ enterOs: true });
  });

  it("pointerenter 與 focus 時預先載入 OS 外殼的 chunk", () => {
    setViewportWidth(1280);
    shell();
    act(() => button()!.focus());
    expect(preload).toHaveBeenCalledTimes(1);
  });
});
