import type { Aggregate, DiaryRecord, EquipmentMapEntry, Meta, RangeKey, RecordInput } from "./types";

/**
 * 伺服器所有非 GET 的 /api 請求都要帶這個 header（本機 CSRF 防護：自訂 header 會觸發
 * CORS preflight，跨站網頁送不出來）。見 docs/refactor-plan.md WP1b S1。
 */
export const CSRF_HEADER = "X-Requested-With";
export const CSRF_VALUE = "production-line-diary";

export type ApiErrorKind = "http" | "network" | "parse";

/**
 * API 呼叫失敗的統一錯誤型別。
 * - `errors`：伺服器回傳的 `{ errors: string[] }`（逐項訊息，可顯示在欄位旁）；
 *   沒有的話放一則依狀況產生的訊息，保證至少有一項。
 * - `message`：`errors` 用「、」接起來，可直接給 toast。
 * - `status`：HTTP 狀態碼；網路中斷為 0。
 */
export class ApiError extends Error {
  readonly status: number;
  readonly errors: string[];
  readonly kind: ApiErrorKind;

  constructor(opts: { status: number; errors: string[]; kind: ApiErrorKind }) {
    super(opts.errors.join("、"));
    this.name = "ApiError";
    this.status = opts.status;
    this.errors = opts.errors;
    this.kind = opts.kind;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/** 使用者主動取消（AbortController）——不是錯誤，呼叫端不該跳錯誤 toast。 */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** 任何錯誤 → 給人看的訊息。 */
export function errorMessage(err: unknown, fallback = "發生未知錯誤"): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function statusFallback(status: number): string {
  if (status === 403) return "伺服器拒絕了這個請求（403）";
  if (status === 404) return "找不到資料（404）";
  if (status === 409) return "目前狀態不允許這個操作（409）";
  if (status >= 500) return `伺服器發生錯誤（${status}）`;
  return `請求失敗（${status}）`;
}

type FetchLike = typeof fetch;

interface RequestOptions {
  method?: string;
  /** 會以 JSON 送出 */
  json?: unknown;
  form?: FormData;
  signal?: AbortSignal | undefined;
}

export interface ApiOptions {
  /** 測試用：換掉 fetch */
  fetch?: FetchLike;
  /** API 位址前綴，預設同源 */
  baseUrl?: string;
}

export function createApi(options: ApiOptions = {}) {
  const baseUrl = options.baseUrl ?? "";

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = (opts.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    if (method !== "GET" && method !== "HEAD") headers[CSRF_HEADER] = CSRF_VALUE;

    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      body = opts.form; // 瀏覽器自己帶 multipart boundary，不可手動設 Content-Type
    }

    // 在呼叫時才取 fetch，測試才能用 vi.stubGlobal 替換。
    const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

    let res: Response;
    try {
      res = await doFetch(baseUrl + path, { method, headers, body, signal: opts.signal ?? null });
    } catch (err) {
      if (isAbortError(err)) throw err;
      throw new ApiError({ status: 0, errors: ["無法連線到伺服器，請確認 App 還在執行"], kind: "network" });
    }

    if (!res.ok) {
      let errors: string[] = [];
      try {
        const data: unknown = await res.json();
        if (data && typeof data === "object" && "errors" in data && Array.isArray(data.errors)) {
          errors = data.errors.filter((e): e is string => typeof e === "string" && e !== "");
        }
      } catch {
        /* 非 JSON 的錯誤頁（例如 HTML 404）——用下面的預設訊息 */
      }
      if (errors.length === 0) errors = [statusFallback(res.status)];
      throw new ApiError({ status: res.status, errors, kind: "http" });
    }

    if (res.status === 204) return undefined as T;
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError({ status: res.status, errors: ["伺服器回應的格式不正確"], kind: "parse" });
    }
  }

  const recordPath = (id: number) => `/api/records/${encodeURIComponent(String(id))}`;

  return {
    getMeta: (signal?: AbortSignal) => request<Meta>("/api/meta", { signal }),

    /** 全部紀錄（含已軟刪除的；用 `deleted` 區分，回收桶就是 deleted === true 的那些）。 */
    listRecords: async (signal?: AbortSignal) =>
      (await request<{ records: DiaryRecord[] }>("/api/records", { signal })).records,

    createRecord: async (input: RecordInput) =>
      (await request<{ record: DiaryRecord }>("/api/records", { method: "POST", json: input })).record,

    /** PUT 只寫入 body 有帶的欄位（快速切換狀態／補根本原因只送 { status } 或 { rootCause }），所以是 Partial。 */
    updateRecord: async (id: number, input: Partial<RecordInput>) =>
      (await request<{ record: DiaryRecord }>(recordPath(id), { method: "PUT", json: input })).record,

    /** 移到回收桶（軟刪除，照片保留）。 */
    softDeleteRecord: async (id: number) =>
      (await request<{ record: DiaryRecord }>(`${recordPath(id)}/delete`, { method: "POST" })).record,

    restoreRecord: async (id: number) =>
      (await request<{ record: DiaryRecord }>(`${recordPath(id)}/restore`, { method: "POST" })).record,

    /** 永久刪除（只有回收桶裡的紀錄可以；沒有其他紀錄參照的照片會一併刪除）。 */
    purgeRecord: (id: number) => request<void>(recordPath(id), { method: "DELETE" }),

    /** 選檔當下立刻上傳（不是送出表單時）。回傳伺服器實際使用的檔名（同名會被加 -1、-2）。 */
    uploadPhoto: async (date: string, file: File | Blob, signal?: AbortSignal) => {
      const form = new FormData();
      form.append("date", date); // multer 要先看到 date 才知道存哪個資料夾，欄位順序不可對調
      form.append("photo", file);
      return (await request<{ filename: string }>("/api/photos", { method: "POST", form, signal })).filename;
    },

    /** 清掉還沒被任何紀錄參照的照片（放棄新增／編輯、移除剛上傳的照片時用）。 */
    deletePhoto: (date: string, filename: string) =>
      request<{ deleted: boolean }>(`/api/photos/${encodeURIComponent(date)}/${encodeURIComponent(filename)}`, {
        method: "DELETE",
      }),

    saveEquipmentMap: async (list: EquipmentMapEntry[]) =>
      (await request<{ equipmentMap: EquipmentMapEntry[] }>("/api/equipment-map", { method: "PUT", json: list }))
        .equipmentMap,

    getAggregate: (range: RangeKey = "all", signal?: AbortSignal) =>
      request<Aggregate>(`/api/aggregate?range=${encodeURIComponent(range)}`, { signal }),

    /** 產生 工作日誌.xlsx（匯出快照，存在資料夾裡）。 */
    exportXlsx: () => request<{ path: string }>("/api/export-xlsx", { method: "POST" }),
  };
}

export type Api = ReturnType<typeof createApi>;

export const api: Api = createApi();

/** 照片的網址（資料夾名 = date 去掉 "-"）。 */
export function photoUrl(date: string, filename: string): string {
  return `/photos/${date.replaceAll("-", "")}/${encodeURIComponent(filename)}`;
}
