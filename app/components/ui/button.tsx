import { cva } from "class-variance-authority";

import { cn } from "@/app/lib/cn";

import type { ButtonHTMLAttributes } from "react";
import type { VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-70",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[#fca974]",
        ghost: "bg-transparent text-foreground hover:bg-muted",
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
