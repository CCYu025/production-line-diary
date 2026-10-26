import { describe, expect, it } from "vitest";
import { cleanDraft, composeDraft, draftFromSaved, draftSignature, PRODUCTION_EQUIPMENT } from "./mapDraft";

const counter = () => {
  let n = 0;
  return () => ++n;
};

describe("composeDraft（第一次打開的草稿 = 已儲存 ∪ 預設生產機台）", () => {
  it("預設生產機台是 F3/F4/G5/G6/F7/F8", () => {
    expect([...PRODUCTION_EQUIPMENT]).toEqual(["F3", "F4", "G5", "G6", "F7", "F8"]);
  });

  it("沒有任何已儲存的對照 → 六台預設機台，欄位是空字串", () => {
    const rows = composeDraft([], counter());
    expect(rows.map((r) => r.equipment)).toEqual(["F3", "F4", "G5", "G6", "F7", "F8"]);
    expect(rows.every((r) => r.productCode === "" && r.materialCategory === "")).toBe(true);
  });

  it("不會自動列入原材區、RB2", () => {
    const names = composeDraft([], counter()).map((r) => r.equipment);
    expect(names).not.toContain("原材區");
    expect(names).not.toContain("RB2");
  });

  it("已儲存的在前（保留順序與內容、null 轉成空字串），缺的預設機台接在後面，不重複", () => {
    const rows = composeDraft(
      [
        { equipment: "G5", productCode: "P-9", materialCategory: null },
        { equipment: "原材區", productCode: null, materialCategory: "膠料" },
        { equipment: "F3", productCode: null, materialCategory: "M-1" },
      ],
      counter(),
    );
    expect(rows.map((r) => r.equipment)).toEqual(["G5", "原材區", "F3", "F4", "G6", "F7", "F8"]);
    expect(rows[0]).toMatchObject({ productCode: "P-9", materialCategory: "" });
    expect(rows[2]).toMatchObject({ productCode: "", materialCategory: "M-1" });
  });

  it("已儲存的對照裡有 RB2 就保留（只是不「自動」加入）", () => {
    const rows = composeDraft([{ equipment: "RB2", productCode: null, materialCategory: null }], counter());
    expect(rows.map((r) => r.equipment)).toContain("RB2");
  });

  it("每列有不重複的 key", () => {
    const keys = composeDraft([], counter()).map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("draftFromSaved（存檔後以伺服器回傳為準，不再補預設列）", () => {
  it("只含儲存的列", () => {
    const rows = draftFromSaved([{ equipment: "F3", productCode: "P", materialCategory: null }], counter());
    expect(rows.map((r) => r.equipment)).toEqual(["F3"]);
  });
});

describe("cleanDraft / draftSignature", () => {
  it("去頭尾空白、設備代號是空的整列丟掉", () => {
    const rows = [
      { key: 1, equipment: " F3 ", productCode: " P-1 ", materialCategory: "" },
      { key: 2, equipment: "   ", productCode: "x", materialCategory: "y" },
      { key: 3, equipment: "", productCode: "", materialCategory: "" },
    ];
    expect(cleanDraft(rows)).toEqual([{ equipment: "F3", productCode: "P-1", materialCategory: "" }]);
  });

  it("新增一列但還沒填，簽章不變（不算未儲存的變更）；填了就變", () => {
    const base = [{ key: 1, equipment: "F3", productCode: "", materialCategory: "" }];
    const sig = draftSignature(base);
    expect(draftSignature([...base, { key: 2, equipment: "", productCode: "", materialCategory: "" }])).toBe(sig);
    expect(draftSignature([...base, { key: 2, equipment: "F9", productCode: "", materialCategory: "" }])).not.toBe(sig);
    expect(draftSignature([{ ...base[0]!, productCode: "P" }])).not.toBe(sig);
  });

  it("前後空白不同不算變更", () => {
    const a = [{ key: 1, equipment: "F3", productCode: "P", materialCategory: "" }];
    const b = [{ key: 9, equipment: "F3 ", productCode: " P", materialCategory: "" }];
    expect(draftSignature(a)).toBe(draftSignature(b));
  });
});
