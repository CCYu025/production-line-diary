import { describe, expect, it, vi } from "vitest";
import { ApiError, CSRF_HEADER, CSRF_VALUE, createApi, errorMessage, isAbortError, photoUrl } from "./api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setup(respond: () => Response | Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(async () => respond());
  return { api: createApi({ fetch: fetchMock }), fetchMock };
}

function lastInit(fetchMock: ReturnType<typeof setup>["fetchMock"]) {
  const init = fetchMock.mock.calls.at(-1)?.[1];
  if (!init) throw new Error("fetch 沒被呼叫");
  return { init, headers: (init.headers ?? {}) as Record<string, string> };
}

describe("api: X-Requested-With header", () => {
  it("GET 不帶 header", async () => {
    const { api, fetchMock } = setup(() => jsonResponse({ records: [] }));
    await api.listRecords();
    expect(lastInit(fetchMock).headers[CSRF_HEADER]).toBeUndefined();
  });

  it.each([
    ["createRecord", (a: ReturnType<typeof createApi>) => a.createRecord({ date: "2026-10-26", time: "08:00", duration: 5, equipment: "F3", problem: "x" }), "POST"],
    ["updateRecord", (a: ReturnType<typeof createApi>) => a.updateRecord(1, { date: "2026-10-26", time: "08:00", duration: 5, equipment: "F3", problem: "x" }), "PUT"],
    ["softDeleteRecord", (a: ReturnType<typeof createApi>) => a.softDeleteRecord(1), "POST"],
    ["restoreRecord", (a: ReturnType<typeof createApi>) => a.restoreRecord(1), "POST"],
    ["purgeRecord", (a: ReturnType<typeof createApi>) => a.purgeRecord(1), "DELETE"],
    ["uploadPhoto", (a: ReturnType<typeof createApi>) => a.uploadPhoto("2026-10-26", new Blob(["x"], { type: "image/png" })), "POST"],
    ["deletePhoto", (a: ReturnType<typeof createApi>) => a.deletePhoto("2026-10-26", "a.jpg"), "DELETE"],
    ["saveEquipmentMap", (a: ReturnType<typeof createApi>) => a.saveEquipmentMap([]), "PUT"],
    ["exportXlsx", (a: ReturnType<typeof createApi>) => a.exportXlsx(), "POST"],
  ])("%s（%s）一律帶 X-Requested-With: production-line-diary", async (_name, call, method) => {
    const { api, fetchMock } = setup(() => jsonResponse({ record: {}, filename: "a.jpg", deleted: true, equipmentMap: [], path: "p" }));
    await call(api);
    const { init, headers } = lastInit(fetchMock);
    expect(init.method).toBe(method);
    expect(headers[CSRF_HEADER]).toBe(CSRF_VALUE);
  });

  it("JSON body 設 Content-Type；FormData 不手動設（讓瀏覽器帶 boundary）", async () => {
    const { api, fetchMock } = setup(() => jsonResponse({ record: {} }));
    await api.createRecord({ date: "2026-10-26", time: "08:00", duration: 5, equipment: "F3", problem: "x" });
    expect(lastInit(fetchMock).headers["Content-Type"]).toBe("application/json");

    const upload = setup(() => jsonResponse({ filename: "a.jpg" }));
    await upload.api.uploadPhoto("2026-10-26", new Blob(["x"]));
    const { init, headers } = lastInit(upload.fetchMock);
    expect(headers["Content-Type"]).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    // multer 要先拿到 date 才能決定資料夾，date 必須排在檔案前面
    expect([...(init.body as FormData).keys()]).toEqual(["date", "photo"]);
  });
});

