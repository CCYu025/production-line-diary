/*
 * 全像世界的顏色：一律從 Cyber token 讀（getComputedStyle），不寫死色碼。
 * 世界只在 data-theme="cyber" 下使用（實驗室掛載時 applyTheme("cyber")）。
 */
import { readToken } from "@/features/os/colors";

export interface HoloColors {
  page: string;
  accent: string;
  line: string;
  lineStrong: string;
  ink: string;
  /** 嚴重度四色（輕微、一般、嚴重、重大） */
  severity: [string, string, string, string];
}

export function readHoloColors(): HoloColors {
  return {
    page: readToken("--page"),
    accent: readToken("--accent"),
    line: readToken("--line"),
    lineStrong: readToken("--line-strong"),
    ink: readToken("--ink-1"),
    severity: [readToken("--good"), readToken("--warning"), readToken("--serious"), readToken("--critical")],
  };
}
