import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, RouterProvider, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/app/Providers";
import { ApiError, api } from "@/lib/api";
import { notify } from "@/lib/feedback";
import { createQueryClient } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";
import type { EquipmentMapEntry, Meta } from "@/lib/types";
import { SettingsPage } from "./SettingsPage";

function meta(over: Partial<Meta> = {}): Meta {
  return {
    schemaVersion: "1.2",
    equipment: ["F3", "F4"],
    categories: [],
    productCodes: ["P-100", "P-200"],
    materialCategories: ["膠料A", "膠料B"],
    equipmentMap: [],
    ...over,
  };
}

function Probe() {
  return <output data-testid="loc">{useLocation().pathname}</output>;
}

function setup(m: Meta = meta()) {
  vi.spyOn(api, "getMeta").mockResolvedValue(m);
  const saveSpy = vi
    .spyOn(api, "saveEquipmentMap")
    .mockImplementation(async (list: EquipmentMapEntry[]) =>
      list.map((e) => ({ equipment: e.equipment, productCode: e.productCode || null, materialCategory: e.materialCategory || null })),
    );
  const router = createMemoryRouter(
    [
      {
        path: "/settings",
        element: (
          <>
            <SettingsPage />
            <Link to="/dashboard">去儀表板</Link>
            <Probe />
          </>
        ),
      },
      {
        path: "/dashboard",
        element: (
          <>
            <p>儀表板頁</p>
            <Probe />
          </>
        ),
      },
    ],
    { initialEntries: ["/settings"] },
  );
  const client = createQueryClient();
  render(
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { saveSpy, router, client };
}

afterEach(() => {
  notify.dismiss(); // toast 是全域的，不要留到下一個測試
  vi.restoreAllMocks();
});

const equipmentInputs = () => screen.getAllByPlaceholderText("設備代號，例：F3") as HTMLInputElement[];
const loc = () => screen.getByTestId("loc").textContent;

describe("設備對照設定：草稿組成", () => {
  it("沒有已儲存的對照 → 預設六台生產機台，沒有原材區／RB2", async () => {
    setup();
    await screen.findByRole("button", { name: "儲存對照表" });
    expect(equipmentInputs().map((i) => i.value)).toEqual(["F3", "F4", "G5", "G6", "F7", "F8"]);
    expect(screen.queryByDisplayValue("原材區")).toBeNull();
    expect(screen.queryByDisplayValue("RB2")).toBeNull();
    expect(screen.getByText(/原材區、RB2 這類機構\/區塊沒有自己的品號/)).toBeInTheDocument();
  });

  it("已儲存的 ∪ 缺的預設列；已儲存的值帶進欄位", async () => {
    setup(
      meta({
        equipmentMap: [
          { equipment: "F4", productCode: "P-100", materialCategory: "膠料A" },
          { equipment: "原材區", productCode: null, materialCategory: "膠料B" },
        ],
      }),
    );
    await screen.findByRole("button", { name: "儲存對照表" });
    expect(equipmentInputs().map((i) => i.value)).toEqual(["F4", "原材區", "F3", "G5", "G6", "F7", "F8"]);
    expect(screen.getAllByPlaceholderText("品號")[0]).toHaveValue("P-100");
    expect(screen.getAllByPlaceholderText("原料類別")[0]).toHaveValue("膠料A");
  });

  it("品號、原料類別有建議清單（來自 meta）", async () => {
    setup();
    await screen.findByRole("button", { name: "儲存對照表" });
    const product = screen.getAllByPlaceholderText("品號")[0]!;
    const list = document.getElementById(product.getAttribute("list")!)!;
    expect([...list.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual(["P-100", "P-200"]);
    const material = screen.getAllByPlaceholderText("原料類別")[0]!;
    const mlist = document.getElementById(material.getAttribute("list")!)!;
    expect([...mlist.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual(["膠料A", "膠料B"]);
  });
});

describe("設備對照設定：編輯與儲存", () => {
  it("新增／刪除列；空白列存檔時丟掉；存檔後以伺服器內容為準", async () => {
    const user = userEvent.setup();
    const { saveSpy } = setup(meta({ equipmentMap: [{ equipment: "F3", productCode: "P-100", materialCategory: null }] }));
    await screen.findByRole("button", { name: "儲存對照表" });
    expect(equipmentInputs()).toHaveLength(6);

    // 刪掉 F4～F8 以外的：先刪 G6、F7、F8
    await user.click(screen.getByRole("button", { name: "刪除第 6 列（F8）" }));
    await user.click(screen.getByRole("button", { name: "刪除第 5 列（F7）" }));
    await user.click(screen.getByRole("button", { name: "刪除第 4 列（G6）" }));
    expect(equipmentInputs()).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "新增一列" })); // 空白列
    await user.click(screen.getByRole("button", { name: "新增一列" }));
    const inputs = equipmentInputs();
    expect(inputs).toHaveLength(5);
    expect(inputs[4]).toHaveFocus(); // 新增的列直接可以輸入
    await user.type(inputs[3]!, "  RB2 ");
    await user.type(screen.getAllByPlaceholderText("品號")[3]!, " P-200 ");

    await user.click(screen.getByRole("button", { name: "儲存對照表" }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(saveSpy.mock.calls[0]![0]).toEqual([
      { equipment: "F3", productCode: "P-100", materialCategory: "" },
      { equipment: "F4", productCode: "", materialCategory: "" },
      { equipment: "G5", productCode: "", materialCategory: "" },
      { equipment: "RB2", productCode: "P-200", materialCategory: "" },
    ]);
    expect(await screen.findByText("已儲存對照表")).toBeInTheDocument();
    // 存檔後草稿＝伺服器回傳的內容（空白列沒了，不再補預設列）
    expect(equipmentInputs().map((i) => i.value)).toEqual(["F3", "F4", "G5", "RB2"]);
  });
});

describe("設備對照設定：未儲存變更提示", () => {
  it("沒動時顯示「所有變更都已儲存」；改了顯示「有未儲存的變更」；存檔後恢復", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("button", { name: "儲存對照表" });
    expect(screen.getByText("所有變更都已儲存")).toBeInTheDocument();

    await user.type(screen.getAllByPlaceholderText("品號")[0]!, "P-1");
    expect(screen.getByText("有未儲存的變更")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "儲存對照表" }));
    expect(await screen.findByText("所有變更都已儲存")).toBeInTheDocument();
  });

  it("只新增還沒填的空白列，不算變更", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("button", { name: "儲存對照表" });
    await user.click(screen.getByRole("button", { name: "新增一列" }));
    expect(screen.getByText("所有變更都已儲存")).toBeInTheDocument();
  });
});

