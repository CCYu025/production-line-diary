import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SeverityBadge, StatusBadge } from "./badges";

describe("SeverityBadge / StatusBadge", () => {
  it("嚴重度：文字 + 對應的顏色色條", () => {
    const { container } = render(<SeverityBadge severity="重大" />);
    expect(screen.getByText("重大")).toBeInTheDocument();
    expect(container.querySelector(".bg-critical")).not.toBeNull();
  });

  it("嚴重度四個等級各自用不同顏色", () => {
    const classes = (["輕微", "一般", "嚴重", "重大"] as const).map((s) => {
      const { container, unmount } = render(<SeverityBadge severity={s} />);
      const cls = container.querySelector("span[aria-hidden]")?.className ?? "";
      unmount();
      return cls.match(/bg-(good|warning|serious|critical)/)?.[0];
    });
    expect(classes).toEqual(["bg-good", "bg-warning", "bg-serious", "bg-critical"]);
  });

  it("處理狀態：用形狀區分（○ 空心／◐ 半實心／● 實心），不使用嚴重度的顏色", () => {
    const shapes = (["待處理", "追蹤中", "已解決"] as const).map((s) => {
      const { container, unmount } = render(<StatusBadge status={s} />);
      const circles = container.querySelectorAll("svg circle");
      const hasHalf = container.querySelector("svg path") !== null;
      const filled = [...circles].some((c) => c.getAttribute("fill") === "currentColor");
      expect(container.innerHTML).not.toMatch(/bg-(good|warning|serious|critical)/);
      unmount();
      return { hasHalf, filled };
    });
    expect(shapes).toEqual([
      { hasHalf: false, filled: false },
      { hasHalf: true, filled: false },
      { hasHalf: false, filled: true },
    ]);
  });

  it("compact 時文字只給輔助科技（sr-only），標記仍在", () => {
    render(<StatusBadge status="追蹤中" compact />);
    expect(screen.getByText("追蹤中")).toHaveClass("sr-only");
  });
});
