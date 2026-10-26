import * as React from "react";
import { notify } from "@/lib/feedback";
import { useExportXlsx } from "@/lib/queries";

/**
 * 「匯出 Excel」動作（側欄與手機「更多」共用）：
 * 進行中顯示 loading toast（按鈕同時 disabled + aria-busy），完成後同一則 toast 原地換成成功／失敗。
 */
// 同一時間只允許一個匯出請求（側欄與手機「更多」是不同的 hook 實例，所以放模組層級；
// 也要擋「同一個 tick 連點多下」——React 的 isPending 要等下次 render 才會更新，擋不住）。
let exportInFlight = false;

export function useExportAction() {
  const mutation = useExportXlsx();
  const { mutateAsync, isPending } = mutation;

  const run = React.useCallback(async () => {
    if (exportInFlight) return;
    exportInFlight = true;
    const id = notify.loading("正在匯出 Excel…");
    try {
      const { path } = await mutateAsync();
      notify.success("已匯出 Excel", { id, description: path });
    } catch (err) {
      notify.error(err, { id });
    } finally {
      exportInFlight = false;
    }
  }, [mutateAsync]);

  return { run, pending: isPending };
}
