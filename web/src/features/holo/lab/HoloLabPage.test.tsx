import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import HoloLabPage from "./HoloLabPage";

/*
 * 實驗室外殼（jsdom 沒有 WebGL，所以只驗證外殼規則）：掛載時 <html data-mode="holo"> 與 Cyber 主題（只套用、不寫入偏好），
 * 卸載時還原；全像元件不輸出 data-fx（那是 Cyber 頁面特效的掛勾）。
 */
function mount(search = "") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/_holo${search}`]}>
        <HoloLabPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  delete document.documentElement.dataset.mode;
  delete document.documentElement.dataset.theme;
  window.localStorage.clear();
});

describe("HoloLabPage 外殼", () => {
  it("掛載時設 data-mode=holo 與 cyber，卸載時還原；不寫入主題偏好", () => {
    const { unmount } = mount();
    expect(document.documentElement.dataset.mode).toBe("holo");
    expect(document.documentElement.dataset.theme).toBe("cyber");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    unmount();
    expect(document.documentElement.dataset.mode).toBeUndefined();
    expect(document.documentElement.dataset.theme).not.toBe("cyber");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("WebGL 不可用時顯示說明（不是空白頁）", () => {
    const { getByRole } = mount();
    expect(getByRole("alert")).toHaveTextContent("WebGL");
  });

  it("全像元件不輸出 data-fx、data-variant", () => {
    const { container } = mount("?scene=machine");
    expect(container.querySelector("[data-fx]")).toBeNull();
    expect(container.querySelector("[data-variant]")).toBeNull();
    expect(container.querySelector('[data-holo="root"]')).not.toBeNull();
  });

  it("控制條有場景與強度的連結", () => {
    const { getByRole } = mount();
    const group = getByRole("group", { name: "實驗室控制" });
    expect(group).toHaveTextContent("機台");
    expect(group).toHaveTextContent("螺旋");
  });
});
