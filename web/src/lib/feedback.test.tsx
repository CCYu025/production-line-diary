import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { ApiError } from "./api";
import { notify } from "./feedback";

describe("notify 的 aria-live 行為", () => {
  it("錯誤訊息是 role=alert（assertive）；成功不是", async () => {
    render(<Toaster />);
    act(() => {
      notify.success("已儲存");
      notify.error(new ApiError({ status: 400, errors: ["date 格式錯誤", "duration 須為正數"], kind: "http" }));
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("date 格式錯誤、duration 須為正數");
    const ok = await screen.findByText("已儲存");
    expect(ok.closest("[role=alert]")).toBeNull();
  });

  it("toast 容器本身是 polite live region", async () => {
    const { container } = render(<Toaster />);
    act(() => {
      notify.info("提示");
    });
    await screen.findByText("提示");
    expect(document.body.querySelector("section[aria-live='polite']")).not.toBeNull();
    expect(container).toBeDefined();
  });
});
