import { cva } from "class-variance-authority";

import { cn } from "@/app/lib/cn";

import type { ButtonHTMLAttributes } from "react";
import type { VariantProps } from "class-variance-authority";

/** Class names of the shared button, for links that look like a button. */
export const buttonVariants = cva(
  "inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-lg px-4 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-70 xl:min-h-9 xl:gap-1.5 xl:px-3 xl:text-sm",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        ghost: "bg-transparent text-foreground hover:bg-muted",
        // Primary action of the login and setup pages only (DESIGN.md §14.1).
        auth: "pages-auth-button h-12 w-full rounded-xl px-6 text-base text-primary-foreground sm:h-14 xl:px-6 xl:text-base",
        outline: "bg-surface text-foreground shadow-xs hover:bg-surface-hover",
      },
    },
  },
);

/** Props accepted by the shared Pages button. */
export interface ButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

/** Renders a Pages-styled native button. */
export function Button({
  className,
  type = "button",
  variant,
  ...properties
}: ButtonProps): React.ReactElement {
  return (
    <button
      className={cn(buttonVariants({ variant }), className)}
      type={type}
      {...properties}
    />
  );
}
