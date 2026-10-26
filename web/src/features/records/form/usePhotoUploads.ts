import * as React from "react";
import { api, errorMessage, isAbortError } from "@/lib/api";
import { notify } from "@/lib/feedback";

/*
 * 照片「選檔當下立刻上傳」的狀態管理（docs/refactor-plan.md §2、CLAUDE.md 核心不變量）。
 * 這個 hook 把舊版散在 onchange 迴圈、cleanupAbandoned*、syncDateLock 的規則收在一起：
 *
 *  1. 選到檔案就上傳（multipart，date 欄位在 photo 之前），不是送出時才上傳——送出永遠只是拿檔名去建立紀錄。
 *  2. 「放棄」（清除／取消／離開頁面／元件卸載，統一走 `abandonAll()`）：
 *       - 已上傳未送出的檔案：DELETE /api/photos 實體刪除；
 *       - 上傳中的：AbortController 中止請求，而且 entry 標記 abandoned——萬一伺服器的回應還是來了
 *         （或中止太晚、檔案其實已存好），await 收尾時看到旗標就自己補刪，不能假設「清掉陣列」就等於沒有孤兒。
 *  3. 一次選多張：迴圈屬於「這一次的 session」。session 被換掉（放棄／送出成功）或上一張已被放棄
 *     （使用者在上傳途中按了它的移除鈕），就停止處理剩下的檔案，不可把它們推進新的（下一次）表單。
 *  4. 有「上傳中」或「已上傳未送出」的照片就鎖住日期（`hasLive`）：照片依選檔當下的日期存放，之後改日期
 *     會讓紀錄指向別的資料夾而破圖。上傳失敗的不算。
 *
 * 說明：fetch 拿不到上傳進度，所以縮圖只有「上傳中（轉圈）／完成／失敗」三種狀態，沒有百分比。
 */

export type PhotoStatus = "uploading" | "uploaded" | "error";

export interface PhotoItem {
  /** 前端自己的識別碼（不是伺服器檔名） */
  id: string;
  /** 縮圖：本機檔案的 object URL（不用再向伺服器要一次） */
  previewUrl: string;
  /** 上傳時使用的日期（決定存放資料夾） */
  date: string;
  status: PhotoStatus;
  /** 伺服器實際存的檔名（同名會被加 -1、-2）；還沒回來或失敗時為 null */
  filename: string | null;
  caption: string;
  error: string | null;
  fileName: string;
}

interface Entry {
  id: string;
  file: File;
  previewUrl: string;
  date: string;
  filename: string | null;
  status: PhotoStatus;
  error: string | null;
  caption: string;
  abandoned: boolean;
  controller: AbortController;
}

interface Session {
  entries: Entry[];
}

let counter = 0;
const nextId = () => `photo-${++counter}`;

function makePreviewUrl(file: File): string {
  try {
    return typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
  } catch {
    return "";
  }
}

function revoke(url: string) {
  if (!url) return;
  try {
    if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
  } catch {
    /* 無所謂 */
  }
}

function snapshot(e: Entry): PhotoItem {
  return {
    id: e.id,
    previewUrl: e.previewUrl,
    date: e.date,
    status: e.status,
    filename: e.filename,
    caption: e.caption,
    error: e.error,
    fileName: e.file.name,
  };
}

/** 刪掉伺服器上「還沒被任何紀錄參照」的照片。失敗只記 log——伺服器每小時的孤兒掃描是最後一道防線。 */
function deleteQuietly(date: string, filename: string) {
  api.deletePhoto(date, filename).catch((err: unknown) => {
    console.warn("刪除未送出的照片失敗（稍後會由伺服器的孤兒掃描清掉）", filename, errorMessage(err));
  });
}

export interface PhotoUploads {
  items: PhotoItem[];
  /** 有「上傳中」或「已上傳未送出」的照片：日期欄要鎖住 */
  hasLive: boolean;
  /** 有照片還在上傳：不能送出 */
  uploading: boolean;
  /** 選檔：立刻依序上傳。`date` 是當下表單的日期。回傳的 Promise 在這批檔案處理完（或被放棄）後結束。 */
  addFiles: (files: readonly File[], date: string) => Promise<void>;
  /** 使用者按縮圖的移除鈕 */
  remove: (id: string) => void;
  setCaption: (id: string, caption: string) => void;
  /** 放棄全部（清除／取消／離開頁面）：中止上傳中的、刪除已上傳未送出的，並開一個全新的 session */
  abandonAll: () => void;
  /** 送出成功：已上傳的檔案現在被紀錄參照了，只忘掉它們（不刪檔），並開新的 session */
  commit: () => void;
}

