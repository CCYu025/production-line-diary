import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { vi } from "vitest";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { api } from "@/lib/api";
import { createQueryClient } from "@/lib/queryClient";
import type { DiaryRecord, Meta } from "@/lib/types";
import { RecordEditPage, RecordNewPage } from "./RecordFormPages";

/** 測試用：建一筆紀錄，只需要寫出有關係的欄位。 */
export function makeRecord(over: Partial<DiaryRecord> & { id: number }): DiaryRecord {
  return {
    date: "2026-10-20",
    shift: "中",
    time: "10:30",
    duration: 12,
    equipment: "F3",
    category: "沾模",
    problem: "半成品沾黏模具",
    severity: "一般",
    action: "清潔模具後重啟",
    rootCause: "脫模劑濃度不足",
    status: "已解決",
    productCode: "P-OLD",
    materialCategory: "舊原料",
    photos: [],
    updatedAt: null,
    deleted: false,
    deletedAt: null,
    ...over,
  };
}

export const META: Meta = {
  schemaVersion: "1.2",
  equipment: ["F3", "示範機台A"],
  categories: ["沾模", "取料異常"],
  productCodes: ["P-300", "P-OLD"],
  materialCategories: ["膠料A", "舊原料"],
  equipmentMap: [
    { equipment: "F3", productCode: "P-300", materialCategory: "膠料A" },
    { equipment: "F4", productCode: null, materialCategory: null },
  ],
};

export const RECORDS: DiaryRecord[] = [
  makeRecord({ id: 1, date: "2026-10-18", time: "08:00", problem: "取料位置偏移", category: "取料異常", equipment: "F4", duration: 5, severity: "輕微", action: "重新校正" , rootCause: null, status: "追蹤中" }),
  makeRecord({ id: 2, date: "2026-10-19", time: "09:00" }),
  makeRecord({ id: 3, date: "2026-10-20", time: "10:30", photos: ["a.jpg"], photoCaptions: { "a.jpg": "模具上的沾黏" } }),
  makeRecord({ id: 4, date: "2026-10-21", time: "11:00", equipment: "F4", problem: "已刪除的那筆", deleted: true, deletedAt: "2026-10-22T00:00:00.000Z" }),
];

export interface Mocks {
  getMeta: ReturnType<typeof vi.spyOn>;
  listRecords: ReturnType<typeof vi.spyOn>;
  createRecord: ReturnType<typeof vi.spyOn>;
  updateRecord: ReturnType<typeof vi.spyOn>;
  uploadPhoto: ReturnType<typeof vi.spyOn>;
  deletePhoto: ReturnType<typeof vi.spyOn>;
}

/** 把 api 換成假的。每個測試呼叫一次（afterEach 由 vi.restoreAllMocks 還原）。 */
export function mockApi(records: DiaryRecord[] = RECORDS, meta: Meta = META): Mocks {
  return {
    getMeta: vi.spyOn(api, "getMeta").mockResolvedValue(meta),
    listRecords: vi.spyOn(api, "listRecords").mockResolvedValue(records),
    createRecord: vi
      .spyOn(api, "createRecord")
      .mockImplementation((input) => Promise.resolve(makeRecord({ ...input, id: 99, photos: input.photos ?? [] } as Partial<DiaryRecord> & { id: number }))),
    updateRecord: vi
      .spyOn(api, "updateRecord")
      .mockImplementation((id, input) => Promise.resolve(makeRecord({ ...input, id } as Partial<DiaryRecord> & { id: number }))),
    uploadPhoto: vi.spyOn(api, "uploadPhoto").mockImplementation((_date, file) => Promise.resolve((file as File).name)),
    deletePhoto: vi.spyOn(api, "deletePhoto").mockResolvedValue({ deleted: true }),
  };
}

/** 手動控制的 Promise：模擬很慢的上傳。 */
export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

export function renderForm(initialEntry = "/records/new") {
  const router = createMemoryRouter(
    [
      { path: "/records/new", element: <RecordNewPage /> },
      { path: "/records/:id/edit", element: <RecordEditPage /> },
      { path: "/dashboard", element: <LocationProbe /> },
      { path: "/records", element: <LocationProbe /> },
    ],
    { initialEntries: [initialEntry] },
  );
  const client = createQueryClient();
  const utils = render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  return { router, client, ...utils };
}

export function fileOf(name: string, type = "image/jpeg") {
  return new File([name], name, { type });
}
