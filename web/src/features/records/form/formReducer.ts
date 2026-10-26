import type { DiaryRecord } from "@/lib/types";
import {
  applyCopyToValues,
  copyInfoOf,
  initialNewValues,
  REVIEW_FIELDS,
  reviewFieldsAfterCopy,
  suggestSeverity,
  valuesFromRecord,
  type CopyInfo,
  type FieldErrors,
  type FieldName,
  type FormValues,
  type ReviewField,
} from "./model";

export interface FormState {
  values: FormValues;
  /** 「沒有動過」的比較基準：新增＝剛開啟（或剛清除）時的預設值；編輯＝紀錄原本的值。 */
  baseline: FormValues;
  /** 複製帶入後標「請確認」的欄位；使用者動過就移除，永遠不擋送出 */
  review: readonly ReviewField[];
  copy: CopyInfo | null;
  /** 嚴重度是否被使用者手動選過：沒有的話，改耗時會連動建議嚴重度；選過就不再覆蓋 */
  severityTouched: boolean;
  /** 日期／時間／班別區塊是否展開（預設收合成一行摘要） */
  dateOpen: boolean;
  errors: FieldErrors;
}

export type FormAction =
  | { type: "set"; field: keyof FormValues; value: string }
  | { type: "applyCopy"; record: DiaryRecord; lockDateTime: boolean; now?: Date }
  | { type: "undoCopy" }
  | { type: "reset"; now?: Date }
  | { type: "setErrors"; errors: FieldErrors }
  | { type: "setDateOpen"; open: boolean }
  | { type: "applySuggestedSeverity" };

export function initialNewState(now?: Date, copy?: { record: DiaryRecord; now?: Date }): FormState {
  const values = initialNewValues(now);
  const base: FormState = {
    values,
    baseline: values,
    review: [],
    copy: null,
    severityTouched: false,
    dateOpen: false,
    errors: {},
  };
  return copy ? formReducer(base, { type: "applyCopy", record: copy.record, lockDateTime: false, now: copy.now ?? now }) : base;
}

export function initialEditState(record: DiaryRecord): FormState {
  const values = valuesFromRecord(record);
  // 編輯既有紀錄時，嚴重度是當初存下的值，不跟著耗時自動變
  return { values, baseline: values, review: [], copy: null, severityTouched: true, dateOpen: false, errors: {} };
}

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "set": {
      const { field, value } = action;
      let values = { ...state.values, [field]: value } as FormValues;
      let severityTouched = state.severityTouched;
      if (field === "severity") severityTouched = true;
      if (field === "duration" && !severityTouched) {
        const suggested = suggestSeverity(value);
        if (suggested) values = { ...values, severity: suggested };
      }
      const review = (REVIEW_FIELDS as readonly string[]).includes(field)
        ? state.review.filter((f) => f !== field)
        : state.review;
      const errors = field in state.errors ? omit(state.errors, field) : state.errors;
      return { ...state, values, severityTouched, review, errors };
    }
    case "applySuggestedSeverity": {
      const suggested = suggestSeverity(state.values.duration);
      if (!suggested) return state;
      return { ...state, values: { ...state.values, severity: suggested }, severityTouched: false };
    }
    case "applyCopy": {
      const values = applyCopyToValues(state.values, action.record, {
        lockDateTime: action.lockDateTime,
        ...(action.now ? { now: action.now } : {}),
      });
      return {
        ...state,
        values,
        review: reviewFieldsAfterCopy(action.lockDateTime),
        copy: copyInfoOf(action.record),
        severityTouched: false,
        // 要使用者確認日期／時間時一定看得到「請確認」標記
        dateOpen: true,
        errors: {},
      };
    }
    case "undoCopy": {
      // 只清掉「帶入」的內容；日期／時間／設備與已上傳的照片不動（跟「清除」不同）
      const cleared = initialNewValues();
      return {
        ...state,
        values: {
          ...state.values,
          category: "",
          severity: cleared.severity,
          duration: "",
          problem: "",
          action: "",
          rootCause: "",
        },
        review: [],
        copy: null,
        severityTouched: false,
      };
    }
    case "reset":
      // 清除之後日期／時間回到「現在」（舊版這裡是空白，是 bug）
      return initialNewState(action.now);
    case "setErrors":
      return { ...state, errors: action.errors };
    case "setDateOpen":
      return { ...state, dateOpen: action.open };
  }
}

function omit(errors: FieldErrors, field: FieldName): FieldErrors {
  const next = { ...errors };
  delete next[field];
  return next;
}

export function isFormDirty(state: FormState): boolean {
  if (state.copy) return true;
  const keys = Object.keys(state.values) as Array<keyof FormValues>;
  return keys.some((k) => state.values[k] !== state.baseline[k]);
}
