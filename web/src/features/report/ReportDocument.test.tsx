import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeRecord } from "@/test/recordsHarness";
import type { DiaryRecord } from "@/lib/types";
import { ReportDocument } from "./ReportDocument";
import { formatGeneratedAt, selectReportRecords } from "./reportModel";

// vitest 設 css:false 時 ?raw 會是空字串，所以直接讀檔
const reportCss = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "report.css"), "utf8");

function renderReport(records: DiaryRecord[], start = "2026-10-20", end = "2026-10-26") {
  const selected = selectReportRecords(records, { start, end });
  const utils = render(
    <ReportDocument data={{ start, end, records: selected, generatedAt: formatGeneratedAt(new Date(2026, 9, 26, 14, 5)) }} />,
  );
  const root = utils.container.querySelector("#report-output") as HTMLElement;
  return { ...utils, root };
}

const text = (el: Element | null | undefined) => el?.textContent ?? "";

describe("ReportDocument 結構", () => {
  it("封面（報紙式刊頭）、四張 KPI、兩張排行表、紀錄明細區段都在", () => {
    const { root } = renderReport([
      makeRecord({ id: 1, status: "追蹤中", duration: 10 }),
      makeRecord({ id: 2, status: "已解決", duration: 25, equipment: "G5", category: "缺料" }),
    ]);
    expect(text(root.querySelector(".report-header h2"))).toBe("設備紀錄表");
    expect(text(root.querySelector(".report-header .meta"))).toBe(
      "日期範圍：2026-10-20 ～ 2026-10-26　共 2 筆　產出時間：10/26 14:05",
    );
    const kpis = [...root.querySelectorAll(".report-summary .kpi-card")].map((c) => [text(c.querySelector(".kpi-label")), text(c.querySelector(".kpi-value"))]);
    expect(kpis).toEqual([
      ["事件數", "2筆"],
      ["累計時間", "35分"],
      ["平均耗時", "17.5分/件"],
      ["追蹤中", "1筆"],
    ]);
    expect([...root.querySelectorAll(".rank-blk h4 span")].map(text)).toEqual(["問題分類", "設備"]);
    expect(text(root.querySelector(".report-sec"))).toBe("紀錄明細共 2 筆");
    expect(root.querySelectorAll(".report-record")).toHaveLength(2);
  });

  it("排行表是 grid（div），不是 <table>", () => {
    const { root } = renderReport([makeRecord({ id: 1 })]);
    expect(root.querySelector("table")).toBeNull();
    expect(root.querySelectorAll(".rank-tb")).toHaveLength(2);
  });

  it("排行表：6 個以上項目只列前 5 名，其餘併成「其他 n 項」並標示「前 5 名」", () => {
    const cats = ["A", "B", "C", "D", "E", "F", "G"];
    const recs = cats.map((c, i) => makeRecord({ id: i + 1, category: c, equipment: `E${i}`, duration: 10 + i }));
    const { root } = renderReport(recs);
    const catBlock = root.querySelectorAll(".rank-blk")[0] as HTMLElement;
    expect(text(catBlock.querySelector("h4 em"))).toBe("共 7 類・前 5 名");
    const rows = [...catBlock.querySelectorAll(".rr:not(.hd)")];
    expect(rows).toHaveLength(6); // 前 5 ＋ 其他
    const rest = rows[5] as HTMLElement;
    expect(rest.classList.contains("rest")).toBe(true);
    expect(text(rest.querySelector(".nm"))).toBe("其他 2 項");
    expect(rest.querySelector(".bar i")).toBeNull(); // 其他沒有細條
    expect(text(rest.querySelector(".p"))).toBe("29%"); // 2/7
    expect(text(rows[0]!.querySelector(".rk"))).toBe("01");
    // 設備表同樣 7 台
    expect(text((root.querySelectorAll(".rank-blk")[1] as HTMLElement).querySelector("h4 em"))).toBe("共 7 台・前 5 名");
  });

  it("排行表不超過 5 項：不出現「其他」，標題也沒有「前 5 名」", () => {
    const { root } = renderReport([makeRecord({ id: 1 }), makeRecord({ id: 2, category: "缺料" })]);
    const block = root.querySelectorAll(".rank-blk")[0] as HTMLElement;
    expect(text(block.querySelector("h4 em"))).toBe("共 2 類");
    expect(block.querySelector(".rr.rest")).toBeNull();
  });
});

