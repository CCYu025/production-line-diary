import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import { Providers } from "@/app/Providers";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { RecordsPage } from "@/features/records/RecordsPage";
import { api } from "@/lib/api";
import { createQueryClient } from "@/lib/queryClient";
import type { DiaryRecord, Meta } from "@/lib/types";

/*
 * 列表／詳情／儀表板測試共用的小工具：
 *  - jsdom 沒有的瀏覽器 API（Radix / cmdk 會用到）補上最小的替身；
 *  - makeRecord / makeMeta：造資料；
 *  - setViewportWidth：讓 matchMedia 依寬度回答（預設 jsdom 一律 false = 最窄的手機版）；
 *  - renderWithApp：QueryClient + Providers（含 Toaster）+ MemoryRouter，並用 [data-testid=loc] 顯示目前網址，
 *    方便斷言「篩選條件／?open 有寫進網址」「點了圖表有導到 /records?…」。
 */

if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
}
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.setPointerCapture ??= () => {};

let viewportWidth = 0;

function matches(query: string): boolean {
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  if (min && viewportWidth < Number(min[1])) return false;
  if (max && viewportWidth > Number(max[1])) return false;
  return Boolean(min || max);
}

/** 設定模擬的視窗寬度（0 = jsdom 預設：所有 min-width 查詢都不成立、max-width 都成立 → 手機版）。 */
export function setViewportWidth(width: number) {
  viewportWidth = width;
  window.matchMedia = ((query: string) =>
    ({
      matches: matches(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
}

export function makeRecord(overrides: Partial<DiaryRecord> & { id: number }): DiaryRecord {
  return {
    date: "2026-10-20",
    shift: "早",
    time: "08:00",
    duration: 10,
    equipment: "F3",
    category: "取料異常",
    problem: "取料位置偏移",
    severity: "輕微",
    action: "重新校正取料座標",
    rootCause: null,
    status: "待處理",
    productCode: null,
    materialCategory: null,
    photos: [],
    updatedAt: null,
    deleted: false,
    deletedAt: null,
    ...overrides,
  };
}

export function makeMeta(records: readonly DiaryRecord[]): Meta {
  const uniq = (xs: string[]) => Array.from(new Set(xs)).sort();
  return {
    schemaVersion: "1.2",
    equipment: uniq(records.map((r) => r.equipment)),
    categories: uniq(records.map((r) => r.category)),
    productCodes: [],
    materialCategories: [],
    equipmentMap: [],
  };
}

/** 6 筆（其中 1 筆已軟刪除）。「取料位置偏移」出現 3 次 → 詳情會顯示「重複發生 ×3」。 */
export function sampleRecords(): DiaryRecord[] {
  return [
    makeRecord({ id: 1, date: "2026-10-20", time: "08:00", equipment: "F3", category: "取料異常", problem: "取料位置偏移", status: "待處理", severity: "輕微", action: "1. 校正座標\n2. 清潔吸嘴" }),
    makeRecord({ id: 2, date: "2026-10-21", time: "09:00", equipment: "F4", category: "缺料", problem: "缺料警報", status: "追蹤中", severity: "一般", duration: 12 }),
    makeRecord({ id: 3, date: "2026-10-22", time: "10:00", equipment: "F3", category: "缺料", problem: "取料位置偏移", status: "已解決", severity: "嚴重", duration: 18, rootCause: "吸嘴磨耗\n需更換備品" }),
    makeRecord({ id: 4, date: "2026-10-23", time: "11:00", equipment: "G5", category: "設備異常", problem: "感測器誤判", status: "待處理", severity: "重大", duration: 25 }),
    makeRecord({
      id: 5,
      date: "2026-10-24",
      time: "12:00",
      equipment: "F3",
      category: "取料異常",
      problem: "取料位置偏移",
      status: "追蹤中",
      photos: ["a.jpg", "b.jpg"],
      photoCaptions: { "a.jpg": "模具表面裂痕" },
      updatedAt: "2026-10-25T08:30:00",
    }),
    makeRecord({ id: 6, date: "2026-10-25", time: "13:00", equipment: "F8", problem: "已刪除的紀錄", deleted: true, deletedAt: "2026-10-26T00:00:00" }),
  ];
}

export function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="loc">{loc.pathname + loc.search}</output>;
}

/** 讓 api 回傳假資料（用 spyOn 換掉方法，不碰網路）。 */
export function mockApi(records: DiaryRecord[]) {
  const store = records.map((r) => ({ ...r }));
  const spies = {
    listRecords: vi.spyOn(api, "listRecords").mockImplementation(async () => store.map((r) => ({ ...r }))),
    getMeta: vi.spyOn(api, "getMeta").mockImplementation(async () => makeMeta(store)),
    updateRecord: vi.spyOn(api, "updateRecord").mockImplementation(async (id, input) => {
      const r = store.find((x) => x.id === id);
      if (!r) throw new Error("not found");
      Object.assign(r, input, { updatedAt: "2026-10-26T09:00:00" });
      return { ...r };
    }),
    softDeleteRecord: vi.spyOn(api, "softDeleteRecord").mockImplementation(async (id) => {
      const r = store.find((x) => x.id === id);
      if (!r) throw new Error("not found");
      r.deleted = true;
      r.deletedAt = "2026-10-26T09:00:00";
      return { ...r };
    }),
    restoreRecord: vi.spyOn(api, "restoreRecord").mockImplementation(async (id) => {
      const r = store.find((x) => x.id === id);
      if (!r) throw new Error("not found");
      r.deleted = false;
      r.deletedAt = null;
      return { ...r };
    }),
  };
  return { store, spies };
}

export function renderWithApp(path = "/records") {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
  return render(
    <Providers client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="*" element={<p>其他頁面</p>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </Providers>,
  );
}
