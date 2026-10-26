import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notify } from "@/lib/feedback";
import { makeRecord, mockApi, renderWithApp, sampleRecords, setViewportWidth } from "@/test/recordsHarness";

/** 「共 x / y 筆」（x 在 <b> 裡，所以要比整個元素的文字） */
const countEl = (shown: number, total: number) => {
  const el = screen.getByTestId("result-count");
  expect(el.textContent?.replace(/\s+/g, "")).toBe(`共${shown}/${total}筆`);
  return el;
};
const getCount = (shown: number, total: number) => countEl(shown, total);
const findCount = (shown: number, total: number) => waitFor(() => countEl(shown, total));

const loc = () => screen.getByTestId("loc").textContent ?? "";
const query = () => new URLSearchParams(loc().split("?")[1] ?? "");

/** 資料列（表格）或卡片裡的問題文字，依畫面順序 */
const visibleProblems = () =>
  Array.from(document.querySelectorAll("[data-record-id]")).map((el) => el.getAttribute("data-record-id"));

beforeEach(() => setViewportWidth(1280));
afterEach(() => {
  notify.dismiss(); // sonner 的 toast 是全域的，不清掉會漏到下一個測試
  vi.restoreAllMocks();
});

async function setup(path = "/records") {
  const mocked = mockApi(sampleRecords());
  const user = userEvent.setup();
  renderWithApp(path);
  await screen.findByTestId("result-count");
  return { user, ...mocked };
}

describe("列表（桌面表格）", () => {
  it("預設新到舊、不含已軟刪除的紀錄；欄位齊全", async () => {
    await setup();
    expect(visibleProblems()).toEqual(["5", "4", "3", "2", "1"]);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["日期時間", "設備", "分類", "問題", "耗時", "嚴重度", "狀態", "操作"]);
    expect(screen.queryByText("已刪除的紀錄")).toBeNull();
    // 日期、時間、班別合併在同一格；照片數是問題欄內的小圖示
    const row5 = document.querySelector('[data-record-id="5"]') as HTMLElement;
    expect(within(row5).getByText(/12:00・早班/)).toBeInTheDocument();
    expect(within(row5).getByText("2 張照片")).toBeInTheDocument();
  });

  it("點「日期」表頭切換排序，並寫進網址（sort=asc）", async () => {
    const { user } = await setup();
    await user.click(screen.getByRole("button", { name: /日期時間，目前新到舊/ }));
    expect(visibleProblems()).toEqual(["1", "2", "3", "4", "5"]);
    expect(query().get("sort")).toBe("asc");
    await user.click(screen.getByRole("button", { name: /日期 舊 → 新/ }));
    expect(visibleProblems()).toEqual(["5", "4", "3", "2", "1"]);
    expect(query().get("sort")).toBeNull();
  });

  it("整列可用鍵盤開啟詳情（Enter）", async () => {
    const { user } = await setup();
    const row = document.querySelector('[data-record-id="4"]') as HTMLElement;
    row.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "感測器誤判" })).toBeInTheDocument();
    expect(query().get("open")).toBe("4");
  });

  it("複製按鈕導向 /records/new?copy=<id>，且不會同時開詳情", async () => {
    const { user } = await setup();
    const row = document.querySelector('[data-record-id="3"]') as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "複製這筆當新紀錄" }));
    expect(loc()).toBe("/records/new?copy=3");
  });
});

