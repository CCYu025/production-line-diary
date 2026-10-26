import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium",
    "transition-colors disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink font-bold hover:brightness-110 active:brightness-95",
        secondary: "border border-line-strong bg-surface-raised text-ink-1 hover:bg-surface",
        ghost: "text-ink-2 hover:bg-surface-raised hover:text-ink-1",
        destructive: "bg-critical text-critical-ink font-bold hover:brightness-110 active:brightness-95",
        link: "text-accent-text underline-offset-4 hover:underline",
      },
      // 手機（< md）觸控目標至少 44px；桌面可以緊湊一點。
      size: {
        default: "h-11 px-4 md:h-10",
        sm: "h-11 px-3 text-sm md:h-9",
        lg: "h-12 px-5 text-base",
        icon: "size-11 md:size-10",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  /** 把樣式套到子元素上（例如 <Link>），維持真正的 <a>／<button> 語意。 */
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...props}
    />
  );
}
