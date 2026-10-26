import { toast, type ExternalToast } from "sonner";
import { errorMessage } from "./api";

/**
 * 全域回饋（docs/refactor-plan.md §4 U10）：成功＝綠色勾、短暫停留；錯誤＝紅色、停留較久。
 * 頁面一律透過這裡發 toast，不要直接 import sonner。
 */
export const SUCCESS_DURATION = 3500;
export const ERROR_DURATION = 9000;
export const UNDO_DURATION = 7000;

export const notify = {
  success(message: string, opts?: ExternalToast) {
    return toast.success(message, { duration: SUCCESS_DURATION, ...opts });
  },
  /** 傳 Error（含 ApiError）會取它的訊息，伺服器回的 errors[] 會用「、」接起來。 */
  error(messageOrError: unknown, opts?: ExternalToast) {
    const message = typeof messageOrError === "string" ? messageOrError : errorMessage(messageOrError, "操作失敗");
    return toast.error(message, { duration: ERROR_DURATION, ...opts });
  },
  info(message: string, opts?: ExternalToast) {
    return toast.info(message, { duration: SUCCESS_DURATION, ...opts });
  },
  /** 進行中（匯出、上傳…）。回傳 id，完成後用同一個 id 呼叫 success / error 就會原地換成結果。 */
  loading(message: string, opts?: ExternalToast) {
    return toast.loading(message, opts);
  },
  dismiss(id?: string | number) {
    toast.dismiss(id);
  },
};

interface UndoableOptions {
  /** 例如「已移到回收桶」 */
  message: string;
  /** 按鈕文字，預設「復原」 */
  undoLabel?: string;
  /** 按下復原要做的事；丟錯會跳錯誤 toast，成功會跳「已復原」 */
  onUndo: () => Promise<unknown> | unknown;
  /** 復原成功後的提示，預設「已復原」 */
  undoneMessage?: string;
  duration?: number;
}

/**
 * 「可撤銷操作」toast：動作已經執行，toast 上附一顆〔復原〕按鈕（刪除直接移到回收桶不再問「確定嗎」，
 * 但留一段時間讓使用者反悔）。
 */
export function toastUndoable({
  message,
  undoLabel = "復原",
  onUndo,
  undoneMessage = "已復原",
  duration = UNDO_DURATION,
}: UndoableOptions) {
  return toast.success(message, {
    duration,
    action: {
      label: undoLabel,
      onClick: () => {
        void (async () => {
          try {
            await onUndo();
            notify.success(undoneMessage);
          } catch (err) {
            notify.error(err);
          }
        })();
      },
    },
  });
}