describe("ReportDocument 紀錄版面與條件欄位", () => {
  it("刊頭條（時間・設備・分類）＋標題＝問題＋左邊欄事實", () => {
    const { root } = renderReport([
      makeRecord({ id: 1, date: "2026-10-26", time: "08:10", equipment: "F3", category: "取料異常", problem: "取料位置偏移", shift: "中", duration: 12, status: "追蹤中", severity: "嚴重" }),
    ]);
    const rec = root.querySelector(".report-record") as HTMLElement;
    const strip = [...rec.querySelectorAll(".rr-strip > div")].map((d) => [text(d.querySelector(".k")), text(d.querySelector(".v"))]);
    expect(strip).toEqual([
      ["時間", "2026-10-26" + "08:10"],
      ["設備", "F3"],
      ["分類", "取料異常"],
    ]);
    expect(text(rec.querySelector(".rr-head"))).toBe("取料位置偏移");
    const facts = [...rec.querySelectorAll(".rr-side .f")].map((f) => [text(f.querySelector(".k")), text(f.querySelector(".v"))]);
    expect(facts).toEqual([
      ["班別", "中"],
      ["耗時", "12分"],
      ["處理狀態", "追蹤中"],
      ["嚴重度", "嚴重"],
    ]);
    expect(rec.querySelector(".rr-sev i")?.getAttribute("data-sev")).toBe("嚴重");
  });

  it("品號／原料類別：有值才顯示（沒有就不出現「—」之類的佔位）", () => {
    const { root } = renderReport([
      makeRecord({ id: 1, time: "08:00", productCode: "P-1001", materialCategory: "PET" }),
      makeRecord({ id: 2, time: "09:00", equipment: "原材區", productCode: null, materialCategory: null }),
      makeRecord({ id: 3, time: "10:00", productCode: "P-2", materialCategory: null }),
    ]);
    const recs = [...root.querySelectorAll(".report-record")];
    const keys = (r: Element) => [...r.querySelectorAll(".rr-side .k")].map(text);
    expect(keys(recs[0]!)).toEqual(["班別", "耗時", "處理狀態", "嚴重度", "品號", "原料類別"]);
    expect(keys(recs[1]!)).toEqual(["班別", "耗時", "處理狀態", "嚴重度"]);
    expect(keys(recs[2]!)).toEqual(["班別", "耗時", "處理狀態", "嚴重度", "品號"]);
    expect(text(recs[1])).not.toContain("—");
  });

  it("處理／根本原因：保留換行（pre-wrap 的 .txt）；沒填顯示「（未填寫）」", () => {
    const { root } = renderReport([
      makeRecord({ id: 1, action: "1. 校正\n2. 清潔\n3. 試跑", rootCause: "吸嘴磨耗\n已排更換" }),
      makeRecord({ id: 2, time: "09:00", action: "", rootCause: null }),
    ]);
    const [first, second] = [...root.querySelectorAll(".report-record")];
    const txts = (r: Element) => [...r.querySelectorAll(".rr-block .txt")];
    expect(txts(first!).map(text)).toEqual(["1. 校正\n2. 清潔\n3. 試跑", "吸嘴磨耗\n已排更換"]);
    expect(txts(second!).map(text)).toEqual(["（未填寫）", "（未填寫）"]);
    expect(txts(second!).every((p) => p.classList.contains("none"))).toBe(true);
    // jsdom 不套 CSS，所以另外檢查樣式表本身：.txt 一定是 pre-wrap（曾經漏掉過，使用者從報表截圖發現）
    expect(reportCss).toMatch(/\.report-record \.rr-block \.txt\s*\{[^}]*white-space:\s*pre-wrap/);
  });

  it("照片格：class 依張數 n1…n6，每張圖說前面有「圖N」，有說明才有圖片說明", () => {
    const recs: DiaryRecord[] = [1, 2, 3, 4, 5, 6, 8].map((n, idx) =>
      makeRecord({
        id: idx + 1,
        time: `0${idx + 1}:00`,
        photos: Array.from({ length: n }, (_, i) => `p${i + 1}.jpg`),
        photoCaptions: { "p1.jpg": "模具表面裂痕" },
      }),
    );
    const { root } = renderReport(recs);
    const grids = [...root.querySelectorAll(".rr-photos")];
    expect(grids.map((g) => g.className)).toEqual([
      "rr-photos n1",
      "rr-photos n2",
      "rr-photos n3",
      "rr-photos n4",
      "rr-photos n5",
      "rr-photos n6",
      "rr-photos n6", // 8 張仍用 n6
    ]);
    const caps = [...(grids[1] as HTMLElement).querySelectorAll("figcaption")].map(text);
    expect(caps).toEqual(["圖1模具表面裂痕", "圖2"]);
    const imgs = [...(grids[0] as HTMLElement).querySelectorAll("img")];
    expect(imgs[0]?.getAttribute("src")).toBe("/photos/20261020/p1.jpg");
    expect(grids[6]!.querySelectorAll("figure")).toHaveLength(8);
  });

  it("沒有照片就不出現照片格", () => {
    const { root } = renderReport([makeRecord({ id: 1, photos: [] })]);
    expect(root.querySelector(".rr-photos")).toBeNull();
  });
});

