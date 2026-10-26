import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { useBlocker, useNavigate, useSearchParams } from "react-router-dom";
import { Combobox, inputClass } from "@/components/Combobox";
import { useConfirm } from "@/components/ConfirmDialog";
import { SegmentedControl, type SegmentedOption } from "@/components/SegmentedControl";
import { SEVERITY_BG } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { api, errorMessage, isApiError } from "@/lib/api";
import { notify } from "@/lib/feedback";
import { useCreateRecord, useMeta, useRecords, useUpdateRecord } from "@/lib/queries";
import { queryKeys } from "@/lib/queryKeys";
import type { DiaryRecord, Meta, Severity, Status } from "@/lib/types";
import { SEVERITY_ORDER, STATUS_ORDER } from "@shared/aggregate";
import { CopyPicker } from "./CopyPicker";
import { DateTimeFields } from "./DateTimeFields";
import { Field, FieldError, fieldId, textareaClass } from "./fields";
import { formReducer, initialEditState, initialNewState, isFormDirty } from "./formReducer";
import {
  buildRecordInput,
  categorySuggestions,
  equipmentSuggestions,
  findEquipmentMapEntry,
  hasMapping,
  mapServerErrors,
  suggestSeverity,
  validateValues,
  type FieldErrors,
  type FieldName,
  type FormValues,
} from "./model";
import { PhotoField, type ExistingPhoto } from "./PhotoField";
import { usePhotoUploads } from "./usePhotoUploads";

/** 錯誤聚焦的順序＝畫面上由上到下的順序 */
const FOCUS_ORDER: FieldName[] = ["date", "time", "shift", "equipment", "productCode", "materialCategory", "problem", "category", "duration", "photos"];

const SEVERITY_OPTIONS: SegmentedOption<Severity>[] = SEVERITY_ORDER.map((s: Severity) => ({
  value: s,
  label: s,
  prefix: <span aria-hidden="true" className={`h-4 w-1.5 rounded-full ${SEVERITY_BG[s]}`} />,
}));

function StatusGlyph({ status }: { status: Status }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 shrink-0">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      {status === "追蹤中" && <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />}
      {status === "已解決" && <circle cx="8" cy="8" r="6" fill="currentColor" />}
    </svg>
  );
}

const STATUS_OPTIONS: SegmentedOption<Status>[] = STATUS_ORDER.map((s: Status) => ({
  value: s,
  label: s,
  prefix: <StatusGlyph status={s} />,
}));

export interface RecordFormProps {
  mode: "new" | "edit";
  /** 編輯模式：要修改的紀錄 */
  record?: DiaryRecord;
  /** 新增模式：從 `#/records/new?copy=<id>` 帶入的來源紀錄 */
  copyFrom?: DiaryRecord | null;
}

function toExisting(record: DiaryRecord | undefined): ExistingPhoto[] {
  return (record?.photos ?? []).map((filename) => ({ filename, caption: record?.photoCaptions?.[filename] ?? "" }));
}

/**
 * 新增／編輯共用的紀錄表單（docs/refactor-plan.md §4 U5）。
 * 欄位順序：設備 → 問題 → 問題分類 → 耗時（嚴重度自動建議）→ 處理 → 根本原因 → 處理狀態 → 照片。
 */
