import { afterEach, describe, expect, it, vi } from "vitest";
import { acknowledgeAll, acknowledgeForChannel, acknowledgeRecord, getActiveAlerts, raiseAlerts, recIdFromPath, resetAlertsForTest, setAlertToneHook, topSeverity } from "./alerts";

const r = (id: number, severity: "輕微" | "一般" | "嚴重" | "重大" = "一般", equipment = `M${id}`) => ({ id, equipment, severity });

afterEach(resetAlertsForTest);

describe("未確認警示 store", () => {
  it("加入、依 id 去重；可同時多個；外圈用最嚴重的", () => {
    raiseAlerts([r(1, "輕微"), r(2, "嚴重")]);
    raiseAlerts([r(2, "嚴重"), r(3, "一般")]);
    expect(getActiveAlerts().map((a) => a.id)).toEqual([1, 2, 3]);
    expect(topSeverity(getActiveAlerts())).toBe("嚴重");
    expect(topSeverity([])).toBeNull();
  });
  it("進入 CH-01／CH-02 確認全部；其他頻道不確認", () => {
    raiseAlerts([r(1), r(2)]);
    for (const ch of ["CH-03", "CH-04", "CH-05", "CH-06", "CH-07", null] as const) acknowledgeForChannel(ch);
    expect(getActiveAlerts()).toHaveLength(2);
    acknowledgeForChannel("CH-01");
    expect(getActiveAlerts()).toHaveLength(0);
    raiseAlerts([r(3)]);
    acknowledgeForChannel("CH-02");
    expect(getActiveAlerts()).toHaveLength(0);
  });
  it("rec <id> 只確認那一筆；已確認的 id 不會再被加入", () => {
    raiseAlerts([r(1), r(2)]);
    acknowledgeRecord(1);
    expect(getActiveAlerts().map((a) => a.id)).toEqual([2]);
    raiseAlerts([r(1)]);
    expect(getActiveAlerts().map((a) => a.id)).toEqual([2]);
    acknowledgeAll();
    raiseAlerts([r(2)]);
    expect(getActiveAlerts()).toEqual([]);
  });
  it("參照穩定：沒有變動時 getActiveAlerts 回傳同一個陣列", () => {
    raiseAlerts([r(1)]);
    const a = getActiveAlerts();
    raiseAlerts([r(1)]);
    acknowledgeRecord(99);
    expect(getActiveAlerts()).toBe(a);
  });
  it("recIdFromPath：只認 /records?open=<id>", () => {
    expect(recIdFromPath("/records?open=63")).toBe(63);
    expect(recIdFromPath("/records")).toBeNull();
    expect(recIdFromPath("/records?open=0")).toBeNull();
    expect(recIdFromPath("/report")).toBeNull();
  });
  it("X4 掛鉤：只在真的新增時呼叫", () => {
    const hook = vi.fn();
    setAlertToneHook(hook);
    raiseAlerts([r(1)]);
    raiseAlerts([r(1)]);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0]![0]).toEqual([{ id: 1, machine: "M1", severity: "一般" }]);
  });
});
