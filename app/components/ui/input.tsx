import { cn } from "@/app/lib/cn";

import type { InputHTMLAttributes } from "react";

/** Props accepted by the shared Pages text input. */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

/** Renders a Pages-styled native input. */
export function Input({
  className,
  ...properties
}: InputProps): React.ReactElement {
  return (
    <input
      className={cn(
        "h-14 w-full rounded-lg border bg-card px-4 text-[1.0625rem] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-70",
        className,
      )}
      {...properties}
    />
  );
}
