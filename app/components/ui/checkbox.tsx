import { Check } from "lucide-react";
import { cn } from "@/app/lib/cn";
import type { ComponentProps } from "react";

/** Native, form-compatible checkbox using the shared semantic theme. */
export function Checkbox({
  className,
  ...properties
}: Omit<ComponentProps<"input">, "type" | "children">): React.ReactElement {
  return (
    <span className="relative inline-flex size-5 shrink-0">
      <input
        {...properties}
        type="checkbox"
        className={cn(
          "peer size-5 appearance-none rounded-md border border-muted-foreground/40 checked:border-primary checked:bg-primary disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
      />
      <Check
        className="pointer-events-none absolute top-0.5 left-0.5 hidden size-4 text-primary-foreground peer-checked:block"
        aria-hidden="true"
      />
    </span>
  );
}
