import { describe, expect, it } from "vitest";
import { routes } from "@/app/routes";
import { CHANNELS, channelButtonLabel, channelByIndex, channelForPath, channelIndex, getChannel, isHubPath } from "./channels";

const concrete = (p: string) => p.replace(/:\w+/g, "1");
const rootChildren = (routes[0]!.children ?? []) as { path?: string; index?: boolean }[];
const routePaths = rootChildren.filter((r) => !r.index && r.path).map((r) => "/" + r.path!);

describe("channels", () => {
  it("七個頻道 CH-01…CH-07", () => {
    expect(CHANNELS.map((c) => c.id)).toEqual(["CH-01", "CH-02", "CH-03", "CH-04", "CH-05", "CH-06", "CH-07"]);
  });

  it("每個頻道的每個樣式都對應到存在的路由，進入路徑也屬於該頻道", () => {
    for (const c of CHANNELS) {
      for (const pat of c.patterns) expect(routePaths, `${c.id} ${pat}`).toContain(pat);
      expect(channelForPath(c.path)).toBe(c.id);
    }
  });

  it("每個現有路由（除 os／_ui／*）都屬於某個頻道", () => {
    for (const p of routePaths) {
      if (p === "/os" || p === "/_ui" || p === "/*") continue;
      expect(channelForPath(concrete(p)), p).not.toBeNull();
    }
  });

  it("特例：編輯 → CH-02、新增（含 ?copy）→ CH-03", () => {
    expect(channelForPath("/records/63/edit")).toBe("CH-02");
    expect(channelForPath("/records/new")).toBe("CH-03");
    expect(channelForPath("/records")).toBe("CH-02");
    expect(channelForPath("/records/")).toBe("CH-02");
  });

  it("控制室與未知路徑不屬於任何頻道", () => {
    expect(channelForPath("/os")).toBeNull();
    expect(channelForPath("/nope")).toBeNull();
    expect(isHubPath("/os")).toBe(true);
    expect(isHubPath("/")).toBe(true);
    expect(isHubPath("/records")).toBe(false);
  });

  it("getChannel", () => {
    expect(getChannel("CH-02").name).toBe("紀錄");
  });
});

describe("channels 輔助", () => {
  it("channelByIndex／channelIndex", () => {
    expect(channelByIndex(0)?.id).toBe("CH-01");
    expect(channelByIndex(6)?.id).toBe("CH-07");
    expect(channelByIndex(7)).toBeUndefined();
    expect(channelByIndex(-1)).toBeUndefined();
    for (const c of CHANNELS) expect(channelByIndex(channelIndex(c.id))).toBe(c);
  });
  it("channelButtonLabel：代號＋中文名稱", () => {
    expect(channelButtonLabel(getChannel("CH-02"))).toBe("CH-02 紀錄");
    expect(channelButtonLabel(getChannel("CH-07"))).toBe("CH-07 設定");
  });
});