describe("api: 請求網址", () => {
  it("路徑編碼：照片檔名與日期", async () => {
    const { api, fetchMock } = setup(() => jsonResponse({ deleted: true }));
    await api.deletePhoto("2026-10-26", "現場 照片#1.jpg");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/photos/2026-10-26/%E7%8F%BE%E5%A0%B4%20%E7%85%A7%E7%89%87%231.jpg");
  });

  it("aggregate 帶 range", async () => {
    const { api, fetchMock } = setup(() => jsonResponse({}));
    await api.getAggregate("week");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/aggregate?range=week");
  });

  it("photoUrl：資料夾名是 date 去掉 -", () => {
    expect(photoUrl("2026-09-21", "a b.jpg")).toBe("/photos/20260921/a%20b.jpg");
  });
});

describe("api: 回應與錯誤處理", () => {
  it("成功時解開 envelope：listRecords 回陣列、createRecord 回 record", async () => {
    const rec = { id: 7 };
    const list = setup(() => jsonResponse({ records: [rec] }));
    expect(await list.api.listRecords()).toEqual([rec]);
    const create = setup(() => jsonResponse({ record: rec }, 201));
    expect(await create.api.createRecord({ date: "2026-10-26", time: "08:00", duration: 5, equipment: "F3", problem: "x" })).toEqual(rec);
  });

  it("204（永久刪除）回傳 undefined", async () => {
    const { api } = setup(() => new Response(null, { status: 204 }));
    await expect(api.purgeRecord(3)).resolves.toBeUndefined();
  });

  it("伺服器的 errors[] 原樣保留在 ApiError.errors，message 用「、」接起來", async () => {
    const { api } = setup(() => jsonResponse({ errors: ["date 格式須為 YYYY-MM-DD", "duration 須為正數"] }, 400));
    const err = await api.createRecord({ date: "x", time: "08:00", duration: 0, equipment: "F3", problem: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(400);
    expect(apiErr.kind).toBe("http");
    expect(apiErr.errors).toEqual(["date 格式須為 YYYY-MM-DD", "duration 須為正數"]);
    expect(apiErr.message).toBe("date 格式須為 YYYY-MM-DD、duration 須為正數");
  });

  it("沒有 errors 欄位或不是 JSON（例如 HTML 錯誤頁）：依狀態碼給預設訊息", async () => {
    const html = setup(() => new Response("<html>oops</html>", { status: 500 }));
    const e1 = (await html.api.listRecords().catch((e: unknown) => e)) as ApiError;
    expect(e1.status).toBe(500);
    expect(e1.errors).toEqual(["伺服器發生錯誤（500）"]);

    const forbidden = setup(() => jsonResponse({}, 403));
    const e2 = (await forbidden.api.exportXlsx().catch((e: unknown) => e)) as ApiError;
    expect(e2.errors).toEqual(["伺服器拒絕了這個請求（403）"]);
  });

  it("errors 裡混入非字串或空字串會被濾掉", async () => {
    const { api } = setup(() => jsonResponse({ errors: ["a", "", 3, null, "b"] }, 400));
    const err = (await api.listRecords().catch((e: unknown) => e)) as ApiError;
    expect(err.errors).toEqual(["a", "b"]);
  });

  it("網路中斷 → ApiError(kind=network, status=0)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = (await createApi({ fetch: fetchMock }).getMeta().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe("network");
    expect(err.status).toBe(0);
  });

  it("使用者取消（AbortError）原樣丟出，不包成 ApiError", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    const err = await createApi({ fetch: fetchMock }).uploadPhoto("2026-10-26", new Blob(["x"])).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ApiError);
    expect(isAbortError(err)).toBe(true);
  });

  it("成功但回應不是合法 JSON → kind=parse", async () => {
    const { api } = setup(() => new Response("not json", { status: 200 }));
    const err = (await api.getMeta().catch((e: unknown) => e)) as ApiError;
    expect(err.kind).toBe("parse");
  });

  it("errorMessage：Error 取 message，其他用預設值", () => {
    expect(errorMessage(new Error("壞了"))).toBe("壞了");
    expect(errorMessage("字串")).toBe("發生未知錯誤");
    expect(errorMessage(null, "預設")).toBe("預設");
  });
});
