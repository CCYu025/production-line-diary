import { Plus, X } from "lucide-react";
import * as React from "react";
import { useBlocker } from "react-router-dom";
import { useConfirm } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isApiError } from "@/lib/api";
import { notify } from "@/lib/feedback";
import { useMeta, useSaveEquipmentMap } from "@/lib/queries";
import type { Meta } from "@/lib/types";
import { cn } from "@/lib/utils";
import { blankRow, cleanDraft, composeDraft, draftFromSaved, draftSignature, type DraftRow } from "./mapDraft";

const DESCRIPTION =
  "設定生產機台（F3/F4/G5/G6/F7/F8）目前對應的品號與原料類別，之後新增紀錄選了設備會自動帶入，換線時才需要回來改這裡。原材區、RB2 這類機構/區塊沒有自己的品號，不需要設定";

const inputClass =
  "h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface-raised px-3 text-base text-ink-1 " +
  "placeholder:text-ink-muted md:h-10 md:text-sm aria-[invalid=true]:border-critical";

export function SettingsPage() {
  const { data: meta, isPending, isError, error, refetch, isRefetching } = useMeta();

  return (
    <>
      <PageHeader title="設備對照設定" description={DESCRIPTION} />
      {isError ? (
        <ErrorState title="載入設定失敗" error={error} onRetry={() => void refetch()} retrying={isRefetching} />
      ) : isPending ? (
        <div role="status" aria-label="載入中" className="flex max-w-3xl flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        // 草稿只在「第一次拿到資料」時從 meta 組出來；之後 meta 因為別處的操作重抓，不會蓋掉正在編輯的內容。
        <EquipmentMapForm meta={meta} />
      )}
    </>
  );
}

