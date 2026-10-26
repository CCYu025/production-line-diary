import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合併 class（後者覆蓋前者的 Tailwind 衝突）。shadcn/ui 慣用的 cn()。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
