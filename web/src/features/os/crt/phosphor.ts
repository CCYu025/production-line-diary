/*
 * 磷光殘影（docs/os-mode-spec.md §4.2，X3）：純函式與自動降級邏輯，沒有 three／DOM 依賴，方便單元測試。
 *  - keepFor：CRT 強度 → 每 16.67ms 幀殘留的比例（關＝0＝不做、標準 0.85、濃 0.88）。
 *  - decayFactor：依實際 dt 換算 keep^(dt/16.67ms)，與 fps 無關；dt 夾在 [1, 100]ms。
 *  - needsReset：暫停（分頁隱藏、迴圈停住）後的第一幀不可拖影，管線在這種幀把殘留歸零。
 *  - PhosphorGovernor：HUB 中連續 3 秒 fps 中位數 < 50 就建議降級（P1 降級順序第一步）；旗標只存在記憶體，不持久化。
 */
import type { CrtLevel } from "./settings";

/** 一幀（60Hz）的毫秒數；keep 是以這個長度為單位的殘留比例。 */
export const FRAME_MS = 1000 / 60;
export const PHOSPHOR_KEEP: Record<CrtLevel, number> = { off: 0, std: 0.85, max: 0.88 };
/**
 * 鏡頭推拉期間（進入 E1、離開 X4）的殘留比例：鏡頭在動時，標準 0.85 會在大字（TODAY／CH-02）後面拖出 8–10 份殘影（X3 驗證 r1），
 * 所以推拉期間改用較快衰減的 keep（約 3–4 幀就看不到）；控制室靜止（含巡視、輕微晃動）仍用 PHOSPHOR_KEEP。
 */
export const PHOSPHOR_KEEP_MOVING: Record<CrtLevel, number> = { off: 0, std: 0.55, max: 0.6 };
export const DT_MIN_MS = 1;
export const DT_MAX_MS = 100;
/** dt 超過這個值＝中間停過（分頁隱藏、迴圈暫停）：第一幀不拖影。 */
export const RESET_GAP_MS = 250;

export function keepFor(level: CrtLevel): number {
  return PHOSPHOR_KEEP[level];
}

/** 鏡頭推拉中（moving）用較快衰減的 keep；其餘同 keepFor。 */
export function keepForMotion(level: CrtLevel, moving: boolean): number {
  return moving ? PHOSPHOR_KEEP_MOVING[level] : PHOSPHOR_KEEP[level];
}

/** 本幀留下的比例：keep^(dt/16.67ms)。keep <= 0（關）回傳 0；dt 不合法視為一幀。 */
export function decayFactor(keep: number, dtMs: number): number {
  if (!(keep > 0)) return 0;
  const dt = Number.isFinite(dtMs) ? Math.min(DT_MAX_MS, Math.max(DT_MIN_MS, dtMs)) : FRAME_MS;
  return Math.pow(Math.min(keep, 0.999), dt / FRAME_MS);
}

/** 第一幀（沒有上一幀的時間）或停過很久：殘留要歸零。 */
export function needsReset(dtMs: number | undefined): boolean {
  return dtMs === undefined || !Number.isFinite(dtMs) || dtMs > RESET_GAP_MS || dtMs < 0;
}

/* ---------- 自動降級 ---------- */

export const DEGRADE_WINDOW_MS = 3000;
export const DEGRADE_FPS = 50;

/**
 * 滾動視窗中位數 fps 的判斷。push 每一幀的 dt；視窗累積 >= 3 秒才下判斷，之後以滑動視窗持續評估。
 * 單次尖峰不影響（中位數）；reset()（可見性、狀態變化、暫停）清空視窗重新累積；dt > RESET_GAP_MS 的幀視為暫停，自動 reset。
 */
export class PhosphorGovernor {
  private dts: number[] = [];
  private total = 0;
  private head = 0;

  constructor(
    private readonly windowMs = DEGRADE_WINDOW_MS,
    private readonly minFps = DEGRADE_FPS,
  ) {}

  reset(): void {
    this.dts = [];
    this.total = 0;
    this.head = 0;
  }

  push(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    if (dtMs > RESET_GAP_MS) {
      this.reset();
      return;
    }
    this.dts.push(dtMs);
    this.total += dtMs;
    // 丟掉最舊的幀，只要剩下的仍涵蓋整個視窗
    while (this.head < this.dts.length - 1 && this.total - this.dts[this.head]! >= this.windowMs) {
      this.total -= this.dts[this.head]!;
      this.head++;
    }
    if (this.head > 512) {
      this.dts = this.dts.slice(this.head);
      this.head = 0;
    }
  }

  /** 視窗是否已累積 >= 3 秒。 */
  get ready(): boolean {
    return this.total >= this.windowMs;
  }

  /** 視窗內的中位數 fps；沒有資料回傳 null。 */
  medianFps(): number | null {
    const n = this.dts.length - this.head;
    if (n <= 0) return null;
    const sorted = this.dts.slice(this.head).sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const med = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    return 1000 / med;
  }

  shouldDegrade(): boolean {
    if (!this.ready) return false;
    const fps = this.medianFps();
    return fps !== null && fps < this.minFps;
  }
}

/* ---------- 本分頁的降級旗標（只在記憶體，不持久化） ---------- */

let degraded = false;

export function isPhosphorDegraded(): boolean {
  return degraded;
}

/** 標記本分頁關閉殘影；第一次標記時 console.info 一行。回傳是否為新標記。 */
export function markPhosphorDegraded(fps?: number): boolean {
  if (degraded) return false;
  degraded = true;
  const shown = fps !== undefined && Number.isFinite(fps) ? ` (median ${fps.toFixed(1)} fps over 3s)` : "";
  console.info(`[PLD/OS] phosphor persistence off for this tab${shown}`);
  return true;
}

export function resetPhosphorDegradedForTest(): void {
  degraded = false;
}

/** 管線是否做磷光回饋：強度不是「關」、沒有減少動態效果、本分頁沒被降級。 */
export function phosphorEnabled(level: CrtLevel, reduced: boolean): boolean {
  return !reduced && !degraded && keepFor(level) > 0;
}