describe("篩選：狀態／嚴重度 分段按鈕與筆數", () => {
  it("每顆帶 facet 筆數；點下去篩選並寫進網址", async () => {
    const { user } = await setup();
    const status = screen.getByRole("group", { name: "處理狀態" });
    expect(within(status).getByRole("button", { name: /全部，5 筆/ })).toBeInTheDocument();
    expect(within(status).getByRole("button", { name: /待處理，2 筆/ })).toBeInTheDocument();
    expect(within(status).getByRole("button", { name: /追蹤中，2 筆/ })).toBeInTheDocument();
    expect(within(status).getByRole("button", { name: /已解決，1 筆/ })).toBeInTheDocument();

    await user.click(within(status).getByRole("button", { name: /待處理/ }));
    expect(query().get("status")).toBe("待處理");
    expect(visibleProblems()).toEqual(["4", "1"]);
    expect(getCount(2, 5)).toBeInTheDocument();
    // 狀態自己這一維不被自己篩掉：其他狀態的筆數還在
    expect(within(status).getByRole("button", { name: /追蹤中，2 筆/ })).toBeInTheDocument();
    // 嚴重度的筆數則套用了「待處理」：輕微 1、重大 1
    const sev = screen.getByRole("group", { name: "嚴重度" });
    expect(within(sev).getByRole("button", { name: /輕微，1 筆/ })).toBeInTheDocument();
    expect(within(sev).getByRole("button", { name: /嚴重，0 筆/ })).toBeInTheDocument();
  });

  it("狀態、嚴重度、關鍵字不另外顯示成「已套用條件」chip", async () => {
    const { user } = await setup();
    await user.click(within(screen.getByRole("group", { name: "處理狀態" })).getByRole("button", { name: /追蹤中/ }));
    expect(screen.queryByTestId("active-filters")).toBeNull();
  });
});

describe("篩選：設備／分類 可搜尋的多選下拉", () => {
  it("選了 F3 之後設備下拉仍看得到別台設備（facet 不套用自己這一維），可以再加選第二台", async () => {
    const { user } = await setup();
    await user.click(screen.getByRole("button", { name: "設備" }));
    // 選項順序依全部紀錄的總筆數：F3 3、F4 1、G5 1；F8 只有已刪除的紀錄 → 0 筆，但仍在清單裡（meta 的已知清單）
    let options = await screen.findAllByRole("option");
    expect(options[0]).toHaveTextContent("F3");
    expect(options.map((o) => o.textContent?.slice(0, 2))).toEqual(["F3", "F4", "G5", "F8"]);
    await user.click(screen.getByRole("option", { name: /F3/ }));
    expect(query().getAll("equipment")).toEqual(["F3"]);

    // 下拉沒有關掉，而且 F4、G5 還在、筆數沒有被 F3 篩掉
    options = screen.getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(screen.getByRole("option", { name: /F4/ })).toHaveTextContent("1");
    expect(screen.getByRole("option", { name: /G5/ })).toHaveTextContent("1");

    await user.click(screen.getByRole("option", { name: /G5/ }));
    expect(query().getAll("equipment")).toEqual(["F3", "G5"]);
    expect(visibleProblems()).toEqual(["5", "4", "3", "1"]);
    // 觸發鈕顯示第一項＋「+n」
    await user.keyboard("{Escape}");
    const trigger = screen.getByRole("button", { name: /^設備：F3/ });
    expect(trigger).toHaveTextContent("+1");
  });

  it("另一維度（分類）的筆數套用了已選的設備", async () => {
    const { user } = await setup("/records?equipment=F3");
    await user.click(screen.getByRole("button", { name: "分類" }));
    await screen.findAllByRole("option");
    // F3 的紀錄：取料異常 2、缺料 1；設備異常（G5）0
    expect(screen.getByRole("option", { name: /取料異常/ })).toHaveTextContent("2");
    expect(screen.getByRole("option", { name: /缺料/ })).toHaveTextContent("1");
    expect(screen.getByRole("option", { name: /設備異常/ })).toHaveTextContent("0");
  });

  it("選項 = 已知清單 ∪ 資料 ∪ 已選：網址上選了沒有紀錄的設備也在清單裡（筆數 0）", async () => {
    const { user } = await setup("/records?equipment=RB2");
    expect(visibleProblems()).toEqual([]);
    await user.click(screen.getByRole("button", { name: /^設備：RB2/ }));
    const rb2 = await screen.findByRole("option", { name: /RB2/ });
    expect(rb2).toHaveTextContent("0");
    expect(rb2).toHaveTextContent("（已選）");
  });

  it("下拉裡可以搜尋；離開下拉就清掉搜尋字（下次打開不會只剩幾項）", async () => {
    const { user } = await setup();
    await user.click(screen.getByRole("button", { name: "設備" }));
    await user.type(await screen.findByRole("combobox", { name: "搜尋設備" }), "g5");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "設備" }));
    expect(await screen.findAllByRole("option")).toHaveLength(4);
  });

  it("下拉裡的「清除」清掉該維度所有已選", async () => {
    const { user } = await setup("/records?equipment=F3&equipment=G5");
    await user.click(screen.getByRole("button", { name: /^設備：F3/ }));
    await user.click(await screen.findByRole("button", { name: "清除" }));
    expect(query().getAll("equipment")).toEqual([]);
  });
});

