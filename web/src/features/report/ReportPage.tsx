import { ExternalLink, FileText, Printer } from "lucide-react";
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/feedback";
import { useRecords } from "@/lib/queries";
import type { DiaryRecord } from "@/lib/types";
import { ReportDocument, type ReportData } from "./ReportDocument";
import {
  defaultReportRange,
  formatGeneratedAt,
  parseReportRangeParams,
  reversedReportRangeParams,
  selectReportRecords,
  validateReportRange,
  type ReportRange,
} from "./reportModel";
import { openReportWindow } from "./reportWindow";

const dateInputClass =
  "num h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface-raised px-3 text-sm text-ink-1 md:h-10";

/**
 * 這次開啟 App 之後最近一次產生的範圍（只存在記憶體，重新整理就沒了）。
 * 側欄的「列印報表」連結沒有帶範圍，離開再從側欄回來時靠它還原（舊 UI 切頁後報表還在）。
 */
let lastRange: ReportRange | null = null;
/** 測試用：清掉記憶的範圍 */
export function resetLastReportRange() {
  lastRange = null;
}

function snapshot(records: readonly DiaryRecord[], range: ReportRange): ReportData {
  return { ...range, records: selectReportRecords(records, range), generatedAt: formatGeneratedAt(new Date()) };
}

/**
 * 列印報表（docs/refactor-plan.md §4 U9）：選日期範圍 → 產生報表 → 列印／另存 PDF 或開新視窗。
 * 列印走瀏覽器內建的 window.print()（不裝 PDF／canvas 函式庫，理由見 CLAUDE.md）；
 * 列印時整個 App 外殼與所有浮層都隱藏，只印 #report-output（見 report.css 的 @media print）。
 *
 * 範圍放在網址（`#/report?from=…&to=…`）：按「產生報表」會把範圍寫進網址（push，上一頁可回到上一份報表），
 * 網址上有合法的範圍就自動產生——所以上一頁／下一頁、重新整理、書籤都還原得了報表。
 * 從側欄（沒帶範圍的連結）重新進入這一頁時，用這次開啟 App 後最近一次的範圍補回網址（replace，不卡住上一頁）。
 * 報表仍是「產生當下」的快照：資料之後變動不會自己改（還原時等於重新按一次「產生報表」，產出時間會更新）。
 */
