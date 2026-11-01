/*
 * WebGL 後備（docs/os-mode-spec.md §7）：支援偵測，以及「這次載入保持 Cyber 外觀」的旗標。
 */

export const WEBGL_FALLBACK_TEXT = "顯示卡不支援，已改用網頁模式";

/** 偵測 WebGL 是否可用。建立的暫時 context 會立刻釋放（瀏覽器對同時存在的 context 數量有限制）。 */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | WebGL2RenderingContext | null;
    if (!gl) return false;
    try {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      /* 釋放失敗不影響偵測結果 */
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * WebGL 失敗後改用網頁模式時，只在「這次載入」套用 Cyber 外觀（不寫入 pld.theme）：
 * OsShell 卸載時若旗標為 true，就維持 cyber，而不是依偏好還原。
 * 模組層級的旗標：OsShell 的卸載與 setMode("web") 是同一個流程，旗標必須比元件活得久。
 * OsShell 每次掛載都會重設。
 */
let keepCyberOnExit = false;
export const setKeepCyberOnExit = (v: boolean): void => {
  keepCyberOnExit = v;
};
export const shouldKeepCyberOnExit = (): boolean => keepCyberOnExit;
