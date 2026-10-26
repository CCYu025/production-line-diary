import { ArrowDown, ArrowUp, Camera, Copy } from "lucide-react";
import * as React from "react";
import { SEVERITY_BG, SeverityBadge, StatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DiaryRecord } from "@/lib/types";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import { mdLabel } from "./filterUtils";

interface RecordListProps {
  rows: readonly DiaryRecord[];
  sortDesc: boolean;
  onToggleSort: () => void;
  /** trigger：被點的那一列（詳情關閉後焦點要回到它） */
  onOpen: (id: number, trigger: HTMLElement) => void;
  onCopy: (id: number) => void;
}

/** 桌面 ≥ 768px 用表格；手機改卡片清單（docs/refactor-plan.md §4 U3）。 */
export function RecordList(props: RecordListProps) {
  const isWide = useMediaQuery("(min-width: 768px)");
  return isWide ? <RecordTable {...props} /> : <RecordCards {...props} />;
}

function PhotoCount({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5 text-xs text-ink-muted", className)} title={`${count} 張照片`}>
      <Camera className="size-3.5" aria-hidden="true" />
      <span className="num" aria-hidden="true">
        {count}
      </span>
      <span className="sr-only">{count} 張照片</span>
    </span>
  );
}

/** 整列（或整張卡片）可用滑鼠或鍵盤（Enter / 空白鍵）開啟詳情；內部的按鈕（複製）不觸發。 */
function openHandlers(onOpen: RecordListProps["onOpen"], id: number) {
  return {
    onClick: (e: React.MouseEvent<HTMLElement>) => onOpen(id, e.currentTarget),
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpen(id, e.currentTarget);
      }
    },
  };
}

function RecordTable({ rows, sortDesc, onToggleSort, onOpen, onCopy }: RecordListProps) {
  const SortIcon = sortDesc ? ArrowDown : ArrowUp;
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface-raised">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">紀錄列表（按 Enter 開啟詳情）</caption>
        <colgroup>
          <col className="w-[6rem]" />
          <col className="w-[4.25rem]" />
          <col className="w-[5rem]" />
          <col />
          <col className="w-[4.25rem]" />
          <col className="w-[4.75rem]" />
          <col className="w-[6.25rem]" />
          <col className="w-[2.75rem]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line bg-surface text-left text-xs font-medium text-ink-muted">
            <th scope="col" aria-sort={sortDesc ? "descending" : "ascending"} className="p-0">
              <button
                type="button"
                onClick={onToggleSort}
                className="flex min-h-10 w-full items-center gap-1 px-2 text-left hover:text-ink-1"
                aria-label={`日期時間，目前${sortDesc ? "新到舊" : "舊到新"}，按一下切換排序`}
              >
                日期時間
                <SortIcon className="size-3.5" aria-hidden="true" />
              </button>
            </th>
            <th scope="col" className="px-2 py-2">設備</th>
            <th scope="col" className="px-2 py-2">分類</th>
            <th scope="col" className="px-2 py-2">問題</th>
            <th scope="col" className="px-2 py-2 text-right">耗時</th>
            <th scope="col" className="px-2 py-2">嚴重度</th>
            <th scope="col" className="px-2 py-2">狀態</th>
            <th scope="col" className="px-2 py-2">
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              data-record-id={r.id}
              tabIndex={0}
              {...openHandlers(onOpen, r.id)}
              className="cursor-pointer border-b border-line last:border-b-0 hover:bg-surface"
            >
              <td className="px-2 py-2.5 align-top">
                <span className="num block text-[13px] leading-5">{mdLabel(r.date)}</span>
                <span className="num block whitespace-nowrap text-xs leading-5 text-ink-muted">
                  {r.time}・{r.shift}班
                </span>
              </td>
              <td className="truncate px-2 py-2.5 align-top" title={r.equipment}>
                {r.equipment}
              </td>
              <td className="truncate px-2 py-2.5 align-top" title={r.category}>
                {r.category}
              </td>
              <td className="px-2 py-2.5 align-top">
                <div className="flex items-start gap-1.5">
                  <span className="line-clamp-2 min-w-0 flex-1 whitespace-normal break-words font-medium" title={r.problem}>
                    {r.problem}
                  </span>
                  <PhotoCount count={(r.photos ?? []).length} className="mt-0.5" />
                </div>
              </td>
              <td className="num whitespace-nowrap px-2 py-2.5 text-right align-top">{r.duration} 分</td>
              <td className="px-1.5 py-2 align-top">
                <SeverityBadge severity={r.severity} />
              </td>
              <td className="px-1.5 py-2 align-top">
                <StatusBadge status={r.status} />
              </td>
              <td className="p-0 text-center align-top">
                <CopyButton onCopy={() => onCopy(r.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CopyButton({ onCopy }: { onCopy: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="複製這筆當新紀錄"
          onClick={(e) => {
            e.stopPropagation(); // 不要同時觸發整列的「開詳情」
            onCopy();
          }}
        >
          <Copy aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>複製這筆當新紀錄</TooltipContent>
    </Tooltip>
  );
}

function RecordCards({ rows, onOpen }: RecordListProps) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            data-record-id={r.id}
            onClick={(e) => onOpen(r.id, e.currentTarget)}
            className="relative block w-full overflow-hidden rounded-lg border border-line bg-surface-raised py-3 pl-5 pr-3 text-left active:bg-surface"
          >
            <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-1.5", SEVERITY_BG[r.severity])} />
            <span className="flex items-start justify-between gap-3">
              <span className="line-clamp-2 min-w-0 flex-1 break-words font-bold">{r.problem}</span>
              <StatusBadge status={r.status} className="shrink-0" />
            </span>
            <span className="mt-1 block truncate text-sm text-ink-2">
              {r.equipment}・{r.category}・<span className="num">{mdLabel(r.date)} {r.time}</span>
            </span>
            <span className="mt-1 flex items-center gap-3 text-xs text-ink-muted">
              <span>
                <span className="sr-only">嚴重度 </span>
                {r.severity}
              </span>
              <span className="num">{r.duration} 分</span>
              <PhotoCount count={(r.photos ?? []).length} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
