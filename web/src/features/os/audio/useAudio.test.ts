import { describe, expect, it, vi } from "vitest";
import { createAlertTone, isDirectCut, TRANSITION_CUES } from "./useAudioEvents";
import { installGestureActivation, soundButtonState } from "./useAudio";
import { ENTER, EXIT } from "../transition/timing";
import type { AudioEngine } from "./engine";

describe("soundButtonState", () => {
  it("四種標籤與中文 accessible name", () => {
    expect(soundButtonState("on", "running")).toMatchObject({ label: "SND ON", pressed: true, disabled: false, name: "音效：開啟，按下切換為靜音" });
    expect(soundButtonState("off", "running")).toMatchObject({ label: "SND OFF", pressed: false, name: "音效：已靜音，按下開啟" });
    expect(soundButtonState("off", "idle").label).toBe("SND OFF");
    for (const st of ["idle", "pending"] as const) expect(soundButtonState("on", st)).toMatchObject({ label: "SND …", pressed: true });
    expect(soundButtonState("on", "unsupported")).toMatchObject({ label: "SND N/A", disabled: true, pressed: false });
    expect(soundButtonState("off", "unsupported").label).toBe("SND N/A");
  });
});

describe("installGestureActivation", () => {
  it("keydown／pointerdown 啟用；只按修飾鍵不算；不吞事件", () => {
    const activate = vi.fn();
    const off = installGestureActivation(window, () => ({ activate }) as unknown as AudioEngine);
    for (const k of ["Shift", "Control", "Alt", "Meta"]) window.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
    expect(activate).not.toHaveBeenCalled();
    const ev = new KeyboardEvent("keydown", { key: "a", cancelable: true });
    window.dispatchEvent(ev);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(false);
    window.dispatchEvent(new MouseEvent("pointerdown"));
    expect(activate).toHaveBeenCalledTimes(2);
    off();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(activate).toHaveBeenCalledTimes(2);
  });
});

describe("警示音限流與轉場排程", () => {
  it("2 秒內最多一次", () => {
    let t = 0;
    const play = vi.fn();
    const tone = createAlertTone(play, () => t);
    tone();
    t = 1999;
    tone();
    expect(play).toHaveBeenCalledTimes(1);
    t = 2000;
    tone();
    expect(play).toHaveBeenCalledTimes(2);
  });
  it("轉場音效起點取自時間 token", () => {
    expect(TRANSITION_CUES.enter.map((c) => c.atMs)).toEqual([0, ENTER.E2[0], ENTER.E3[0]]);
    expect(TRANSITION_CUES.exit.map((c) => c.atMs)).toEqual([0, EXIT.X4[0]]);
    expect(TRANSITION_CUES.switch.map((c) => c.atMs)).toEqual([0]);
  });
  it("isDirectCut：HUB↔STATION、STATION 換頻道；轉場狀態與開機不算", () => {
    const hub = { kind: "HUB", gen: 0 } as const;
    const st = (ch: "CH-02" | "CH-03") => ({ kind: "STATION", ch, gen: 0 }) as const;
    expect(isDirectCut(hub, st("CH-02"))).toBe(true);
    expect(isDirectCut(st("CH-02"), hub)).toBe(true);
    expect(isDirectCut(st("CH-02"), st("CH-03"))).toBe(true);
    expect(isDirectCut(st("CH-02"), st("CH-02"))).toBe(false);
    expect(isDirectCut({ kind: "ENTERING", ch: "CH-02", handoff: false, gen: 1 }, st("CH-02"))).toBe(false);
    expect(isDirectCut({ kind: "BOOT", dest: { kind: "hub" }, gen: 0 }, hub)).toBe(false);
  });
});
