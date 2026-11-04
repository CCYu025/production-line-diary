/*
 * 指令列的指令解析與自動完成（docs/os-mode-spec.md §4.5）：純函式，不碰 DOM／router。
 * 導覽結果只回傳路徑與標籤，由呼叫端走 router 的 navigate()（這樣 useBlocker 的離開確認照常生效）。
 */
import { getChannel, type ChannelId } from "../channels";
import { CRT_LABEL, CRT_LEVELS, isCrtLevel, type CrtLevel } from "../crt/settings";

export type ParsedCommand =
  | { type: "nav"; path: string; label: string }
  | { type: "exit" }
  | { type: "export" }
  | { type: "help" }
  /** CRT 強度（D7）：level 為 null＝只問目前強度（沒有給參數） */
  | { type: "crt"; level: CrtLevel | null }
  | { type: "empty" }
  | { type: "error"; message: string };

export interface CommandDef {
  /** 輸入的指令名稱 */
  name: string;
  /** 用法（help 與自動完成顯示） */
  usage: string;
  description: string;
  /** 導覽類指令的目的頻道 */
  channel?: ChannelId;
  /** 別名（也算指令名稱；自動完成會補成 name） */
  aliases?: readonly string[];
}

/** 指令表（順序即自動完成與 help 的顯示順序）。 */
export const COMMANDS: readonly CommandDef[] = [
  { name: "dash", usage: "dash", description: "儀表板", channel: "CH-01" },
  { name: "rec", usage: "rec", description: "紀錄", channel: "CH-02" },
  { name: "rec", usage: "rec <id>", description: "開啟某筆紀錄（例如 rec 63）" },
  { name: "new", usage: "new", description: "新增紀錄", channel: "CH-03" },
  { name: "cal", usage: "cal", description: "日曆", channel: "CH-04" },
  { name: "rep", usage: "rep", description: "報表", channel: "CH-05" },
  { name: "trash", usage: "trash", description: "回收桶", channel: "CH-06" },
  { name: "set", usage: "set", description: "設定", channel: "CH-07" },
  { name: "crt", usage: "crt off|std|max", description: "CRT 強度：關／標準／濃（例如 crt max）" },
  { name: "export", usage: "export", description: "匯出 Excel（與側欄的「匯出 Excel」相同）", aliases: ["匯出"] },
  { name: "exit", usage: "exit", description: "離開 OS 模式，回到網頁模式" },
  { name: "help", usage: "help", description: "列出所有指令" },
];

export interface Suggestion {
  /** 顯示用的指令（例如 "rec <id>"） */
  command: string;
  description: string;
  /** Tab 或選取時填入輸入框的文字（例如 "rec "） */
  insert: string;
}

const HELP_HINT = "輸入 help 查看指令";

function navTo(name: string): ParsedCommand {
  const def = COMMANDS.find((c) => c.name === name && c.channel)!;
  const ch = getChannel(def.channel!);
  return { type: "nav", path: ch.path, label: `${ch.id} ${ch.name}` };
}

/** 正整數 id（只接受純數字、> 0、安全整數）；前導 0 會被正規化（"007" → 7）。 */
export function parseRecordId(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function parseCommand(text: string): ParsedCommand {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { type: "empty" };
  const name = parts[0]!.toLowerCase();
  const args = parts.slice(1);

  if (name === "rec") {
    if (args.length === 0) return navTo("rec");
    if (args.length > 1) return { type: "error", message: `rec 只接受一個編號（例如 rec 63）` };
    const id = parseRecordId(args[0]!);
    if (id === null) return { type: "error", message: `無效的紀錄編號「${args[0]}」，請輸入正整數（例如 rec 63）` };
    return { type: "nav", path: `/records?open=${id}`, label: `${getChannel("CH-02").id} 紀錄 #${id}` };
  }

  if (name === "crt") {
    if (args.length === 0) return { type: "crt", level: null };
    const arg = args[0]!.toLowerCase();
    if (args.length > 1 || !isCrtLevel(arg)) return { type: "error", message: `crt 只接受 off、std 或 max（例如 crt max）` };
    return { type: "crt", level: arg };
  }

  const def = COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
  if (!def) return { type: "error", message: `未知指令：${parts[0]}（${HELP_HINT}）` };
  if (args.length > 0) return { type: "error", message: `${def.name} 不接受參數（${HELP_HINT}）` };
  if (def.name === "exit") return { type: "exit" };
  if (def.name === "export") return { type: "export" };
  if (def.name === "help") return { type: "help" };
  return navTo(def.name);
}

/**
 * 自動完成：依輸入文字回傳符合的指令（依 COMMANDS 順序）。
 * - 空字串：全部指令。
 * - 指令名稱前綴（不分大小寫）：符合的指令；"rec" 會同時列出 rec 與 rec <id>。
 * - "rec " 後面接文字：若是有效編號，回傳單筆「開啟紀錄 #id」；空的或無效則列出 rec <id> 的用法。
 * - 其他：空陣列。
 */
export function suggest(text: string): Suggestion[] {
  const trimmedStart = text.replace(/^\s+/, "");
  const lower = trimmedStart.toLowerCase();
  const hasSpace = /\s/.test(lower);

  if (!hasSpace) {
    return COMMANDS.filter((c) => c.name.startsWith(lower) || c.aliases?.some((a) => a.startsWith(lower))).map((c) => ({
      command: c.usage,
      description: c.description,
      insert: c.usage === "rec <id>" || c.name === "crt" ? `${c.name} ` : c.usage,
    }));
  }

  const [name, ...rest] = lower.trim().split(/\s+/);
  if (name === "crt") {
    const arg = rest.join(" ");
    const options = CRT_LEVELS.filter((l) => l.startsWith(arg)).map((l) => ({ command: `crt ${l}`, description: `CRT 強度：${CRT_LABEL[l]}`, insert: `crt ${l}` }));
    if (options.length > 0) return options;
    const usage = COMMANDS.find((c) => c.name === "crt")!;
    return [{ command: usage.usage, description: usage.description, insert: "crt " }];
  }
  if (name !== "rec") return [];
  const arg = rest.join(" ");
  const usage = COMMANDS.find((c) => c.usage === "rec <id>")!;
  if (arg === "") return [{ command: usage.usage, description: usage.description, insert: "rec " }];
  const id = rest.length === 1 ? parseRecordId(rest[0]!) : null;
  if (id !== null) return [{ command: `rec ${id}`, description: `開啟紀錄 #${id}`, insert: `rec ${id}` }];
  return [{ command: usage.usage, description: usage.description, insert: "rec " }];
}
