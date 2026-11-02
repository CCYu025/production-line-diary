import * as React from "react";
import type { DiaryRecord } from "@/lib/types";
import { getActiveAlerts, raiseAlerts, subscribeAlerts, type ActiveAlert } from "./alerts";
import { anomalyAnnouncement, computeBlips, newAnomalyTracker, observeAnomalies, type AnomalyTracker, type Blip } from "./radar";

export interface HubAnomalies {
  /** 目前的光點（7 天視窗） */
  blips: Blip[];
  /** 未確認的新異常警示（模組層級 store：離開再進入 HUB 仍在） */
  alerts: readonly ActiveAlert[];
  /** 給 aria-live="polite" 區域的公告（新異常時才有字；沒有新異常是空字串）。不發聲 */
  announcement: string;
}

/**
 * 雷達光點與新異常（見 radar.ts、alerts.ts）。每次進入 HUB（inHub 由 false 變 true）重建偵測基準；
 * 但未確認的警示集合在 alerts.ts，不隨進出 HUB 清除。離開 HUB 清掉公告。
 * 資料用 useHubData 的結果（records／settled），這裡不做任何抓取。
 */
export function useHubAnomalies(inHub: boolean, records: DiaryRecord[] | undefined, settled: boolean, dataUpdatedAt: number): HubAnomalies {
  const blips = React.useMemo(() => computeBlips(records, new Date()), [records, dataUpdatedAt]);
  const alerts = React.useSyncExternalStore(subscribeAlerts, getActiveAlerts, getActiveAlerts);
  const tracker = React.useRef<AnomalyTracker>(newAnomalyTracker());
  const [announcement, setAnnouncement] = React.useState("");

  React.useEffect(() => {
    if (!inHub) {
      setAnnouncement((a) => (a ? "" : a));
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
    raiseAlerts(r.fresh);
    setAnnouncement(anomalyAnnouncement(r.fresh) ?? "");
  }, [inHub, records, settled]);

  return { blips, alerts, announcement };
}
