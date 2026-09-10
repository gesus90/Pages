import { cn } from "@/app/lib/cn";

import type { TextareaHTMLAttributes } from "react";

/** Props accepted by the shared Pages textarea. */
export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Renders a Pages-styled native textarea. */
export function Textarea({
  className,
  ...properties
}: TextareaProps): React.ReactElement {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-xl bg-surface px-3.5 py-2.5 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...properties}
    />
  );
}