describe("篩選：日期區間", () => {
  it("快捷「全部」以外的快捷會寫進 from / to；顯示快捷名稱", async () => {
    const { user } = await setup();
    await user.click(screen.getByRole("button", { name: "日期" }));
    await user.click(await screen.findByRole("button", { name: "今天" }));
    expect(query().get("from")).toBe(query().get("to"));
    expect(query().get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(visibleProblems()).toEqual([]); // 範例資料都是過去的日期
    expect(screen.getByText("沒有符合條件的紀錄")).toBeInTheDocument();
  });

  it("起 > 迄：只顯示提示、列表為空，不會自動改另一端", async () => {
    await setup("/records?from=2026-10-23&to=2026-10-21");
    expect(visibleProblems()).toEqual([]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^日期：/ }));
    expect(await screen.findByText("起日晚於迄日，沒有符合的紀錄")).toBeInTheDocument();
    expect(screen.getByLabelText("起日")).toHaveValue("2026-10-23");
    expect(screen.getByLabelText("迄日")).toHaveValue("2026-10-21");
    // 網址的兩端都沒被動過
    expect(query().get("from")).toBe("2026-10-23");
    expect(query().get("to")).toBe("2026-10-21");
  });

  it("逐位打年份：年份 < 1900 的中間值被忽略，不寫進網址；完整日期才套用", async () => {
    const { user } = await setup();
    await user.click(screen.getByRole("button", { name: "日期" }));
    const from = await screen.findByLabelText("起日");
    // jsdom 的 <input type=date> 只接受完整的 YYYY-MM-DD；用 fireEvent 模擬瀏覽器逐位改年份時的 change
    const { fireEvent } = await import("@testing-library/react");
    for (const v of ["0002-10-22", "0020-10-22", "0202-10-22"]) fireEvent.change(from, { target: { value: v } });
    expect(query().get("from")).toBeNull();
    expect(from).toHaveValue("0202-10-22"); // 輸入框裡打到一半的值保留
    fireEvent.change(from, { target: { value: "2026-10-22" } });
    expect(query().get("from")).toBe("2026-10-22");
    expect(visibleProblems()).toEqual(["5", "4", "3"]);
  });

  it("日期 chip 可移除", async () => {
    const { user } = await setup("/records?from=2026-10-22&to=2026-10-23");
    const chip = screen.getByRole("button", { name: /移除 日期：/ });
    expect(visibleProblems()).toEqual(["4", "3"]);
    await user.click(chip);
    expect(query().get("from")).toBeNull();
    expect(query().get("to")).toBeNull();
    expect(visibleProblems()).toHaveLength(5);
  });
});

