/*
 * OS 外殼的載入入口（docs/os-mode-spec.md §3.2）：整個 features/os 只在這裡以動態 import() 引用，
 * 網頁模式的程式進入點因此不會靜態 import three／fiber／features/os（A5、P4）。
 * ModeShell 的 React.lazy 與側欄按鈕的預先載入共用同一個 import()，打包後是同一個 chunk。
 */
export const loadOsShell = () => import("@/features/os/OsShell");

/** 預先載入 OS 外殼的 chunk（側欄按鈕 pointerenter／focus 時呼叫）；失敗時安靜忽略，真正切換時 React.lazy 會再試一次。 */
export function preloadOsShell(): void {
  void loadOsShell().catch(() => {});
}

/** 側欄「OS 模式」按鈕導覽時帶的 location state：到了 /os 才真的切換模式（見 ModeShell 的 OsRouteElement）。 */
export const ENTER_OS_STATE = { enterOs: true } as const;
