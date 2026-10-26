import * as React from "react";

/** 訂閱 CSS media query（例如 "(min-width: 1024px)"）。 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** 桌面完整側欄（≥ 1024px，對應 Tailwind lg）。 */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");
