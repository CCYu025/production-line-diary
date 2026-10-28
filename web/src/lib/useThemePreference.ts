import * as React from "react";
import { getAppliedTheme, subscribeTheme, type ThemePreference } from "./theme";

/** 目前生效的介面主題；切換後所有使用者即時更新。 */
export function useThemePreference(): ThemePreference {
  return React.useSyncExternalStore(subscribeTheme, getAppliedTheme, () => "standard");
}
