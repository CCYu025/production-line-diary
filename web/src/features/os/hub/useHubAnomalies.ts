import * as React from "react";
import type { DiaryRecord } from "@/lib/types";
import { anomalyAnnouncement, computeBlips, newAnomalyTracker, observeAnomalies, pulseMachines, type AnomalyTracker, type Blip } from "./radar";

export interface HubAnomalies {
  /** 目前的光點（7 天視窗） */
  blips: Blip[];
  /** 最近一次新異常要脈衝的機台；pulseId 每次新異常 +1（場景用它偵測「又來一次」）。減少動態效果時場景自行忽略 */
  pulse: { id: number; machines: string[] } | null;
  /** 給 aria-live="polite" 區域的公告（新異常時才有字；沒有新異常是空字串）。不發聲 */
  announcement: string;
}

/**
 * 雷達光點與新異常（見 radar.ts）。每次進入 HUB（inHub 由 false 變 true）重建基準；離開 HUB 清掉脈衝與公告。
 * 資料用 useHubData 的結果（records／settled），這裡不做任何抓取。
 */
export function useHubAnomalies(inHub: boolean, records: DiaryRecord[] | undefined, settled: boolean, dataUpdatedAt: number): HubAnomalies {
  const blips = React.useMemo(() => computeBlips(records, new Date()), [records, dataUpdatedAt]);
  const tracker = React.useRef<AnomalyTracker>(newAnomalyTracker());
  const [state, setState] = React.useState<{ pulse: HubAnomalies["pulse"]; announcement: string }>({ pulse: null, announcement: "" });
  const counter = React.useRef(0);

  React.useEffect(() => {
    if (!inHub) {
      setState((s) => (s.pulse || s.announcement ? { pulse: null, announcement: "" } : s));
      return;
    }
    tracker.current = newAnomalyTracker(); // 每次進入 HUB 重建基準
    return () => {
      tracker.current = newAnomalyTracker();
    };
  }, [inHub]);

  React.useEffect(() => {
    if (!inHub) return;
    const r = observeAnomalies(tracker.current, records, settled);
    tracker.current = r.tracker;
    if (r.fresh.length === 0) return;
    const text = anomalyAnnouncement(r.fresh) ?? "";
    const machines = pulseMachines(r.fresh, computeBlips(records, new Date()));
    counter.current += 1;
    setState({ pulse: { id: counter.current, machines }, announcement: text });
  }, [inHub, records, settled]);

  return { blips, pulse: state.pulse, announcement: state.announcement };
}
