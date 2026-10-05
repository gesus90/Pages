import { cva } from "class-variance-authority";

import { cn } from "@/app/lib/cn";

import type { ComponentProps } from "react";
import type { VariantProps } from "class-variance-authority";

/** Class names of the shared text input. */
const inputVariants = cva(
  "w-full rounded-xl text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-70",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default:
          "h-14 bg-surface px-4 text-[1.0625rem] shadow-xs xl:h-10 xl:px-3 xl:text-sm",
        // Fields of the login and setup pages with a leading icon (DESIGN.md §14.1).
        auth: "h-12 border border-field-border bg-field pr-4 pl-12 text-base hover:border-field-border-hover focus-visible:border-primary aria-invalid:ring-2 aria-invalid:ring-destructive/60 sm:h-14",
      },
    },
  },
);

/** Props accepted by the shared Pages text input. */
export type InputProps = ComponentProps<"input"> &
  VariantProps<typeof inputVariants>;

/** Renders a Pages-styled native input. */
export function Input({
  className,
  variant,
  ...properties
}: InputProps): React.ReactElement {
  return (
    <input
      className={cn(inputVariants({ variant }), className)}
      {...properties}
    />
  );
}
