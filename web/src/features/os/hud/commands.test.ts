import { describe, expect, it } from "vitest";
import { CHANNELS } from "../channels";
import { COMMANDS, parseCommand, parseRecordId, suggest } from "./commands";

describe("parseCommand：導覽", () => {
  const table: Array<[string, string, string]> = [
    ["dash", "/dashboard", "CH-01 儀表板"],
    ["rec", "/records", "CH-02 紀錄"],
    ["new", "/records/new", "CH-03 新增"],
    ["cal", "/calendar", "CH-04 日曆"],
    ["rep", "/report", "CH-05 報表"],
    ["trash", "/trash", "CH-06 回收桶"],
    ["set", "/settings", "CH-07 設定"],
  ];
  for (const [text, path, label] of table) {
    it(`${text} → ${path}`, () => expect(parseCommand(text)).toEqual({ type: "nav", path, label }));
  }
  it("每個導覽指令的路徑都對應到頻道表", () => {
    const paths = CHANNELS.map((c) => c.path);
    for (const [text] of table) {
      const r = parseCommand(text);
      expect(r.type).toBe("nav");
      if (r.type === "nav") expect(paths).toContain(r.path);
    }
  });
  it("不分大小寫、容忍前後與中間空白", () => {
    expect(parseCommand("  DASH  ")).toEqual(parseCommand("dash"));
    expect(parseCommand("Cal")).toEqual(parseCommand("cal"));
    expect(parseCommand("REC   63")).toEqual(parseCommand("rec 63"));
  });
});

describe("parseCommand：rec <id>", () => {
  it("rec 63 → /records?open=63", () => {
    expect(parseCommand("rec 63")).toEqual({ type: "nav", path: "/records?open=63", label: "CH-02 紀錄 #63" });
  });
  it("前導 0 正規化", () => expect(parseCommand("rec 007")).toMatchObject({ path: "/records?open=7" }));
  it("非正整數 → 錯誤", () => {
    for (const bad of ["0", "-1", "1.5", "abc", "63abc", "1e3", "+5", "0x10", "９９"]) {
      const r = parseCommand(`rec ${bad}`);
      expect(r.type, bad).toBe("error");
      if (r.type === "error") expect(r.message).toContain("正整數");
    }
  });
  it("超出安全整數 → 錯誤", () => expect(parseCommand("rec 99999999999999999999").type).toBe("error"));
  it("多個參數 → 錯誤", () => expect(parseCommand("rec 1 2").type).toBe("error"));
  it("parseRecordId", () => {
    expect(parseRecordId("1")).toBe(1);
    expect(parseRecordId("12")).toBe(12);
    expect(parseRecordId("0")).toBeNull();
    expect(parseRecordId("")).toBeNull();
    expect(parseRecordId("-3")).toBeNull();
  });
});

describe("parseCommand：exit／help／empty／error", () => {
  it("exit、help", () => {
    expect(parseCommand("exit")).toEqual({ type: "exit" });
    expect(parseCommand("EXIT")).toEqual({ type: "exit" });
    expect(parseCommand("help")).toEqual({ type: "help" });
  });
  it("空字串與空白 → empty", () => {
    expect(parseCommand("")).toEqual({ type: "empty" });
    expect(parseCommand("   \t ")).toEqual({ type: "empty" });
  });
  it("未知指令 → error，訊息含輸入的指令與 help 提示", () => {
    const r = parseCommand("banana");
    expect(r.type).toBe("error");
    if (r.type === "error") {
      expect(r.message).toContain("banana");
      expect(r.message).toContain("help");
    }
  });
  it("無參數的指令帶參數 → error", () => {
    for (const t of ["dash 1", "exit now", "help me", "new x"]) expect(parseCommand(t).type, t).toBe("error");
  });
  it("「/」開頭不是指令", () => expect(parseCommand("/dash").type).toBe("error"));
});

describe("suggest", () => {
  const names = (t: string) => suggest(t).map((s) => s.command);
  it("空字串：全部指令，順序同 COMMANDS", () => {
    expect(names("")).toEqual(COMMANDS.map((c) => c.usage));
    expect(names("   ")).toEqual(COMMANDS.map((c) => c.usage));
  });
  it("前綴比對（不分大小寫）", () => {
    expect(names("d")).toEqual(["dash"]);
    expect(names("DA")).toEqual(["dash"]);
    expect(names("r")).toEqual(["rec", "rec <id>", "rep"]);
    expect(names("re")).toEqual(["rec", "rec <id>", "rep"]);
    expect(names("rec")).toEqual(["rec", "rec <id>"]);
    expect(names("e")).toEqual(["export", "exit"]);
    expect(names("exp")).toEqual(["export"]);
    expect(names("匯")).toEqual(["export"]);
    expect(names("t")).toEqual(["trash"]);
    expect(names("s")).toEqual(["set", "sound on|off"]);
  });
  it("沒有符合：空陣列", () => {
    expect(suggest("zzz")).toEqual([]);
    expect(suggest("dashboard")).toEqual([]);
  });
  it("每筆都有說明；rec <id> 的 insert 是 'rec '", () => {
    for (const s of suggest("")) expect(s.description.length).toBeGreaterThan(0);
    expect(suggest("rec").find((s) => s.command === "rec <id>")!.insert).toBe("rec ");
    expect(suggest("rec").find((s) => s.command === "rec")!.insert).toBe("rec");
    expect(suggest("dash")[0]!.insert).toBe("dash");
  });
  it("rec 後接空白：提示用法；接有效編號：單筆；無效：仍提示用法", () => {
    expect(names("rec ")).toEqual(["rec <id>"]);
    expect(suggest("rec 63")).toEqual([{ command: "rec 63", description: "開啟紀錄 #63", insert: "rec 63" }]);
    expect(names("rec abc")).toEqual(["rec <id>"]);
    expect(names("rec 0")).toEqual(["rec <id>"]);
  });
  it("其他指令後面有空白：沒有建議", () => {
    expect(suggest("dash ")).toEqual([]);
    expect(suggest("exit now")).toEqual([]);
  });
  it("所有建議的 insert 或 command 都能被 parseCommand 接受（rec <id> 用法除外）", () => {
    for (const s of suggest("")) {
      if (s.command === "rec <id>") continue;
      expect(parseCommand(s.insert).type, s.insert).not.toBe("error");
    }
  });
});