export function usePhotoUploads(): PhotoUploads {
  const sessionRef = React.useRef<Session>({ entries: [] });
  const [items, setItems] = React.useState<PhotoItem[]>([]);

  const sync = React.useCallback((session: Session) => {
    // 舊 session 的迴圈還在跑時不要去動畫面（畫面顯示的是新的 session）
    if (sessionRef.current === session) setItems(session.entries.map(snapshot));
  }, []);

  const addFiles = React.useCallback(
    async (files: readonly File[], date: string) => {
      const session = sessionRef.current;
      let prev: Entry | null = null;
      for (const file of files) {
        // 這一批屬於「這一次的表單」：被放棄／送出成功換掉 session，或上一張已被放棄，就不要再往下傳
        if (sessionRef.current !== session || prev?.abandoned) break;
        const entry: Entry = {
          id: nextId(),
          file,
          previewUrl: makePreviewUrl(file),
          date,
          filename: null,
          status: "uploading",
          error: null,
          caption: "",
          abandoned: false,
          controller: new AbortController(),
        };
        prev = entry;
        session.entries.push(entry);
        sync(session);

        try {
          entry.filename = await api.uploadPhoto(date, file, entry.controller.signal);
          entry.status = "uploaded";
        } catch (err) {
          entry.status = "error";
          if (isAbortError(err)) {
            entry.error = "已取消";
          } else {
            entry.error = errorMessage(err, "上傳失敗");
            if (!entry.abandoned) notify.error(`照片上傳失敗：${entry.error}`);
          }
        }

        // 上傳這段 await 期間可能已被放棄（清除／離開頁面／移除這張）：
        // 當時沒有檔名可刪，只標記了 abandoned——回應真的回來了就在這裡補刪。
        if (entry.abandoned) {
          if (entry.filename) deleteQuietly(entry.date, entry.filename);
          revoke(entry.previewUrl);
          continue;
        }
        sync(session);
      }
    },
    [sync],
  );

  const remove = React.useCallback(
    (id: string) => {
      const session = sessionRef.current;
      const idx = session.entries.findIndex((e) => e.id === id);
      if (idx < 0) return;
      const entry = session.entries[idx]!;
      // 上傳還沒回來也要標記：讓 addFiles 的 await 收尾時補刪，並讓它停止處理這批剩下的檔案
      entry.abandoned = true;
      entry.controller.abort();
      session.entries.splice(idx, 1);
      sync(session);
      if (entry.filename) deleteQuietly(entry.date, entry.filename);
      // 還在上傳中的 entry 由 addFiles 收尾時 revoke；其餘現在就釋放
      if (entry.status !== "uploading") revoke(entry.previewUrl);
    },
    [sync],
  );

  const setCaption = React.useCallback(
    (id: string, caption: string) => {
      const session = sessionRef.current;
      const entry = session.entries.find((e) => e.id === id);
      if (!entry) return;
      entry.caption = caption;
      sync(session);
    },
    [sync],
  );

  const abandonAll = React.useCallback(() => {
    const old = sessionRef.current;
    // 先換 session：正在跑的 addFiles 迴圈（捕獲的是舊 session）下一輪就會停
    sessionRef.current = { entries: [] };
    for (const entry of old.entries) {
      entry.abandoned = true;
      entry.controller.abort();
      if (entry.filename) deleteQuietly(entry.date, entry.filename);
      if (entry.status !== "uploading") revoke(entry.previewUrl);
    }
    setItems([]);
  }, []);

  const commit = React.useCallback(() => {
    const old = sessionRef.current;
    sessionRef.current = { entries: [] };
    for (const entry of old.entries) revoke(entry.previewUrl);
    setItems([]);
  }, []);

  // 元件卸載（路由離開）＝放棄。StrictMode 開發時的「假卸載」沒有照片，不會有副作用。
  const abandonRef = React.useRef(abandonAll);
  abandonRef.current = abandonAll;
  React.useEffect(() => () => abandonRef.current(), []);

  const hasLive = items.some((i) => i.status === "uploading" || i.status === "uploaded");
  const uploading = items.some((i) => i.status === "uploading");

  return { items, hasLive, uploading, addFiles, remove, setCaption, abandonAll, commit };
}
