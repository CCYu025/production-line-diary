import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { deferred, fileOf } from "./testUtils";
import { usePhotoUploads } from "./usePhotoUploads";

const DATE = "2026-10-26";

/**
 * 每一次 uploadPhoto 都回一個要手動 resolve 的 Promise（模擬慢速網路）。
 * 重點：hook 絕對不可以中止上傳（中止可能讓伺服器已存好的檔案變成孤兒），所以 mock 不接受 signal，
 * 並記下呼叫時有沒有帶第三個參數。
 */
function slowUploads() {
  const calls: Array<{ name: string; date: string; argCount: number; d: ReturnType<typeof deferred<string>> }> = [];
  vi.spyOn(api, "uploadPhoto").mockImplementation((...args: unknown[]) => {
    const [date, file] = args as [string, File];
    const d = deferred<string>();
    calls.push({ name: file.name, date, argCount: args.length, d });
    return d.promise;
  });
  return calls;
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("usePhotoUploads", () => {
  let deletePhoto: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    deletePhoto = vi.spyOn(api, "deletePhoto").mockResolvedValue({ deleted: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("選檔當下立刻上傳：date 與檔案傳給 API，完成後狀態變 uploaded 並鎖日期", async () => {
    const upload = vi.spyOn(api, "uploadPhoto").mockImplementation((_d, f) => Promise.resolve(`srv-${(f as File).name}`));
    const { result } = renderHook(() => usePhotoUploads());
    expect(result.current.hasLive).toBe(false);
    await act(async () => {
      await result.current.addFiles([fileOf("a.jpg")], DATE);
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]?.[0]).toBe(DATE);
    expect(result.current.items).toMatchObject([{ status: "uploaded", filename: "srv-a.jpg", date: DATE }]);
    expect(result.current.hasLive).toBe(true);
  });

  it("上傳失敗的不算「有照片」，不鎖日期，也不會被送出", async () => {
    vi.spyOn(api, "uploadPhoto").mockRejectedValue(new Error("磁碟已滿"));
    const { result } = renderHook(() => usePhotoUploads());
    await act(async () => {
      await result.current.addFiles([fileOf("a.jpg")], DATE);
    });
    expect(result.current.items).toMatchObject([{ status: "error", filename: null }]);
    expect(result.current.hasLive).toBe(false);
    expect(result.current.uploading).toBe(false);
  });

  it("上傳中：鎖日期、不能送出（uploading = true）", async () => {
    const calls = slowUploads();
    const { result } = renderHook(() => usePhotoUploads());
    act(() => {
      void result.current.addFiles([fileOf("a.jpg")], DATE);
    });
    expect(result.current.uploading).toBe(true);
    expect(result.current.hasLive).toBe(true);
    await act(async () => {
      calls[0]!.d.resolve("a.jpg");
    });
    expect(result.current.uploading).toBe(false);
    expect(result.current.hasLive).toBe(true); // 已上傳未送出，仍鎖
  });

  describe("放棄（清除／離開頁面）", () => {
    it("一次選 3 張、第 1 張還在上傳時放棄：只發出 1 次請求、不中止請求、沒有殘留縮圖、日期立刻解鎖", async () => {
      const calls = slowUploads();
      const { result } = renderHook(() => usePhotoUploads());
      act(() => {
        void result.current.addFiles([fileOf("a.jpg"), fileOf("b.jpg"), fileOf("c.jpg")], DATE);
      });
      // 同一個 tick：還沒有任何回應就放棄
      act(() => result.current.abandonAll());
      await flush();

      expect(calls).toHaveLength(1);
      expect(calls[0]!.argCount).toBe(2); // 沒有帶 AbortSignal：不中止上傳（中止可能留下伺服器已存好的孤兒檔）
      expect(result.current.items).toEqual([]);
      expect(result.current.hasLive).toBe(false);
      expect(result.current.uploading).toBe(false);
      expect(deletePhoto).not.toHaveBeenCalled(); // 回應還沒回來，還沒有檔名可刪
    });

    it("伺服器已存好檔案、回應在放棄之後才到：用回傳的檔名 DELETE，不再上傳剩下的、不會跑回畫面", async () => {
      const calls = slowUploads();
      const { result } = renderHook(() => usePhotoUploads());
      act(() => {
        void result.current.addFiles([fileOf("a.jpg"), fileOf("b.jpg"), fileOf("c.jpg")], DATE);
      });
      act(() => result.current.abandonAll());
      expect(result.current.items).toEqual([]);

      await act(async () => {
        calls[0]!.d.resolve("a-1.jpg"); // 同名被伺服器改成 a-1.jpg
      });
      await flush();

      expect(deletePhoto).toHaveBeenCalledTimes(1);
      expect(deletePhoto).toHaveBeenCalledWith(DATE, "a-1.jpg");
      expect(calls).toHaveLength(1); // b、c 從頭到尾沒有發出請求
      expect(result.current.items).toEqual([]); // 沒有「鬼影」縮圖
      expect(result.current.hasLive).toBe(false);
    });

    it("已上傳未送出的照片：放棄時逐一 DELETE", async () => {
      vi.spyOn(api, "uploadPhoto").mockImplementation((_d, f) => Promise.resolve((f as File).name));
      const { result } = renderHook(() => usePhotoUploads());
      await act(async () => {
        await result.current.addFiles([fileOf("a.jpg"), fileOf("b.jpg")], DATE);
      });
      act(() => result.current.abandonAll());
      expect(deletePhoto.mock.calls).toEqual([
        [DATE, "a.jpg"],
        [DATE, "b.jpg"],
      ]);
      expect(result.current.items).toEqual([]);
    });

    it("放棄之後馬上開始的新一批不會被舊的迴圈干擾（不會有舊的檔案推進新的 session）", async () => {
      const calls = slowUploads();
      const { result } = renderHook(() => usePhotoUploads());
      act(() => {
        void result.current.addFiles([fileOf("old1.jpg"), fileOf("old2.jpg")], DATE);
      });
      act(() => result.current.abandonAll());
      act(() => {
        void result.current.addFiles([fileOf("new1.jpg")], DATE);
      });
      expect(calls.map((c) => c.name)).toEqual(["old1.jpg", "new1.jpg"]);

      await act(async () => {
        calls[0]!.d.resolve("old1.jpg");
      });
      await flush();
      expect(calls.map((c) => c.name)).toEqual(["old1.jpg", "new1.jpg"]); // old2 沒有被送出
      expect(deletePhoto).toHaveBeenCalledWith(DATE, "old1.jpg");
      expect(result.current.items).toMatchObject([{ fileName: "new1.jpg", status: "uploading" }]);

      await act(async () => {
        calls[1]!.d.resolve("new1.jpg");
      });
      expect(result.current.items).toMatchObject([{ fileName: "new1.jpg", status: "uploaded", filename: "new1.jpg" }]);
      expect(deletePhoto).toHaveBeenCalledTimes(1);
    });

    it("元件卸載（離開路由）＝放棄：已上傳的刪掉、上傳中的標記放棄", async () => {
      const calls = slowUploads();
      const { result, unmount } = renderHook(() => usePhotoUploads());
      act(() => {
        void result.current.addFiles([fileOf("a.jpg"), fileOf("b.jpg")], DATE);
      });
      await act(async () => {
        calls[0]!.d.resolve("a.jpg");
      });
      await flush(); // a 完成，b 開始上傳
      expect(calls).toHaveLength(2);
      unmount();
      await flush();
      expect(deletePhoto).toHaveBeenCalledWith(DATE, "a.jpg");
      expect(calls[1]!.argCount).toBe(2);
      await act(async () => {
        calls[1]!.d.resolve("b.jpg"); // 卸載後回應才到：補刪
      });
      expect(deletePhoto).toHaveBeenCalledWith(DATE, "b.jpg");
    });

    it("卸載時，上傳中的回應晚到也會補刪", async () => {
      const calls = slowUploads();
      const { result, unmount } = renderHook(() => usePhotoUploads());
      act(() => {
        void result.current.addFiles([fileOf("a.jpg")], DATE);
      });
      unmount();
      await act(async () => {
        calls[0]!.d.resolve("a.jpg");
      });
      await flush();
      expect(deletePhoto).toHaveBeenCalledWith(DATE, "a.jpg");
    });
  });

  describe("移除單張", () => {
    it("移除已上傳的：DELETE 並解鎖日期", async () => {
      vi.spyOn(api, "uploadPhoto").mockResolvedValue("a.jpg");
      const { result } = renderHook(() => usePhotoUploads());
      await act(async () => {
        await result.current.addFiles([fileOf("a.jpg")], DATE);
      });
      act(() => result.current.remove(result.current.items[0]!.id));
      expect(deletePhoto).toHaveBeenCalledWith(DATE, "a.jpg");
      expect(result.current.items).toEqual([]);
      expect(result.current.hasLive).toBe(false);
    });

    it("移除「上傳中」的縮圖：縮圖立刻消失、不中止請求、這批剩下的不再上傳、回應到了補刪", async () => {
      const calls = slowUploads();
      const { result } = renderHook(() => usePhotoUploads());
      act(() => {
        void result.current.addFiles([fileOf("a.jpg"), fileOf("b.jpg"), fileOf("c.jpg")], DATE);
      });
      act(() => result.current.remove(result.current.items[0]!.id));
      expect(result.current.items).toEqual([]);
      expect(calls[0]!.argCount).toBe(2);

      await act(async () => {
        calls[0]!.d.resolve("a.jpg");
      });
      await flush();
      expect(calls).toHaveLength(1);
      expect(deletePhoto).toHaveBeenCalledWith(DATE, "a.jpg");
      expect(result.current.items).toEqual([]);
    });

    it("上傳中途移除第 1 張之後，使用者另外再選的新檔案仍可正常上傳", async () => {
      const calls = slowUploads();
      const { result } = renderHook(() => usePhotoUploads());
      act(() => {
        void result.current.addFiles([fileOf("a.jpg")], DATE);
      });
      act(() => result.current.remove(result.current.items[0]!.id));
      act(() => {
        void result.current.addFiles([fileOf("b.jpg")], DATE);
      });
      await act(async () => {
        calls[1]!.d.resolve("b.jpg");
      });
      expect(result.current.items).toMatchObject([{ fileName: "b.jpg", status: "uploaded" }]);
    });
  });

  it("commit：送出成功後忘掉已上傳的照片但不刪檔；之後卸載也不會刪", async () => {
    vi.spyOn(api, "uploadPhoto").mockResolvedValue("a.jpg");
    const { result, unmount } = renderHook(() => usePhotoUploads());
    await act(async () => {
      await result.current.addFiles([fileOf("a.jpg")], DATE);
    });
    act(() => result.current.commit());
    expect(result.current.items).toEqual([]);
    expect(result.current.hasLive).toBe(false);
    unmount();
    expect(deletePhoto).not.toHaveBeenCalled();
  });

  it("圖片說明可逐張設定", async () => {
    vi.spyOn(api, "uploadPhoto").mockResolvedValue("a.jpg");
    const { result } = renderHook(() => usePhotoUploads());
    await act(async () => {
      await result.current.addFiles([fileOf("a.jpg")], DATE);
    });
    act(() => result.current.setCaption(result.current.items[0]!.id, "模具上的沾黏"));
    expect(result.current.items[0]?.caption).toBe("模具上的沾黏");
  });
});
