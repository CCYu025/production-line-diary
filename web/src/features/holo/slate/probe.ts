/*
 * 終端板的探針（H1 驗證用）：記錄 IME／鍵盤事件與送出次數，由 ?holodebug=1 的 window.__holoLab() 回傳。
 * 沒開除錯時不記錄（enabled = false），所以對效能沒有影響。
 */

export interface ProbeEvent {
  t: number;
  type: string;
  key?: string;
  keyCode?: number;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  field?: string;
  value?: string;
  data?: string | null;
}

export interface SlateProbe {
  enabled: boolean;
  submits: number;
  events: ProbeEvent[];
  /** 選字期間（compositionstart → compositionend）累計的次數與凍結旗標 */
  compositions: number;
  composing: boolean;
  /** 進入凍結的幀數累計見 SlateStats.frozenFrames */
  reset(): void;
  push(e: ProbeEvent): void;
}

export const slateProbe: SlateProbe = {
  enabled: false,
  submits: 0,
  events: [],
  compositions: 0,
  composing: false,
  reset() {
    this.submits = 0;
    this.events = [];
    this.compositions = 0;
    this.composing = false;
  },
  push(e) {
    if (!this.enabled) return;
    this.events.push(e);
    if (this.events.length > 400) this.events.shift();
  },
};
