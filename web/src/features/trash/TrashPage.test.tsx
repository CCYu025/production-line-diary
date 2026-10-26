import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/app/Providers";
import { ApiError, api } from "@/lib/api";
import { notify } from "@/lib/feedback";
import { createQueryClient } from "@/lib/queryClient";
import { useTrashCount } from "@/lib/queries";
import type { DiaryRecord } from "@/lib/types";
import { TrashPage } from "./TrashPage";
import { formatDeletedAt, trashRows } from "./trashModel";

function rec(id: number, over: Partial<DiaryRecord> = {}): DiaryRecord {
  return {
    id,
    date: "2026-10-01",
    shift: "早",
    time: "08:00",
    duration: 10,
    equipment: "F3",
    category: "取料異常",
    problem: `問題 ${id}`,
    severity: "輕微",
    action: "",
    rootCause: null,
    status: "待處理",
    productCode: null,
    materialCategory: null,
    photos: [],
    updatedAt: null,
    deleted: false,
    deletedAt: null,
    ...over,
  };
}

/** 側欄徽章的替身：同樣用 useTrashCount，用來驗證復原／永久刪除後筆數有跟著更新 */
function Badge() {
  const n = useTrashCount();
  return <output aria-label="回收桶筆數">{n ?? "…"}</output>;
}