function EquipmentMapForm({ meta }: { meta: Meta }) {
  const save = useSaveEquipmentMap();
  const confirm = useConfirm();
  const keyRef = React.useRef(0);
  const nextKey = React.useCallback(() => ++keyRef.current, []);

  const [rows, setRows] = React.useState<DraftRow[]>(() => composeDraft(meta.equipmentMap, nextKey));
  // 「已儲存的基準」：第一次打開時是組好的草稿（沒動就不算變更）；存檔成功後換成伺服器回傳的內容。
  const [baseline, setBaseline] = React.useState(() => draftSignature(rows));
  const [errors, setErrors] = React.useState<string[]>([]);
  const dirty = draftSignature(rows) !== baseline;
  const pendingFocus = React.useRef<string | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  /* ---- 離開頁面前提醒 ---- */
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  const asking = React.useRef(false);
  React.useEffect(() => {
    if (blocker.state !== "blocked" || asking.current) return;
    asking.current = true;
    void confirm({
      title: "要離開嗎？",
      description: "對照表有尚未儲存的變更，離開後這些變更會遺失。",
      confirmLabel: "離開，不儲存",
      cancelLabel: "留在這一頁",
      destructive: true,
    }).then((leave) => {
      asking.current = false;
      if (leave) blocker.proceed();
      else blocker.reset();
    });
  }, [blocker, confirm]);
  // 重新整理、關閉分頁
  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /* ---- 列的操作 ---- */
  React.useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    listRef.current?.querySelector<HTMLElement>(`[data-focus-id="${target}"]`)?.focus();
  });

  const update = (key: number, field: "equipment" | "productCode" | "materialCategory", value: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  const addRow = () => {
    const row = blankRow(nextKey());
    pendingFocus.current = `eq-${row.key}`;
    setRows((rs) => [...rs, row]);
  };

  const removeRow = (index: number) => {
    const neighbour = rows[index + 1] ?? rows[index - 1];
    pendingFocus.current = neighbour ? `eq-${neighbour.key}` : "add";
    setRows((rs) => rs.filter((_, i) => i !== index));
  };

  const onSave = async () => {
    setErrors([]);
    try {
      const saved = await save.mutateAsync(cleanDraft(rows));
      const next = draftFromSaved(saved, nextKey);
      setRows(next);
      setBaseline(draftSignature(next));
      notify.success("已儲存對照表");
    } catch (err) {
      // 伺服器的驗證訊息（400）留在表單上不會消失；其他（斷線、500）用錯誤 toast
      if (isApiError(err) && err.status === 400) setErrors(err.errors);
      else notify.error(err);
    }
  };

  const listId = React.useId();
  const productListId = `${listId}-products`;
  const materialListId = `${listId}-materials`;
  const errorId = `${listId}-errors`;

  return (
    <form
      className="max-w-3xl rounded-lg border border-line bg-surface-raised p-4 md:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave();
      }}
      aria-describedby={errors.length ? errorId : undefined}
    >
      <datalist id={productListId}>
        {meta.productCodes.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id={materialListId}>
        {meta.materialCategories.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>

      <div ref={listRef} className="flex flex-col gap-4 md:gap-2">
        <div
          aria-hidden="true"
          className="hidden grid-cols-[1fr_1fr_1fr_2.75rem] gap-2 px-0.5 text-xs font-medium text-ink-muted md:grid"
        >
          <span>設備代號</span>
          <span>品號</span>
          <span>原料類別</span>
          <span />
        </div>

        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong p-4 text-center text-sm text-ink-muted">
            目前沒有任何一列。按「＋ 新增一列」開始設定。
          </p>
        ) : null}

        {rows.map((row, i) => (
          <div
            key={row.key}
            role="group"
            aria-label={`第 ${i + 1} 列${row.equipment.trim() ? `：${row.equipment.trim()}` : ""}`}
            className={cn(
              // 手機：第一行「設備代號＋刪除鈕」，第二行「品號／原料類別」兩欄；桌面：四欄一列
              "grid grid-cols-[1fr_2.75rem] items-end gap-2 rounded-md border border-line bg-surface p-3",
              "md:grid-cols-[1fr_1fr_1fr_2.75rem] md:items-center md:border-0 md:bg-transparent md:p-0",
            )}
          >
            <Field label="設備代號" className="max-md:col-start-1 max-md:row-start-1">
              <input
                type="text"
                className={inputClass}
                placeholder="設備代號，例：F3"
                value={row.equipment}
                data-focus-id={`eq-${row.key}`}
                autoComplete="off"
                onChange={(e) => update(row.key, "equipment", e.target.value)}
              />
            </Field>
            <div className="col-span-2 row-start-2 grid grid-cols-2 gap-2 md:contents">
              <Field label="品號">
                <input
                  type="text"
                  className={inputClass}
                  placeholder="品號"
                  list={productListId}
                  value={row.productCode}
                  autoComplete="off"
                  onChange={(e) => update(row.key, "productCode", e.target.value)}
                />
              </Field>
              <Field label="原料類別">
                <input
                  type="text"
                  className={inputClass}
                  placeholder="原料類別"
                  list={materialListId}
                  value={row.materialCategory}
                  autoComplete="off"
                  onChange={(e) => update(row.key, "materialCategory", e.target.value)}
                />
              </Field>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="max-md:col-start-2 max-md:row-start-1"
              aria-label={`刪除第 ${i + 1} 列${row.equipment.trim() ? `（${row.equipment.trim()}）` : ""}`}
              title="刪除這一列"
              onClick={() => removeRow(i)}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>

      <Button className="mt-4" data-focus-id="add" onClick={addRow}>
        <Plus aria-hidden="true" />
        新增一列
      </Button>

      {errors.length > 0 ? (
        <div
          id={errorId}
          role="alert"
          className="mt-4 rounded-md border border-critical bg-surface p-3 text-sm"
        >
          <p className="font-bold text-critical">儲存失敗，請修正後再試一次</p>
          <ul className="mt-1 list-disc pl-5 text-ink-1">
            {errors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
        <Button type="submit" variant="primary" disabled={save.isPending} aria-busy={save.isPending}>
          {save.isPending ? "儲存中…" : "儲存對照表"}
        </Button>
        <p aria-live="polite" className="min-h-5 text-sm">
          {dirty ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-ink-1">
              <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
              有未儲存的變更
            </span>
          ) : (
            <span className="text-ink-muted">所有變更都已儲存</span>
          )}
        </p>
      </div>
    </form>
  );
}

/** 手機每個欄位都顯示標籤；桌面（有表頭）只留給螢幕閱讀器。 */
function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-xs font-medium text-ink-muted md:sr-only">{label}</span>
      {children}
    </label>
  );
}