describe("ReportDocument 日期分組與空範圍", () => {
  it("單日報表：沒有日期分組標題", () => {
    const { root } = renderReport(
      [makeRecord({ id: 1, date: "2026-10-26" }), makeRecord({ id: 2, date: "2026-10-26", time: "09:00" })],
      "2026-10-26",
      "2026-10-26",
    );
    expect(root.querySelector(".report-day")).toBeNull();
    expect(text(root.querySelector(".report-header .meta"))).toContain("日期範圍：2026-10-26　");
  });

  it("範圍涵蓋多天但實際只有一天有紀錄：也不加日期標題（看實際分組數，不看起迄）", () => {
    const { root } = renderReport([makeRecord({ id: 1, date: "2026-10-22" })], "2026-10-20", "2026-10-26");
    expect(root.querySelector(".report-day")).toBeNull();
  });

  it("跨多天：每一天一個標題（M/D（週X）＋筆數＋累計分鐘），紀錄依時間排", () => {
    const { root } = renderReport([
      makeRecord({ id: 1, date: "2026-10-26", time: "08:00", duration: 10 }),
      makeRecord({ id: 2, date: "2026-10-26", time: "09:00", duration: 20 }),
      makeRecord({ id: 3, date: "2026-10-27", time: "07:00", duration: 5 }),
    ], "2026-10-26", "2026-10-27");
    const days = [...root.querySelectorAll(".report-day")].map((d) => [text(d.querySelector(".dd")), text(d.querySelector(".dm"))]);
    expect(days).toEqual([
      ["10/26（週一）", "2 筆・累計 30 分"],
      ["10/27（週二）", "1 筆・累計 5 分"],
    ]);
    // 標題夾在對應那天的紀錄前面
    const order = [...(root.querySelector("#report-records") as HTMLElement).children].map((c) => c.className);
    expect(order).toEqual(["report-sec", "report-day", "report-record", "report-record", "report-day", "report-record"]);
  });

  it("範圍內沒有紀錄：封面＋「這段日期範圍內沒有紀錄」，沒有 KPI／排行表", () => {
    const { root } = renderReport([], "2026-01-01", "2026-01-02");
    expect(text(root.querySelector(".report-header .meta"))).toBe("日期範圍：2026-01-01 ～ 2026-01-02　產出時間：10/26 14:05");
    expect(text(root.querySelector(".report-empty"))).toBe("這段日期範圍內沒有紀錄");
    expect(root.querySelector(".report-summary")).toBeNull();
    expect(root.querySelector(".rank-blk")).toBeNull();
    expect(within(root).queryByText("紀錄明細")).toBeNull();
  });
});

describe("report.css 的列印／窄版面規則（jsdom 不套 CSS，直接檢查樣式表）", () => {
  it("容器查詢（不是 @media）：< 660px 排行表上下排、< 380px 省細條", () => {
    expect(reportCss).toMatch(/@container \(max-width: 659px\)\s*\{\s*\.report-stats\s*\{\s*grid-template-columns: 1fr;/);
    expect(reportCss).toMatch(/@container \(max-width: 380px\)[\s\S]*?\.rank-tb \.bar\s*\{\s*display: none;/);
    expect(reportCss).toMatch(/#report-output\s*\{[^}]*container-type: inline-size;/);
  });

  it("紙張寬度 960 置中；列印時 max-width:none、無邊框", () => {
    expect(reportCss).toMatch(/#report-output\s*\{[^}]*max-width: 960px;[^}]*margin: 0 auto;/);
    expect(reportCss).toMatch(/@media print[\s\S]*?#report-output\s*\{[^}]*max-width: none;/);
  });

  it("列印時隱藏所有 fixed 浮層（portal 的、.fixed、toast、dialog）", () => {
    const print = reportCss.slice(reportCss.indexOf("@media print"));
    expect(print).toContain("body > :not(#root)");
    expect(print).toContain("#root .fixed");
    expect(print).toContain("[data-sonner-toaster]");
    expect(print).toContain('[role="dialog"]');
    expect(print).toMatch(/display: none !important;/);
    expect(print).toContain("size: A4");
  });

  it("報紙配色靠在 #report-output 內重新定義 token", () => {
    const start = reportCss.indexOf("#report-output {");
    const block = reportCss.slice(start, reportCss.indexOf("}", start));
    expect(block).toContain("--page: #fbfaf6;");
    expect(block).toContain("--ink-1: #1a1a17;");
    expect(block).toContain("--line-strong: #1a1a17;");
  });
});