describe("設備對照設定：離開頁面前的確認", () => {
  it("沒有變更：直接離開，不問", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("button", { name: "儲存對照表" });
    await user.click(screen.getByRole("link", { name: "去儀表板" }));
    expect(await screen.findByText("儀表板頁")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("有未儲存變更：先確認；選「留在這一頁」就留下、草稿還在；選「離開」才離開", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("button", { name: "儲存對照表" });
    await user.type(screen.getAllByPlaceholderText("品號")[0]!, "P-X");

    await user.click(screen.getByRole("link", { name: "去儀表板" }));
    let dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("尚未儲存");
    expect(loc()).toBe("/settings");

    await user.click(within(dialog).getByRole("button", { name: "留在這一頁" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(loc()).toBe("/settings");
    expect(screen.getAllByPlaceholderText("品號")[0]).toHaveValue("P-X");
    expect(screen.getByText("有未儲存的變更")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "去儀表板" }));
    dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "離開，不儲存" }));
    expect(await screen.findByText("儀表板頁")).toBeInTheDocument();
    expect(loc()).toBe("/dashboard");
  });

  it("儲存之後再離開不問", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("button", { name: "儲存對照表" });
    await user.type(screen.getAllByPlaceholderText("品號")[0]!, "P-X");
    await user.click(screen.getByRole("button", { name: "儲存對照表" }));
    await screen.findByText("所有變更都已儲存");
    await user.click(screen.getByRole("link", { name: "去儀表板" }));
    expect(await screen.findByText("儀表板頁")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("有變更時重新整理／關閉分頁會被瀏覽器攔下（beforeunload）", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("button", { name: "儲存對照表" });

    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await user.type(screen.getAllByPlaceholderText("品號")[0]!, "P-X");
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});

describe("設備對照設定：儲存失敗", () => {
  it("伺服器驗證錯誤（400）顯示在表單上，草稿與未儲存提示都保留", async () => {
    const user = userEvent.setup();
    const { saveSpy } = setup();
    saveSpy.mockRejectedValueOnce(
      new ApiError({ status: 400, errors: ["設備對照表的 productCode 必須是文字", "body 必須是陣列"], kind: "http" }),
    );
    await screen.findByRole("button", { name: "儲存對照表" });
    await user.type(screen.getAllByPlaceholderText("品號")[0]!, "P-X");
    await user.click(screen.getByRole("button", { name: "儲存對照表" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("儲存失敗");
    expect(alert).toHaveTextContent("設備對照表的 productCode 必須是文字");
    expect(alert).toHaveTextContent("body 必須是陣列");
    expect(screen.getAllByPlaceholderText("品號")[0]).toHaveValue("P-X");
    expect(screen.getByText("有未儲存的變更")).toBeInTheDocument();

    // 再按一次成功後，錯誤訊息消失
    await user.click(screen.getByRole("button", { name: "儲存對照表" }));
    await screen.findByText("所有變更都已儲存");
    expect(screen.queryByText(/儲存失敗/)).toBeNull();
  });

  it("連不上伺服器（非 400）用錯誤 toast", async () => {
    const user = userEvent.setup();
    const { saveSpy } = setup();
    saveSpy.mockRejectedValueOnce(new ApiError({ status: 0, errors: ["無法連線到伺服器，請確認 App 還在執行"], kind: "network" }));
    await screen.findByRole("button", { name: "儲存對照表" });
    await user.type(screen.getAllByPlaceholderText("品號")[0]!, "P-X");
    await user.click(screen.getByRole("button", { name: "儲存對照表" }));
    const toast = await screen.findByText("無法連線到伺服器，請確認 App 還在執行");
    expect(toast.closest("[role=alert]")).not.toBeNull();
    expect(screen.getByText("有未儲存的變更")).toBeInTheDocument();
  });
});

describe("設備對照設定：載入", () => {
  it("meta 重抓（例如別處改了紀錄）不會蓋掉正在編輯的草稿", async () => {
    const user = userEvent.setup();
    const { client } = setup();
    await screen.findByRole("button", { name: "儲存對照表" });
    await user.type(screen.getAllByPlaceholderText("品號")[0]!, "P-X");
    // 模擬 meta 重新載入（內容不同）
    vi.mocked(api.getMeta).mockResolvedValue(meta({ equipmentMap: [{ equipment: "ZZ", productCode: null, materialCategory: null }] }));
    await client.invalidateQueries({ queryKey: queryKeys.meta });
    await waitFor(() => expect(api.getMeta).toHaveBeenCalledTimes(2));
    expect(screen.getAllByPlaceholderText("品號")[0]).toHaveValue("P-X");
    expect(screen.queryByDisplayValue("ZZ")).toBeNull();
  });

  it("載入失敗顯示錯誤與重試", async () => {
    vi.spyOn(api, "getMeta").mockRejectedValue(new Error("壞了"));
    const router = createMemoryRouter([{ path: "/settings", element: <SettingsPage /> }], { initialEntries: ["/settings"] });
    render(
      <Providers client={createQueryClient()}>
        <RouterProvider router={router} />
      </Providers>,
    );
    const alert = await screen.findByRole("alert", {}, { timeout: 4000 });
    expect(within(alert).getByRole("button", { name: "重試" })).toBeInTheDocument();
  });
});
