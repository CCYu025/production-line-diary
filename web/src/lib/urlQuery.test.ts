import { emptyFilter } from "@shared/aggregate";
import { describe, expect, it } from "vitest";
import { applyRecordFilter, parseRecordFilter, recordFilterToParams } from "./urlQuery";

const parse = (qs: string) => parseRecordFilter(new URLSearchParams(qs));

describe("urlQuery: parseRecordFilter", () => {
  it("沒有任何 query = 空的篩選條件", () => {
    expect(parse("")).toEqual(emptyFilter());
  });

  it("讀取各維度；陣列用重複的 key", () => {
    const f = parse("equipment=F3&equipment=F4&category=缺料&severity=嚴重&status=待處理&from=2026-10-01&to=2026-10-26&q=卡料&problem=取料失敗");
    expect(f).toEqual({
      equipment: ["F3", "F4"],
      category: ["缺料"],
      severity: "嚴重",
      status: "待處理",
      problem: "取料失敗",
      from: "2026-10-01",
      to: "2026-10-26",
      query: "卡料",
    });
  });

  it("無法辨識的值直接忽略，不丟錯", () => {
    const f = parse("severity=超嚴重&status=done&from=yesterday&to=2026/10/26&equipment=%20&from=2026-13-45&to=2026-02-30");
    expect(f).toEqual(emptyFilter());
  });

  it("不存在的日期（2026-13-45、2026-02-30）直接忽略，不會產生壞掉的日期 chip", () => {
    expect(parse("from=2026-13-45&to=2026-10-26")).toMatchObject({ from: "", to: "2026-10-26" });
    expect(parse("from=2026-02-30")).toMatchObject({ from: "" });
    expect(parse("from=2026-02-28&to=2026-03-01")).toMatchObject({ from: "2026-02-28", to: "2026-03-01" });
  });

  it("剛好是空字串的設備／分類保留（「（未填）」的精確篩選）；來回網址不變", () => {
    const f = parse("equipment=&category=");
    expect(f.equipment).toEqual([""]);
    expect(f.category).toEqual([""]);
    expect(recordFilterToParams(f).toString()).toBe("equipment=&category=");
  });

  it("陣列去重、略過空白值；值前後的空白保留（紀錄裡存 \"F3 \" 就要篩得到它），只有關鍵字 q 會 trim", () => {
    expect(parse("equipment=F3&equipment=F3&equipment=%20&equipment=%20F4%20").equipment).toEqual(["F3", " F4 "]);
    expect(parse("category=%E5%8F%96%E6%96%99%20").category).toEqual(["取料 "]);
    expect(parse("q=%20%E5%8D%A1%E6%96%99%20").query).toBe("卡料");
  });

  it("名稱含逗號、& 、空白的設備可以來回而不被拆開", () => {
    const f = { ...emptyFilter(), equipment: ["F3,F4", "A&B", "原材區 1"] };
    expect(parseRecordFilter(recordFilterToParams(f))).toEqual(f);
  });
});

describe("urlQuery: 寫回網址", () => {
  it("預設值（空）不會寫進網址", () => {
    expect(recordFilterToParams(emptyFilter()).toString()).toBe("");
  });

  it("只寫有值的欄位", () => {
    const f = { ...emptyFilter(), status: "追蹤中" as const, query: "卡料" };
    const params = recordFilterToParams(f);
    expect([...params.keys()].sort()).toEqual(["q", "status"]);
    expect(params.get("status")).toBe("追蹤中");
  });

  it("parse(write(f)) 還原原本的條件", () => {
    const f = {
      equipment: ["F3", "RB2"],
      category: ["取料異常"],
      severity: "重大" as const,
      status: "已解決" as const,
      problem: "吸嘴堵塞",
      from: "2026-10-01",
      to: "2026-10-31",
      query: "a b",
    };
    expect(parseRecordFilter(recordFilterToParams(f))).toEqual(f);
  });

  it("applyRecordFilter 保留不相關的 query，並且會清掉舊的篩選值", () => {
    const base = new URLSearchParams("open=12&status=待處理&equipment=F3");
    const next = applyRecordFilter(base, { ...emptyFilter(), severity: "嚴重" });
    expect(next.get("open")).toBe("12");
    expect(next.get("severity")).toBe("嚴重");
    expect(next.has("status")).toBe(false);
    expect(next.has("equipment")).toBe(false);
  });

  it("不會改動傳入的 base", () => {
    const base = new URLSearchParams("status=待處理");
    applyRecordFilter(base, emptyFilter());
    expect(base.get("status")).toBe("待處理");
  });
});
