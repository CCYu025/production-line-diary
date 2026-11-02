/*
 * 未確認的新異常警示（X2 雷達）：模組層級的記憶體 store（分頁工作階段內有效，不持久化）。
 * - 新異常（id 大於進入 HUB 時的基準）加入 store；離開再進入 HUB 不清除（基準會重建，但警示集合留著）。
 * - 確認（acknowledge）：進入 CH-01／CH-02，或指令列 `rec <id>`；已確認的 id 之後不會再被加入。
 * - 可同時存在多個警示；外圈用最嚴重的。
 * - 不發聲（X4 才做）：X4 可呼叫 setAlertToneHook 接上警示音。
 */
import type { Severity } from "@/lib/types";
import { SEVERITY_ORDER } from "@shared/aggregate";
import type { ChannelId } from "../channels";

export interface ActiveAlert {
  id: number;
  machine: string;
  severity: Severity;
}

type Hook = (raised: readonly ActiveAlert[]) => void;

let active: ActiveAlert[] = [];
const acked = new Set<number>();
const listeners = new Set<() => void>();
let toneHook: Hook | null = null;

function emit() {
  for (const l of listeners) l();
}

/**
 * X4 掛鉤：每次有「新加入」的警示時呼叫（只在真的新增時，已確認或重複的不會）。
 * X4 在這裡接警示音；目前沒有人設定，所以不發聲。傳 null 解除。
 */
export function setAlertToneHook(fn: Hook | null): void {
  toneHook = fn;
}

export function subscribeAlerts(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** 目前未確認的警示（參照在變動時才改變，可給 useSyncExternalStore）。 */
export function getActiveAlerts(): readonly ActiveAlert[] {
  return active;
}

/** 加入新異常警示（依 id 去重；已確認的 id 不再加入）。回傳實際新增的。 */
export function raiseAlerts(records: readonly { id: number; equipment: string; severity: Severity }[]): ActiveAlert[] {
  const have = new Set(active.map((a) => a.id));
  const added: ActiveAlert[] = [];
  for (const r of records) {
    if (have.has(r.id) || acked.has(r.id)) continue;
    have.add(r.id);
    added.push({ id: r.id, machine: r.equipment, severity: r.severity });
  }
  if (added.length === 0) return added;
  active = [...active, ...added];
  emit();
  toneHook?.(added);
  return added;
}

/** 確認某一筆（`rec <id>`）。沒有這筆警示也會記下，避免之後才加入。 */
export function acknowledgeRecord(id: number): void {
  acked.add(id);
  const next = active.filter((a) => a.id !== id);
  if (next.length !== active.length) {
    active = next;
    emit();
  }
}

/** 確認全部（進入 CH-01／CH-02）。 */
export function acknowledgeAll(): void {
  if (active.length === 0) return;
  for (const a of active) acked.add(a.id);
  active = [];
  emit();
}

/** 進入某工作站頻道時的確認規則：CH-01、CH-02 確認全部。 */
export function acknowledgeForChannel(ch: ChannelId | null): void {
  if (ch === "CH-01" || ch === "CH-02") acknowledgeAll();
}

/** 指令列導覽路徑 `/records?open=<id>`（`rec <id>`）→ id；其他回傳 null。 */
export function recIdFromPath(path: string): number | null {
  const m = /^\/records\?open=(\d+)$/.exec(path);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** 警示中最嚴重的嚴重度；沒有警示＝null。 */
export function topSeverity(alerts: readonly ActiveAlert[]): Severity | null {
  let top: Severity | null = null;
  for (const a of alerts) if (top === null || SEVERITY_ORDER.indexOf(a.severity) > SEVERITY_ORDER.indexOf(top)) top = a.severity;
  return top;
}

export function resetAlertsForTest(): void {
  active = [];
  acked.clear();
  toneHook = null;
  emit();
}
