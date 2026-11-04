import * as React from "react";

/**
 * 目前的 devicePixelRatio；縮放或換螢幕（dpr 改變）時更新。
 * 做法：matchMedia(`(resolution: ${dpr}dppx)`) 的 change 事件只在 dpr 離開目前值時觸發，觸發後以新值重新訂閱。
 */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = React.useState(() => window.devicePixelRatio || 1);
  React.useEffect(() => {
    let mql: MediaQueryList | null = null;
    let off = () => {};
    const arm = () => {
      off();
      const now = window.devicePixelRatio || 1;
      setDpr((d) => (d === now ? d : now));
      if (typeof window.matchMedia !== "function") return;
      mql = window.matchMedia(`(resolution: ${now}dppx)`);
      const on = () => arm();
      mql.addEventListener("change", on);
      off = () => mql?.removeEventListener("change", on);
    };
    arm();
    return () => off();
  }, []);
  return dpr;
}
