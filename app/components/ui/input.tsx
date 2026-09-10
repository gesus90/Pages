import { cn } from "@/app/lib/cn";

import type { InputHTMLAttributes } from "react";

/** Props accepted by the shared Pages text input. */
export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/** Renders a Pages-styled native input. */
export function Input({
  className,
  ...properties
}: InputProps): React.ReactElement {
  return (
    <input
      className={cn(
        "h-14 w-full rounded-xl bg-surface px-4 text-[1.0625rem] text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-70 xl:h-10 xl:px-3 xl:text-sm",
        className,
      )}
      {...properties}
    />
  );
}