describe("搜尋、chips、清除全部、空狀態", () => {
  it("關鍵字搜尋涵蓋根本原因（也涵蓋處理、設備、問題）", async () => {
    const { user } = await setup();
    await user.type(screen.getByRole("searchbox", { name: "搜尋紀錄" }), "吸嘴磨耗");
    expect(query().get("q")).toBe("吸嘴磨耗");
    expect(visibleProblems()).toEqual(["3"]); // 只有 #3 的根本原因有這句
  });

  it("搜尋框結尾的空白不會被網址的 trim 吃掉", async () => {
    const { user } = await setup();
    const box = screen.getByRole("searchbox", { name: "搜尋紀錄" });
    await user.type(box, "F3 ");
    expect(box).toHaveValue("F3 ");
    expect(visibleProblems()).toEqual(["5", "3", "1"]); // 比對時以去掉空白的 F3 為準
  });

  it("設備／分類 chip 可個別移除；「清除全部」一次清掉所有條件（含狀態、關鍵字）", async () => {
    const { user } = await setup("/records?equipment=F3&category=缺料&status=已解決&q=吸嘴&problem=取料位置偏移");
    expect(screen.getByRole("button", { name: "移除 設備：F3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除 分類：缺料" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除 問題：取料位置偏移" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "移除 分類：缺料" }));
    expect(query().getAll("category")).toEqual([]);
    expect(query().getAll("equipment")).toEqual(["F3"]);

    await user.click(screen.getByRole("button", { name: "清除全部" }));
    expect(loc()).toBe("/records");
    expect(screen.getByRole("searchbox", { name: "搜尋紀錄" })).toHaveValue("");
    expect(visibleProblems()).toHaveLength(5);
  });

  it("沒有符合條件時顯示空狀態與「清除全部條件」", async () => {
    const { user } = await setup("/records?q=不存在的關鍵字");
    expect(screen.getByText("沒有符合條件的紀錄")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清除全部條件" }));
    expect(visibleProblems()).toHaveLength(5);
  });

  it("結果筆數「共 x / y 筆」", async () => {
    await setup("/records?status=追蹤中");
    expect(getCount(2, 5)).toBeInTheDocument();
  });
});

describe("詳情面板（?open=<id>）", () => {
  it("開啟時寫進網址；Esc 關閉、移除 open，焦點回到被點的那一列", async () => {
    const { user } = await setup();
    const row = document.querySelector('[data-record-id="2"]') as HTMLElement;
    await user.click(row);
    const dialog = await screen.findByRole("dialog");
    expect(query().get("open")).toBe("2");
    expect(within(dialog).getByRole("heading", { name: "缺料警報" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(query().get("open")).toBeNull();
    await waitFor(() => expect(row).toHaveFocus());
  });

  it("直接用網址開（重新整理、分享連結）：顯示該筆；不存在的 id 會被拿掉", async () => {
    await setup("/records?open=3");
    expect(await screen.findByRole("heading", { name: "取料位置偏移" })).toBeInTheDocument();
  });

  it("網址指向不存在／已刪除的紀錄 → 資料載入後拿掉 ?open，不顯示面板", async () => {
    mockApi(sampleRecords());
    renderWithApp("/records?open=6");
    await findCount(5, 5);
    await waitFor(() => expect(query().get("open")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each(["abc", "0", "-1", "1.5", ""])("無效的 ?open=%s 會被拿掉（和不存在的 id 一樣），不顯示面板", async (bad) => {
    mockApi(sampleRecords());
    renderWithApp(`/records?open=${encodeURIComponent(bad)}&status=${encodeURIComponent("待處理")}`);
    await screen.findByTestId("result-count");
    await waitFor(() => expect(query().has("open")).toBe(false));
    expect(query().get("status")).toBe("待處理"); // 其他條件原樣保留
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("上一筆／下一筆走「全部有效紀錄」的時間順序，不跟列表的篩選", async () => {
    // 篩選只剩 F3（1、3、5），但 #3 的上一筆是 #2（F4）、下一筆是 #4（G5）
    const { user } = await setup("/records?equipment=F3&open=3");
    const dialog = await screen.findByRole("dialog");
    expect(visibleProblems()).toEqual(["5", "3", "1"]);
    expect(within(dialog).getByText("3 / 5")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "下一筆" }));
    expect(await within(dialog).findByRole("heading", { name: "感測器誤判" })).toBeInTheDocument();
    expect(query().get("open")).toBe("4");
    expect(query().getAll("equipment")).toEqual(["F3"]); // 篩選沒被動到
    await user.click(within(dialog).getByRole("button", { name: "上一筆" }));
    await user.click(within(dialog).getByRole("button", { name: "上一筆" }));
    expect(await within(dialog).findByRole("heading", { name: "缺料警報" })).toBeInTheDocument();
    expect(query().get("open")).toBe("2");
  });

  it("第一筆沒有上一筆、最後一筆沒有下一筆（真正的 <button>，disabled）", async () => {
    await setup("/records?open=1");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "上一筆" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "下一筆" })).toBeEnabled();
  });

  it("切換上一筆／下一筆用 replace，瀏覽器「上一頁」一次就關掉面板", async () => {
    const { user } = await setup();
    await user.click(document.querySelector('[data-record-id="3"]') as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "下一筆" }));
    await within(dialog).findByRole("heading", { name: "感測器誤判" });
    // 關閉按鈕：因為是我們自己 push 的那一層，直接 back
    await user.click(within(dialog).getByRole("button", { name: "關閉" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(loc()).toBe("/records");
  });

  it("標題＝問題；嚴重度、狀態、「重複發生 ×N」、已編輯時間", async () => {
    await setup("/records?open=5");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "取料位置偏移" })).toBeInTheDocument();
    expect(dialog.querySelector("[data-severity='輕微']")).not.toBeNull();
    expect(dialog.querySelector("[data-status='追蹤中']")).not.toBeNull();
    expect(within(dialog).getByText("重複發生 ×3")).toBeInTheDocument();
    expect(within(dialog).getByText(/已編輯 · 10\/25 08:30/)).toBeInTheDocument();
  });

  it("不是最常見的問題、或次數不到 3 → 沒有「重複發生」標籤", async () => {
    await setup("/records?open=4");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/重複發生/)).toBeNull();
    expect(within(dialog).queryByText(/已編輯/)).toBeNull();
  });

  it("事實格：日期、時間、班別、耗時、設備、分類；品號／原料類別有值才顯示", async () => {
    mockApi([
      makeRecord({ id: 1, productCode: "P-001", materialCategory: null }),
      makeRecord({ id: 2, date: "2026-10-21", productCode: null, materialCategory: null }),
    ]);
    renderWithApp("/records?open=1");
    const dialog = await screen.findByRole("dialog");
    for (const k of ["日期", "時間", "班別", "耗時", "設備", "分類"]) expect(within(dialog).getByText(k)).toBeInTheDocument();
    expect(within(dialog).getByText("品號")).toBeInTheDocument();
    expect(within(dialog).getByText("P-001")).toBeInTheDocument();
    expect(within(dialog).queryByText("原料類別")).toBeNull();
  });

  it("「處理」「根本原因」顯示全文用 white-space: pre-wrap（換行保留）", async () => {
    await setup("/records?open=3");
    const dialog = await screen.findByRole("dialog");
    const rootCause = within(dialog).getByText(/吸嘴磨耗/);
    expect(rootCause).toHaveClass("whitespace-pre-wrap");
    expect(rootCause.textContent).toBe("吸嘴磨耗\n需更換備品");
  });

  it("處理欄（多行條列）也是 pre-wrap", async () => {
    await setup("/records?open=1");
    const dialog = await screen.findByRole("dialog");
    const action = within(dialog).getByText(/校正座標/);
    expect(action).toHaveClass("whitespace-pre-wrap");
    expect(action.textContent).toBe("1. 校正座標\n2. 清潔吸嘴");
  });

  it("底部操作列：編輯 → /records/<id>/edit；複製為新紀錄 → /records/new?copy=<id>", async () => {
    const { user } = await setup("/records?open=2");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "複製為新紀錄" }));
    expect(loc()).toBe("/records/new?copy=2");
  });

  it("編輯按鈕導向 /records/<id>/edit", async () => {
    const { user } = await setup("/records?open=2");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "編輯" }));
    expect(loc()).toBe("/records/2/edit");
  });
});