export function ReportPage() {
  const { data: records, isPending, isError, error, refetch, isRefetching } = useRecords();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlRange = parseReportRangeParams(searchParams);
  // 網址上起 > 迄：不自動產生、也不換成別的範圍（不會悄悄退回上一份），只顯示驗證訊息、輸入框維持網址上的值
  const reversed = reversedReportRangeParams(searchParams);
  // 輸入框的值：網址有範圍就用網址的，否則預設今天的本地日期（不是 UTC）
  const [range, setRange] = React.useState<ReportRange>(() => urlRange ?? reversed ?? defaultReportRange());
  const [report, setReport] = React.useState<ReportData | null>(null);
  const reportRef = React.useRef<HTMLDivElement>(null);
  const recordsRef = React.useRef(records);
  recordsRef.current = records;
  const hasRecords = records !== undefined;
  const urlStart = urlRange?.start;
  const urlEnd = urlRange?.end;
  const reversedStart = reversed?.start;
  const reversedEnd = reversed?.end;
  const notifiedReversed = React.useRef<string | null>(null);

  // 剛進入這一頁、網址沒有範圍：沿用最近一次的範圍（只在進入當下做一次；之後上一頁退回沒有範圍的網址，就是空的）
  const restoredOnMount = React.useRef(false);
  React.useEffect(() => {
    if (restoredOnMount.current) return;
    restoredOnMount.current = true;
    if (!urlRange && !reversed && lastRange) setSearchParams({ from: lastRange.start, to: lastRange.end }, { replace: true });
  }, []);

  // 網址 → 輸入框＋報表。只在「網址的範圍」或「資料第一次載入完成」時跑，資料之後重抓不會讓報表自己改。
  // 自己按「產生報表」造成的網址變動，報表已經是那個範圍，不會重複產生。
  React.useEffect(() => {
    if (reversedStart !== undefined && reversedEnd !== undefined) {
      setReport(null);
      setRange((r) => (r.start === reversedStart && r.end === reversedEnd ? r : { start: reversedStart, end: reversedEnd }));
      const key = `${reversedStart}|${reversedEnd}`;
      if (notifiedReversed.current !== key) {
        notifiedReversed.current = key;
        const problem = validateReportRange({ start: reversedStart, end: reversedEnd });
        if (problem) notify.error(problem);
      }
      return;
    }
    notifiedReversed.current = null;
    if (urlStart === undefined || urlEnd === undefined) {
      setReport(null);
      return;
    }
    lastRange = { start: urlStart, end: urlEnd };
    setRange((r) => (r.start === urlStart && r.end === urlEnd ? r : { start: urlStart, end: urlEnd }));
    const all = recordsRef.current;
    if (!all) return;
    setReport((cur) => (cur && cur.start === urlStart && cur.end === urlEnd ? cur : snapshot(all, { start: urlStart, end: urlEnd })));
  }, [urlStart, urlEnd, reversedStart, reversedEnd, hasRecords]);

  function generate() {
    if (!records) return;
    const problem = validateReportRange(range);
    if (problem) {
      notify.error(problem);
      return;
    }
    // 重新按同一個範圍＝重新產生（更新資料與產出時間）；換範圍就寫進網址，effect 會接手顯示
    setReport(snapshot(records, range));
    lastRange = range;
    if (urlStart !== range.start || urlEnd !== range.end) {
      setSearchParams({ from: range.start, to: range.end });
    }
  }

  const printable = report !== null && report.records.length > 0;

  function openWindow() {
    const el = reportRef.current;
    if (!el) return;
    if (!openReportWindow(el.outerHTML)) {
      notify.error("瀏覽器擋住了新視窗，請允許彈出視窗後再試一次");
    }
  }

  return (
    <>
      <PageHeader
        className="print:hidden"
        title="列印報表"
        description="選擇日期範圍後按「產生報表」，內容包含根本原因、品號／原料類別與照片；產生後按「列印／另存 PDF」，在瀏覽器的列印對話框選擇「另存為 PDF」即可"
      />

      {isError ? (
        <ErrorState
          className="print:hidden"
          title="載入紀錄失敗"
          error={error}
          onRetry={() => void refetch()}
          retrying={isRefetching}
        />
      ) : (
        <form
          className="mb-5 max-w-2xl rounded-lg border border-line bg-surface-raised p-4 print:hidden md:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            generate();
          }}
        >
          <div className="flex flex-wrap items-end gap-3.5">
            <div className="flex min-w-36 flex-1 flex-col gap-1.5">
              <label htmlFor="report-start" className="text-sm font-medium text-ink-2">
                起始日期
              </label>
              <input
                id="report-start"
                type="date"
                className={dateInputClass}
                value={range.start}
                onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
              />
            </div>
            <div className="flex min-w-36 flex-1 flex-col gap-1.5">
              <label htmlFor="report-end" className="text-sm font-medium text-ink-2">
                結束日期
              </label>
              <input
                id="report-end"
                type="date"
                className={dateInputClass}
                value={range.end}
                onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={isPending} aria-busy={isPending}>
              <FileText aria-hidden="true" />
              產生報表
            </Button>
            <Button disabled={!printable} onClick={() => window.print()}>
              <Printer aria-hidden="true" />
              列印／另存 PDF
            </Button>
            <Button disabled={!printable} onClick={openWindow}>
              <ExternalLink aria-hidden="true" />
              開新視窗（方便截圖）
            </Button>
          </div>
        </form>
      )}

      {report ? <ReportDocument ref={reportRef} data={report} /> : null}
    </>
  );
}
