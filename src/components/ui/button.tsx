import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[transform,background-color,color,box-shadow,opacity] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/50 disabled:pointer-events-none disabled:opacity-40 active:not-disabled:scale-[0.96] select-none",
  {
    variants: {
      variant: {
        solid: "bg-active text-active-ink shadow-border hover:bg-active/90",
        ghost: "bg-transparent text-muted hover:bg-surface-2 hover:text-fg",
        outline:
          "bg-surface text-fg shadow-border hover:shadow-border-hover hover:text-active",
        subtle: "bg-surface-2 text-muted hover:bg-active-soft hover:text-fg",
      },
      size: {
        sm: "h-9 px-3 text-xs tracking-wide",
        md: "h-10 px-3.5 text-sm",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "sm",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