describe("詳情：快速操作", () => {
  it("快速切換處理狀態：PUT { status }，成功後面板與列表都更新", async () => {
    const { user, spies } = await setup("/records?open=1");
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "處理狀態" }), "已解決");
    await waitFor(() => expect(spies.updateRecord).toHaveBeenCalledWith(1, { status: "已解決" }));
    await waitFor(() => expect(dialog.querySelector("[data-status='已解決']")).not.toBeNull());
    expect(await screen.findByText("處理狀態已改為「已解決」")).toBeInTheDocument();
    const row = document.querySelector('[data-record-id="1"]') as HTMLElement;
    expect(row.querySelector("[data-status='已解決']")).not.toBeNull();
  });

  it("狀態更新失敗：錯誤 toast，下拉回到原本的值", async () => {
    const { user, spies } = await setup("/records?open=1");
    spies.updateRecord.mockRejectedValueOnce(new Error("伺服器壞了"));
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByRole("combobox", { name: "處理狀態" });
    await user.selectOptions(select, "追蹤中");
    expect(await screen.findByRole("alert")).toHaveTextContent("伺服器壞了");
    await waitFor(() => expect(select).toHaveValue("待處理"));
  });

  it("根本原因空白 → 顯示快速填寫；儲存 PUT { rootCause }（去頭尾空白），之後改成純文字顯示", async () => {
    const { user, spies } = await setup("/records?open=1");
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "儲存根本原因" });
    expect(save).toBeDisabled(); // 空白不能存
    await user.type(within(dialog).getByRole("textbox", { name: "根本原因" }), "  脫模劑濃度不足\n已調整  ");
    await user.click(save);
    await waitFor(() => expect(spies.updateRecord).toHaveBeenCalledWith(1, { rootCause: "脫模劑濃度不足\n已調整" }));
    const text = await within(dialog).findByText(/脫模劑濃度不足/);
    expect(text).toHaveClass("whitespace-pre-wrap");
    expect(within(dialog).queryByRole("button", { name: "儲存根本原因" })).toBeNull();
  });

  it("根本原因已有內容時不顯示快速填寫", async () => {
    await setup("/records?open=3");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("textbox", { name: "根本原因" })).toBeNull();
  });

  it("刪除：直接移到回收桶（不問確定嗎）、關閉面板、出現「已移到回收桶〔復原〕」toast；復原呼叫 restore", async () => {
    const { user, spies } = await setup("/records?open=2");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "刪除" }));
    await waitFor(() => expect(spies.softDeleteRecord).toHaveBeenCalledWith(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("已移到回收桶")).toBeInTheDocument();
    await waitFor(() => expect(visibleProblems()).toEqual(["5", "4", "3", "1"])); // 列表不再有它
    expect(getCount(4, 4)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "復原" }));
    await waitFor(() => expect(spies.restoreRecord).toHaveBeenCalledWith(2));
    expect(await screen.findByText("已復原")).toBeInTheDocument();
    await waitFor(() => expect(visibleProblems()).toEqual(["5", "4", "3", "2", "1"]));
  });

  it("刪除失敗：錯誤 toast、面板不關", async () => {
    const { user, spies } = await setup("/records?open=2");
    spies.softDeleteRecord.mockRejectedValueOnce(new Error("刪除失敗了"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "刪除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("刪除失敗了");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("詳情：照片", () => {
  it("沒有照片 → 只顯示一行「未附照片」，沒有佔位框", async () => {
    await setup("/records?open=1");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("未附照片")).toBeInTheDocument();
    expect(dialog.querySelector("img")).toBeNull();
  });

  it("有照片 → 縮圖格＋圖說（有才顯示）；沒有「未附照片」", async () => {
    await setup("/records?open=5");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("未附照片")).toBeNull();
    expect(dialog.querySelectorAll("img")).toHaveLength(2);
    expect(within(dialog).getByText("模具表面裂痕")).toBeInTheDocument();
    expect(within(dialog).getByText("共 2 張照片")).toBeInTheDocument();
    expect((dialog.querySelector("img") as HTMLImageElement).getAttribute("src")).toBe("/photos/20261024/a.jpg");
  });

  it("燈箱：點縮圖開啟（圖說在照片下方）；←／→ 切換、Esc 只關燈箱並把焦點還給縮圖", async () => {
    const { user } = await setup("/records?open=5");
    const dialog = await screen.findByRole("dialog");
    const thumb = within(dialog).getByRole("button", { name: /放大照片 1/ });
    await user.click(thumb);
    const box = (await screen.findAllByRole("dialog")).find((d) => d.querySelector("img[alt='模具表面裂痕']"));
    expect(box).toBeDefined();
    expect(within(box!).getByText("模具表面裂痕")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(within(box!).getByRole("img")).toHaveAttribute("src", "/photos/20261024/b.jpg"));
    expect(within(box!).queryByText("模具表面裂痕")).toBeNull(); // 第二張沒有圖說
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(within(box!).getByRole("img")).toHaveAttribute("src", "/photos/20261024/a.jpg"));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.body.contains(box!)).toBe(false));
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // 詳情面板還在
    expect(query().get("open")).toBe("5");
    await waitFor(() => expect(thumb).toHaveFocus());
  });
});

