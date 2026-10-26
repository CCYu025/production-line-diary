import type * as React from "react";
import { cn } from "@/lib/utils";

/** 載入中的骨架。純裝飾，使用的地方要自己提供 aria-busy / 載入中文字給輔助科技。 */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden="true" className={cn("animate-skeleton rounded-md bg-line", className)} {...props} />;
}
