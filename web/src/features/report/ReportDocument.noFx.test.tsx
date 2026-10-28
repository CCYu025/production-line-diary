import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeRecord } from "@/test/recordsHarness";
import { ReportDocument } from "./ReportDocument";
import { formatGeneratedAt, selectReportRecords } from "./reportModel";

/*
 * 規格書 A7（docs/cyber-theme-spec.md §2 紅線 1、§8）：報表本體 #report-output 的輸出裡不得有任何 cyber 掛勾，
 * 不然 cyber 的元件層樣式會漏進列印報表。涵蓋四種嚴重度、三種狀態、有照片與有圖說的紀錄。
 */
const HOOKS = "[data-fx], [data-variant], [data-fx-alert]";

describe("A7：ReportDocument 的輸出沒有 cyber 掛勾", () => {
  it("有紀錄的報表：整個輸出裡找不到 data-fx／data-variant／data-fx-alert", () => {
    const records = [
      makeRecord({ id: 1, severity: "輕微", status: "待處理", rootCause: "吸嘴磨耗", productCode: "P-300", materialCategory: "膠料A" }),
      makeRecord({ id: 2, severity: "一般", status: "追蹤中", date: "2026-10-21", equipment: "G5", category: "缺料" }),
      makeRecord({ id: 3, severity: "嚴重", status: "已解決", date: "2026-10-22", photos: ["a.jpg"], photoCaptions: { "a.jpg": "模具表面裂痕" } }),
      makeRecord({ id: 4, severity: "重大", status: "待處理", date: "2026-10-23", duration: 40 }),
    ];
    const start = "2026-10-20";
    const end = "2026-10-26";
    const { container } = render(
      <ReportDocument
        data={{ start, end, records: selectReportRecords(records, { start, end }), generatedAt: formatGeneratedAt(new Date(2026, 9, 26, 14, 5)) }}
      />,
    );
    expect(container.querySelector("#report-output")).not.toBeNull();
    // 先確認報表真的有內容（不是空的就通過）
    expect(container.querySelectorAll(".rr-sev i").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(HOOKS)).toHaveLength(0);
  });

  it("空範圍的報表也一樣", () => {
    const { container } = render(
      <ReportDocument data={{ start: "2026-10-20", end: "2026-10-26", records: [], generatedAt: formatGeneratedAt(new Date(2026, 9, 26, 14, 5)) }} />,
    );
    expect(container.querySelector("#report-output")).not.toBeNull();
    expect(container.querySelectorAll(HOOKS)).toHaveLength(0);
  });
});
