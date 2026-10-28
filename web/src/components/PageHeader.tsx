import type * as React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  /** 頁首右側動作（例如儀表板的範圍切換） */
  actions?: React.ReactNode;
  className?: string;
}

/** 頁首。手機版標題已顯示在頂部標題列，這裡的 <h1> 只留給輔助科技（max-md:sr-only）。 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <h1 data-fx="page-title" className="text-xl font-bold max-md:sr-only">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