/** 假伺服器：records 是可變的，API 的行為跟真的一樣會改它 */
function setup(initial: DiaryRecord[], opts: { wide?: boolean } = {}) {
  const store = initial.map((r) => ({ ...r }));
  vi.spyOn(api, "listRecords").mockImplementation(async () => store.map((r) => ({ ...r })));
  const restoreSpy = vi.spyOn(api, "restoreRecord").mockImplementation(async (id) => {
    const r = store.find((x) => x.id === id)!;
    r.deleted = false;
    r.deletedAt = null;
    return { ...r };
  });
  const purgeSpy = vi.spyOn(api, "purgeRecord").mockImplementation(async (id) => {
    store.splice(
      store.findIndex((x) => x.id === id),
      1,
    );
  });
  window.matchMedia = ((query: string) =>
    ({
      matches: Boolean(opts.wide) && query.includes("min-width: 768px"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  render(
    <Providers client={createQueryClient()}>
      <MemoryRouter>
        <Badge />
        <TrashPage />
      </MemoryRouter>
    </Providers>,
  );
  return { restoreSpy, purgeSpy };
}

afterEach(() => {
  notify.dismiss(); // toast 是全域的，不要留到下一個測試
  vi.restoreAllMocks();
});

const T1 = "2026-10-20T06:30:00.000Z";

const THREE = () => [
  rec(1, { date: "2026-10-05", time: "09:00", problem: "第二筆", deleted: true, deletedAt: T1 }),
  rec(2, { date: "2026-10-03", time: "10:00", problem: "第一筆", deleted: true, deletedAt: T1 }),
  rec(3, { date: "2026-10-09", problem: "沒刪除", deleted: false }),
  rec(4, { date: "2026-10-05", time: "15:00", problem: "第三筆", deleted: true, deletedAt: T1 }),
];

describe("trashModel", () => {
  it("只取已刪除的，依日期＋時間由舊到新", () => {
    expect(trashRows(THREE()).map((r) => r.problem)).toEqual(["第一筆", "第二筆", "第三筆"]);
  });
  it("formatDeletedAt：M/D HH:MM，空值與壞值回空字串", () => {
    const d = new Date(2026, 9, 5, 7, 4);
    expect(formatDeletedAt(d.toISOString())).toBe("10/5 07:04");
    expect(formatDeletedAt(null)).toBe("");
    expect(formatDeletedAt("not a date")).toBe("");
  });
});

describe("回收桶：列表", () => {
  it("只列出已刪除的紀錄，依時間順序（手機：卡片）", async () => {
    setup(THREE());
    const items = await screen.findAllByRole("listitem");
    expect(items.map((li) => within(li).getByText(/^第.筆$/).textContent)).toEqual(["第一筆", "第二筆", "第三筆"]);
    expect(screen.queryByText("沒刪除")).toBeNull();
    expect(screen.getByText("共 3 筆已刪除紀錄，可復原或永久刪除")).toBeInTheDocument();
    expect(screen.getByLabelText("回收桶筆數")).toHaveTextContent("3");
  });

  it("桌面寬度：表格（日期／設備／問題／刪除時間／操作）", async () => {
    setup(THREE(), { wide: true });
    const table = await screen.findByRole("table");
    const heads = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads.slice(0, 4)).toEqual(["日期", "設備", "問題", "刪除時間"]);
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 3);
    expect(within(table).getAllByRole("button", { name: /^復原/ })).toHaveLength(3);
  });

  it("空狀態：說明文字", async () => {
    setup([rec(1, { deleted: false })]);
    expect(await screen.findByText("目前沒有已刪除的紀錄")).toBeInTheDocument();
    expect(screen.getByText(/回收桶是空的/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /永久刪除/ })).toBeNull();
  });
});

describe("回收桶：復原", () => {
  it("直接復原（不問確認）、顯示 toast、列消失、徽章筆數同步", async () => {
    const user = userEvent.setup();
    const { restoreSpy } = setup(THREE());
    await screen.findAllByRole("listitem");
    await user.click(screen.getByRole("button", { name: /^復原：.*2026-10-03.*第一筆/ }));

    expect(restoreSpy).toHaveBeenCalledWith(2);
    expect(await screen.findByText("已復原紀錄")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("第一筆")).toBeNull());
    expect(screen.getByLabelText("回收桶筆數")).toHaveTextContent("2");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("復原失敗：錯誤 toast，紀錄仍留在回收桶", async () => {
    const user = userEvent.setup();
    const { restoreSpy } = setup(THREE());
    restoreSpy.mockRejectedValueOnce(new ApiError({ status: 404, errors: ["找不到這筆紀錄"], kind: "http" }));
    await screen.findAllByRole("listitem");
    await user.click(screen.getByRole("button", { name: /^復原：.*第一筆/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("找不到這筆紀錄");
    expect(screen.getByText("第一筆")).toBeInTheDocument();
  });
});

describe("回收桶：永久刪除", () => {
  it("先跳出確認對話框（說明無法復原、照片一併刪除），按取消什麼都不發生", async () => {
    const user = userEvent.setup();
    const { purgeSpy } = setup(THREE());
    await screen.findAllByRole("listitem");
    await user.click(screen.getByRole("button", { name: /^永久刪除：.*第二筆/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("無法復原");
    expect(dialog).toHaveTextContent("照片");
    expect(dialog).toHaveTextContent("第二筆");
    expect(purgeSpy).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(purgeSpy).not.toHaveBeenCalled();
    expect(screen.getByText("第二筆")).toBeInTheDocument();
  });

  it("Esc 等同取消", async () => {
    const user = userEvent.setup();
    const { purgeSpy } = setup(THREE());
    await screen.findAllByRole("listitem");
    await user.click(screen.getByRole("button", { name: /^永久刪除：.*第二筆/ }));
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(purgeSpy).not.toHaveBeenCalled();
  });

  it("確認後 DELETE、toast、列消失、徽章筆數同步", async () => {
    const user = userEvent.setup();
    const { purgeSpy } = setup(THREE());
    await screen.findAllByRole("listitem");
    await user.click(screen.getByRole("button", { name: /^永久刪除：.*第二筆/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "永久刪除" }));

    await waitFor(() => expect(purgeSpy).toHaveBeenCalledWith(1));
    expect(await screen.findByText("已永久刪除，無法復原")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("第二筆")).toBeNull());
    expect(screen.getByLabelText("回收桶筆數")).toHaveTextContent("2");
  });

  it("永久刪除失敗：錯誤 toast，紀錄仍在", async () => {
    const user = userEvent.setup();
    const { purgeSpy } = setup(THREE());
    purgeSpy.mockRejectedValueOnce(new ApiError({ status: 409, errors: ["只有回收桶裡的紀錄可以永久刪除"], kind: "http" }));
    await screen.findAllByRole("listitem");
    await user.click(screen.getByRole("button", { name: /^永久刪除：.*第二筆/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "永久刪除" }));
    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent("只有回收桶裡的紀錄可以永久刪除");
    expect(screen.getByText("第二筆")).toBeInTheDocument();
  });
});
