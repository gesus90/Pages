import { cn } from "@/app/lib/cn";

import type { ReactNode } from "react";

interface ToggleRowProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: () => void;
}

function ToggleSwitch({
  checked,
  label,
  onChange,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange: () => void;
}): React.ReactElement {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        checked ? "justify-end bg-primary" : "justify-start bg-muted",
      )}
      onClick={onChange}
      role="switch"
      type="button"
    >
      <span
        aria-hidden="true"
        className="mx-0.5 size-5 rounded-full bg-white shadow"
      />
    </button>
  );
}

/** A settings row with a title, a hint and a switch. */
export function ToggleRow({
  icon,
  title,
  description,
  checked,
  onChange,
}: ToggleRowProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl px-1 py-2.5 transition-colors hover:bg-muted/40">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="select-none text-sm font-medium text-foreground">
            {title}
          </p>
          <p className="mt-0.5 select-none text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <ToggleSwitch checked={checked} label={title} onChange={onChange} />
    </div>
  );
}