describe("export（匯出 Excel）", () => {
  it("export 與別名「匯出」→ { type: export }（不分大小寫、容忍空白）", () => {
    expect(parseCommand("export")).toEqual({ type: "export" });
    expect(parseCommand("  EXPORT ")).toEqual({ type: "export" });
    expect(parseCommand("匯出")).toEqual({ type: "export" });
  });
  it("不接受參數", () => {
    const r = parseCommand("export all");
    expect(r.type).toBe("error");
    const r2 = parseCommand("匯出 x");
    expect(r2.type).toBe("error");
  });
  it("在指令表（help 與自動完成都會列出）、Tab 補完成 export", () => {
    expect(COMMANDS.some((c) => c.name === "export")).toBe(true);
    expect(suggest("匯")[0]!.insert).toBe("export");
    expect(suggest("exp")[0]!.insert).toBe("export");
  });
});

describe("crt 指令（D7）", () => {
  it("crt off|std|max → { type: crt, level }（不分大小寫、容忍空白）", () => {
    expect(parseCommand("crt off")).toEqual({ type: "crt", level: "off" });
    expect(parseCommand("crt std")).toEqual({ type: "crt", level: "std" });
    expect(parseCommand("  CRT   MAX ")).toEqual({ type: "crt", level: "max" });
  });
  it("crt 不帶參數＝查詢目前強度（不是錯誤）", () => expect(parseCommand("crt")).toEqual({ type: "crt", level: null }));
  it("無效參數、多個參數 → error，訊息列出可用值", () => {
    for (const bad of ["crt high", "crt off std", "crt 1", "crt on"]) {
      const r = parseCommand(bad);
      expect(r.type, bad).toBe("error");
      if (r.type === "error") expect(r.message).toMatch(/off.*std.*max/);
    }
  });
  it("在指令表（help 會列出）", () => {
    const def = COMMANDS.find((c) => c.name === "crt")!;
    expect(def.usage).toBe("crt off|std|max");
    expect(def.description.length).toBeGreaterThan(0);
  });
  it("Tab 補全：c 列出 cal 與 crt；crt 補成 'crt '；'crt ' 列出三個選項；前綴過濾", () => {
    const names = (t: string) => suggest(t).map((s) => s.command);
    expect(names("c")).toEqual(["cal", "crt off|std|max"]);
    expect(suggest("cr")[0]!.insert).toBe("crt ");
    expect(names("crt ")).toEqual(["crt off", "crt std", "crt max"]);
    expect(names("crt o")).toEqual(["crt off"]);
    expect(names("crt s")).toEqual(["crt std"]);
    expect(suggest("crt m")[0]!.insert).toBe("crt max");
    expect(names("crt zzz")).toEqual(["crt off|std|max"]);
  });
  it("補全出來的 insert 都能被 parseCommand 接受", () => {
    for (const s of suggest("crt ")) expect(parseCommand(s.insert)).toMatchObject({ type: "crt" });
  });
});

describe("sound 指令（X4）", () => {
  it("sound on|off → { type: sound, pref }（不分大小寫、容忍空白）", () => {
    expect(parseCommand("sound on")).toEqual({ type: "sound", pref: "on" });
    expect(parseCommand("sound off")).toEqual({ type: "sound", pref: "off" });
    expect(parseCommand("  SOUND   OFF ")).toEqual({ type: "sound", pref: "off" });
  });
  it("sound 不帶參數＝查詢目前狀態（不是錯誤）", () => expect(parseCommand("sound")).toEqual({ type: "sound", pref: null }));
  it("無效參數、多個參數 → error，訊息列出可用值", () => {
    for (const bad of ["sound loud", "sound on off", "sound 1", "sound mute"]) {
      const r = parseCommand(bad);
      expect(r.type, bad).toBe("error");
      if (r.type === "error") expect(r.message).toMatch(/on.*off/);
    }
  });
  it("在指令表（help 會列出）", () => {
    const def = COMMANDS.find((c) => c.name === "sound")!;
    expect(def.usage).toBe("sound on|off");
    expect(def.description.length).toBeGreaterThan(0);
  });
  it("Tab 補全：so 補成 'sound '；'sound ' 列出兩個選項；前綴過濾；無效回用法", () => {
    const names = (t: string) => suggest(t).map((s) => s.command);
    expect(names("so")).toEqual(["sound on|off"]);
    expect(suggest("so")[0]!.insert).toBe("sound ");
    expect(names("sound ")).toEqual(["sound on", "sound off"]);
    expect(names("sound o")).toEqual(["sound on", "sound off"]);
    expect(names("sound of")).toEqual(["sound off"]);
    expect(suggest("sound of")[0]!.insert).toBe("sound off");
    expect(names("sound zzz")).toEqual(["sound on|off"]);
  });
  it("補全出來的 insert 都能被 parseCommand 接受", () => {
    for (const s of suggest("sound ")) expect(parseCommand(s.insert)).toMatchObject({ type: "sound" });
  });
});