describe("舊資料／欄位缺漏不會讓畫面當掉", () => {
  /** 搬遷來的舊紀錄可能沒有 photos、photoCaptions 欄位 */
  const legacy = () => {
    const r = makeRecord({ id: 9, date: "2026-10-26", time: "14:00", equipment: "F3 ", problem: "舊紀錄" });
    delete (r as Partial<typeof r>).photos;
    delete (r as Partial<typeof r>).photoCaptions;
    return r;
  };

  it("沒有 photos 欄位：桌面表格與詳情都正常（顯示「未附照片」）", async () => {
    mockApi([legacy()]);
    renderWithApp("/records?open=9");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("未附照片")).toBeInTheDocument();
    expect(document.querySelector('tr[data-record-id="9"]')).not.toBeNull();
  });

  it("沒有 photos 欄位：手機卡片也正常", async () => {
    setViewportWidth(375);
    mockApi([legacy()]);
    renderWithApp("/records");
    await screen.findByTestId("result-count");
    expect(document.querySelector('[data-record-id="9"]')).toHaveTextContent("舊紀錄");
  });

  it("設備名稱帶空白（\"F3 \"）：網址不會 trim，篩選精確命中那一筆", async () => {
    mockApi([legacy(), makeRecord({ id: 10, date: "2026-10-25", equipment: "F3", problem: "另一筆" })]);
    renderWithApp(`/records?equipment=${encodeURIComponent("F3 ")}`);
    await screen.findByTestId("result-count");
    expect(visibleProblems()).toEqual(["9"]);
    expect(screen.getByRole("button", { name: /^移除 設備：F3s*$/ })).toBeInTheDocument();
  });

  it("耗時欄不換行（三位數以上也是一行）", async () => {
    mockApi([makeRecord({ id: 11, duration: 120 })]);
    renderWithApp("/records");
    await screen.findByTestId("result-count");
    const cell = screen.getByText("120 分");
    expect(cell).toHaveClass("whitespace-nowrap");
  });
});

describe("手機版（< 768px）卡片清單", () => {
  beforeEach(() => setViewportWidth(375));

  it("每筆是一張卡片：問題、設備・分類・日期時間、狀態；整張可點開詳情", async () => {
    mockApi(sampleRecords());
    const user = userEvent.setup();
    renderWithApp("/records");
    await findCount(5, 5);
    expect(screen.queryByRole("table")).toBeNull();
    const card = document.querySelector('[data-record-id="4"]') as HTMLElement;
    expect(card).toHaveTextContent("感測器誤判");
    expect(card).toHaveTextContent("G5・設備異常・10/23 11:00");
    expect(card.querySelector("[data-status='待處理']")).not.toBeNull();
    await user.click(card);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(query().get("open")).toBe("4");
  });

  it("窄螢幕：設備下拉變成貼底的面板（dialog）", async () => {
    mockApi(sampleRecords());
    const user = userEvent.setup();
    renderWithApp("/records");
    await findCount(5, 5);
    await user.click(screen.getByRole("button", { name: "設備" }));
    const sheet = await screen.findByRole("dialog", { name: "選擇設備" });
    expect(within(sheet).getAllByRole("option")).toHaveLength(4);
  });
});
