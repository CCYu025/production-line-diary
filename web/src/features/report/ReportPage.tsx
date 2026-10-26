import { ExternalLink, FileText, Printer } from "lucide-react";
import * as React from "react";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/feedback";
import { useRecords } from "@/lib/queries";
import { ReportDocument, type ReportData } from "./ReportDocument";
import {
  defaultReportRange,
  formatGeneratedAt,
  selectReportRecords,
  validateReportRange,
} from "./reportModel";
import { openReportWindow } from "./reportWindow";

const dateInputClass =
  "num h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface-raised px-3 text-sm text-ink-1 md:h-10";

/**
 * 列印報表（docs/refactor-plan.md §4 U9）：選日期範圍 → 產生報表 → 列印／另存 PDF 或開新視窗。
 * 列印走瀏覽器內建的 window.print()（不裝 PDF／canvas 函式庫，理由見 CLAUDE.md）；
 * 列印時整個 App 外殼與所有浮層都隱藏，只印 #report-output（見 report.css 的 @media print）。
 * 報表是「按下產生當下」的快照——之後資料變動不會自己改，要重新按「產生報表」（與舊 UI 相同）。
 */
export function ReportPage() {
  const { data: records, isPending, isError, error, refetch, isRefetching } = useRecords();
  // 預設日期＝今天的本地日期（不是 UTC）
  const [range, setRange] = React.useState(() => defaultReportRange());
  const [report, setReport] = React.useState<ReportData | null>(null);
  const reportRef = React.useRef<HTMLDivElement>(null);

  function generate() {
    if (!records) return;
    const problem = validateReportRange(range);
    if (problem) {
      notify.error(problem);
      return;
    }
    setReport({
      ...range,
      records: selectReportRecords(records, range),
      generatedAt: formatGeneratedAt(new Date()),
    });
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