export function RecordForm({ mode, record, copyFrom }: RecordFormProps) {
  const isEdit = mode === "edit";
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const metaQuery = useMeta();
  const meta: Meta | undefined = metaQuery.data;
  const recordsQuery = useRecords();
  const create = useCreateRecord();
  const update = useUpdateRecord();
  const photos = usePhotoUploads();

  const [state, dispatch] = React.useReducer(formReducer, undefined, () =>
    isEdit && record ? initialEditState(record) : initialNewState(undefined, copyFrom ? { record: copyFrom } : undefined),
  );
  const { values, errors, review, copy, dateOpen } = state;

  // 編輯：紀錄原本的照片（可移除、可改說明）。移除只是「放掉參照」，存檔時伺服器才真的刪檔。
  const [existing, setExisting] = React.useState<ExistingPhoto[]>(() => toExisting(record));
  const originalExisting = React.useRef(existing);
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
  const [formErrors, setFormErrors] = React.useState<string[]>([]);
  const [focusRequest, setFocusRequest] = React.useState<{ field: FieldName; n: number } | null>(null);

  const dateLocked = photos.hasLive;
  const existingChanged =
    existing.length !== originalExisting.current.length ||
    existing.some((p, i) => p.filename !== originalExisting.current[i]?.filename || p.caption !== originalExisting.current[i]?.caption);
  const dirty = isFormDirty(state) || photos.items.some((p) => p.status !== "error") || existingChanged;

  /* ---------- 離開頁面前確認 ---------- */
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;
  const allowLeaveRef = React.useRef(false);
  // 離開確認選「繼續填寫」時，焦點要回到原本在填的欄位——點了側欄連結後 activeElement 已經是那個連結
  const lastFieldFocusRef = React.useRef<HTMLElement | null>(null);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current && !allowLeaveRef.current && currentLocation.pathname !== nextLocation.pathname,
  );
  React.useEffect(() => {
    if (blocker.state !== "blocked") return;
    void confirm({
      title: "離開這個頁面？",
      description: isEdit
        ? "尚未儲存的修改會遺失，本次新上傳但未儲存的照片也會一併刪除。"
        : "尚未送出的內容會遺失，已上傳但未送出的照片也會一併刪除。",
      confirmLabel: "離開",
      cancelLabel: isEdit ? "繼續編輯" : "繼續填寫",
      destructive: true,
      returnFocusTo: lastFieldFocusRef.current,
    }).then((ok) => {
      if (ok) blocker.proceed();
      else blocker.reset();
    });
    // blocker 物件每次 render 都會換，deps 只放 state
  }, [blocker.state]);

  React.useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  /* ---------- 焦點 ---------- */
  React.useEffect(() => {
    if (!focusRequest) return;
    const el = document.getElementById(fieldId(focusRequest.field));
    el?.focus();
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [focusRequest]);
  const requestFocus = (field: FieldName) => setFocusRequest((prev) => ({ field, n: (prev?.n ?? 0) + 1 }));

  /* ---------- 複製既有紀錄 ---------- */
  const clearCopyParam = React.useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("copy");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const doApplyCopy = React.useCallback(
    (rec: DiaryRecord, focus = true) => {
      // 已上傳照片時不可改日期／時間／班別（照片依當時日期存放）
      dispatch({ type: "applyCopy", record: rec, lockDateTime: photos.hasLive });
      setFormErrors([]);
      if (focus) requestFocus("equipment");
    },
    [photos.hasLive],
  );

  // `?copy=` 在同一個畫面上又換成另一筆（例如在列表按了另一筆的〔複製〕）：重新帶入
  const appliedCopyId = React.useRef<number | null>(copyFrom?.id ?? null);
  React.useEffect(() => {
    if (isEdit) return;
    if (!copyFrom) {
      appliedCopyId.current = null;
      return;
    }
    if (appliedCopyId.current === copyFrom.id) return;
    appliedCopyId.current = copyFrom.id;
    doApplyCopy(copyFrom);
  }, [copyFrom, isEdit, doApplyCopy]);

  const pickFromPicker = (rec: DiaryRecord) => {
    doApplyCopy(rec);
    clearCopyParam();
  };

  const undoCopy = () => {
    dispatch({ type: "undoCopy" });
    clearCopyParam();
  };

  /* ---------- 清除（新增）／取消（編輯） ---------- */
  const reset = () => {
    photos.abandonAll(); // 中止上傳中的、刪掉已上傳未送出的
    dispatch({ type: "reset" }); // 日期／時間回到「現在」
    setFormErrors([]);
    clearCopyParam();
    requestFocus("equipment");
  };

  const cancelEdit = () => {
    // replace：取消後上一頁不要又回到編輯表單
    if (record) navigate(`/records?open=${record.id}`, { replace: true });
    else navigate("/records");
  };

  /* ---------- 欄位更新 ---------- */
  const set = (field: keyof FormValues) => (value: string) => dispatch({ type: "set", field, value });

  /* ---------- 照片 ---------- */
  const onFiles = (files: File[]) => {
    const images = files.filter((f) => f.type === "" || f.type.startsWith("image/"));
    if (!images.length) {
      notify.error("請選擇圖片檔");
      return;
    }
    if (!values.date) {
      dispatch({ type: "setDateOpen", open: true });
      notify.error("請先選擇日期，再新增照片");
      requestFocus("date");
      return;
    }
    void photos.addFiles(images, values.date);
  };

  /* ---------- 送出 ---------- */
  const failWith = (errs: FieldErrors) => {
    dispatch({ type: "setErrors", errors: errs });
    if (errs.date || errs.time || errs.shift) dispatch({ type: "setDateOpen", open: true });
    const first = FOCUS_ORDER.find((f) => errs[f]);
    if (first) requestFocus(first);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    // 每次送出都先清掉上一次的欄位錯誤（含伺服器回的），免得舊錯誤和新錯誤混在一起
    dispatch({ type: "setErrors", errors: {} });
    setFormErrors([]);
    if (photos.uploading) {
      notify.error("照片還在上傳中，請稍候");
      return;
    }
    const errs = validateValues(values);
    if (Object.keys(errs).length) {
      setFormErrors([]);
      failWith(errs);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setFormErrors([]);
    try {
      let equipmentMap = meta?.equipmentMap;
      if (!isEdit) {
        // 品號／原料類別是「建立當下」的設備對照快照：送出前抓最新的對照表；抓不到又沒有舊的就不送出，免得悄悄存成空白
        try {
          equipmentMap = (await queryClient.fetchQuery({ queryKey: queryKeys.meta, queryFn: () => api.getMeta(), staleTime: 0 }))
            .equipmentMap;
        } catch (err) {
          if (!equipmentMap) {
            notify.error(`無法取得設備對照表，先不送出，免得品號／原料類別漏帶：${errorMessage(err)}`);
            return;
          }
        }
      }
      const photoList = [
        ...existing,
        ...photos.items
          .filter((p) => p.status === "uploaded" && p.filename)
          .map((p) => ({ filename: p.filename as string, caption: p.caption })),
      ];
      const input = buildRecordInput(values, { mode, equipmentMap, photos: photoList });

      if (isEdit && record) {
        await update.mutateAsync({ id: record.id, input });
        allowLeaveRef.current = true;
        photos.commit();
        notify.success("已儲存變更");
        // replace：儲存後按上一頁不要回到（已經存完的）編輯表單
        navigate(`/records?open=${record.id}`, { replace: true });
      } else {
        const created = await create.mutateAsync(input);
        allowLeaveRef.current = true;
        photos.commit();
        notify.success("已新增紀錄，儀表板已自動更新", {
          action: { label: "查看", onClick: () => navigate(`/records?open=${created.id}`) },
        });
        navigate("/dashboard");
      }
    } catch (err) {
      const apiErrors = isApiError(err) ? err.errors : [errorMessage(err)];
      const { fields, general } = mapServerErrors(apiErrors);
      setFormErrors(general);
      if (Object.keys(fields).length) failWith(fields);
      notify.error(err);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  /* ---------- 衍生資料 ---------- */
  const equipmentOptions = React.useMemo(() => equipmentSuggestions(meta), [meta]);
  const categoryOptions = React.useMemo(() => categorySuggestions(meta), [meta]);
  const mapping = isEdit ? undefined : findEquipmentMapEntry(meta?.equipmentMap, values.equipment);
  const suggested = suggestSeverity(values.duration);
  const showSuggestHint = !!suggested && state.severityTouched && suggested !== values.severity;
  const pendingReview = review.length;
  const allRecords = recordsQuery.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {!isEdit ? <CopyPicker records={allRecords} onPick={pickFromPicker} /> : null}

      {copy ? (
        <div
          role="status"
          className="flex flex-col gap-1.5 rounded-lg border border-serious bg-serious-wash p-3 text-sm"
          data-testid="copy-banner"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              已帶入自{" "}
              <b>
                {copy.dateLabel} {copy.equipment}・{copy.problem}
              </b>
            </span>
            <Button variant="secondary" size="sm" className="ml-auto" onClick={undoCopy}>
              清除帶入
            </Button>
          </div>
          <p className="text-xs text-ink-2 [overflow-wrap:anywhere]">處理與根本原因是沿用舊紀錄的內容，請確認是否適用這次事件</p>
        </div>
      ) : null}

      <form
        noValidate
        onFocus={(e) => {
          lastFieldFocusRef.current = e.target instanceof HTMLElement ? e.target : null;
        }}
        onSubmit={(e) => void onSubmit(e)} aria-label={isEdit ? "編輯紀錄" : "新增紀錄"} className="flex flex-col gap-5">
        <DateTimeFields
          values={values}
          errors={errors}
          review={review}
          open={dateOpen}
          onOpenChange={(open) => dispatch({ type: "setDateOpen", open })}
          dateLocked={dateLocked}
          onChange={(field, value) => dispatch({ type: "set", field, value })}
        />

        <Field
          name="equipment"
          label="設備"
          hint="可直接輸入新的設備代號"
          error={errors.equipment}
          review={review.includes("equipment")}
        >
          {(p) => (
            <Combobox
              {...p}
              value={values.equipment}
              onValueChange={set("equipment")}
              options={equipmentOptions}
              placeholder="選擇或輸入設備代號…"
            />
          )}
        </Field>

        {!isEdit && hasMapping(mapping) ? (
          <div className="flex min-w-0 flex-col gap-1.5" data-testid="mapping-preview">
            <span className="text-sm font-bold">品號 / 原料類別</span>
            {/* min-w-0＋overflow-wrap:anywhere：很長的品號（沒有空白可斷行）在 320 寬也不會撐出畫面 */}
            <div className="num flex w-fit min-w-0 max-w-full flex-wrap gap-x-4 gap-y-1 rounded-md border border-line bg-surface px-3 py-2 text-sm">
              {mapping.productCode ? <span className="min-w-0 [overflow-wrap:anywhere]">品號 {mapping.productCode}</span> : null}
              {mapping.materialCategory ? <span className="min-w-0 [overflow-wrap:anywhere]">原料 {mapping.materialCategory}</span> : null}
            </div>
            <p className="text-xs text-ink-muted">依「設備對照設定」自動帶入，例外情形請於送出後至編輯畫面調整</p>
          </div>
        ) : null}

        {isEdit ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Field name="productCode" label="品號" error={errors.productCode}>
              {(p) => (
                <Combobox
                  {...p}
                  value={values.productCode}
                  onValueChange={set("productCode")}
                  options={meta?.productCodes ?? []}
                />
              )}
            </Field>
            <Field name="materialCategory" label="原料類別" error={errors.materialCategory}>
              {(p) => (
                <Combobox
                  {...p}
                  value={values.materialCategory}
                  onValueChange={set("materialCategory")}
                  options={meta?.materialCategories ?? []}
                />
              )}
            </Field>
          </div>
        ) : null}

        <Field name="problem" label="問題" error={errors.problem}>
          {(p) => (
            <input
              {...p}
              type="text"
              value={values.problem}
              onChange={(e) => set("problem")(e.target.value)}
              placeholder="描述發生的問題…"
              className={inputClass}
            />
          )}
        </Field>

        <Field name="category" label="問題分類" hint="可直接輸入新分類，沒填會存成「其他」" error={errors.category}>
          {(p) => (
            <Combobox
              {...p}
              value={values.category}
              onValueChange={set("category")}
              options={categoryOptions}
              placeholder="選擇或輸入分類…"
            />
          )}
        </Field>

        <div className="grid gap-4 md:grid-cols-[11rem_1fr]">
          <Field name="duration" label="耗時" hint="分鐘，整數" error={errors.duration} review={review.includes("duration")}>
            {(p) => (
              <input
                {...p}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={values.duration}
                onChange={(e) => set("duration")(e.target.value)}
                placeholder="例：10"
                className={`${inputClass} num`}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-bold">
              嚴重度{" "}
              <span className="text-xs font-normal text-ink-muted">
                {state.severityTouched ? "已手動選擇" : "依耗時自動建議，可自行調整"}
              </span>
            </span>
            <SegmentedControl
              label="嚴重度"
              value={values.severity}
              onChange={(v) => set("severity")(v)}
              options={SEVERITY_OPTIONS}
            />
            {showSuggestHint ? (
              <p className="text-xs text-ink-2">
                依耗時建議為「{suggested}」{" "}
                <button
                  type="button"
                  className="font-medium text-accent-text underline underline-offset-2"
                  onClick={() => dispatch({ type: "applySuggestedSeverity" })}
                >
                  改用建議
                </button>
              </p>
            ) : null}
          </div>
        </div>

        <Field name="action" label="處理" error={errors.action}>
          {(p) => (
            <textarea
              {...p}
              value={values.action}
              onChange={(e) => set("action")(e.target.value)}
              placeholder="描述現場處理方式…"
              className={textareaClass}
            />
          )}
        </Field>

        <Field
          name="rootCause"
          label={
            <>
              根本原因 <span className="text-xs font-normal text-ink-muted">選填，可稍後於詳情面板補填</span>
            </>
          }
          error={errors.rootCause}
        >
          {(p) => (
            <textarea
              {...p}
              value={values.rootCause}
              onChange={(e) => set("rootCause")(e.target.value)}
              placeholder="例如：模具脫模劑濃度不足…"
              className={textareaClass}
            />
          )}
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold">
            處理狀態
          </span>
          <SegmentedControl
            label="處理狀態"
            value={values.status}
            onChange={(v) => set("status")(v)}
            options={STATUS_OPTIONS}
          />
        </div>

        <PhotoField
          {...(isEdit
            ? {
                existing,
                originalDate: record?.date ?? values.date,
                onRemoveExisting: (filename: string) => setExisting((list) => list.filter((p) => p.filename !== filename)),
                onExistingCaption: (filename: string, caption: string) =>
                  setExisting((list) => list.map((p) => (p.filename === filename ? { ...p, caption } : p))),
              }
            : {})}
          uploads={photos.items}
          onRemoveUpload={photos.remove}
          onUploadCaption={photos.setCaption}
          onFiles={onFiles}
          capture={!isEdit}
          error={errors.photos}
        />

        {formErrors.length ? (
          <div className="flex flex-col gap-1" data-testid="form-errors">
            {formErrors.map((m) => (
              <FieldError key={m}>{m}</FieldError>
            ))}
          </div>
        ) : null}

        {/* 手機：固定在底部分頁列上方（max-md:pb-8 讓出中央凸出的 ＋ 按鈕）；桌面：接在表單後面 */}
        <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 -mx-4 flex flex-col gap-2 border-t border-line bg-page/95 px-4 pb-8 pt-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
          {pendingReview > 0 ? (
            <p className="text-xs font-medium text-ink-2" data-testid="review-pending">
              還有 {pendingReview} 個欄位待確認（不會擋住送出）
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            {isEdit ? (
              <Button variant="secondary" onClick={cancelEdit}>
                取消
              </Button>
            ) : (
              <Button variant="secondary" onClick={reset}>
                清除
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              className="max-md:flex-1 md:min-w-36"
              disabled={submitting || photos.uploading}
              aria-busy={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  {isEdit ? "儲存中…" : "送出中…"}
                </>
              ) : photos.uploading ? (
                "照片上傳中…"
              ) : isEdit ? (
                "儲存變更"
              ) : (
                "新增紀錄"
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
