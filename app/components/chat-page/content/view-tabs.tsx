import { cn } from "@/app/lib/cn";

import type { LucideIcon } from "lucide-react";
import type { CardTone } from "./content-card";

/** One choice of a {@link ViewTabs} switch. */
export interface ViewTabOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  /** Shows the icon alone; the label stays the accessible name. */
  readonly icon?: LucideIcon;
}

interface ViewTabsProps<Value extends string> {
  /** The accessible name of the switch, such as "Ansicht". */
  readonly label: string;
  readonly options: readonly ViewTabOption<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
  readonly tone?: CardTone;
  readonly className?: string;
}

const TONE_CLASSES: Readonly<
  Record<CardTone, { readonly frame: string; readonly idle: string; readonly active: string }>
> = {
  light: {
    frame: "border-border bg-muted",
    idle: "text-muted-foreground hover:text-foreground",
    active: "bg-surface text-foreground shadow-xs",
  },
  dark: {
    frame: "border-viewer-edge bg-viewer-control",
    idle: "text-viewer-muted hover:text-viewer-foreground",
    active: "bg-viewer-control-hover text-viewer-foreground",
  },
};

/**
 * A small segmented switch of the card heads (PAGE-383): "Vorschau | Code",
 * "Ansicht | Quelltext", "Vorschau | Code | Beides", the device widths and
 * the files of a preview.
 */
export function ViewTabs<Value extends string>({
  label,
  options,
  value,
  onChange,
  tone = "light",
  className,
}: ViewTabsProps<Value>): React.ReactElement {
  const classes = TONE_CLASSES[tone];
  return (
    <div
      aria-label={label}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md border p-0.5",
        classes.frame,
        className,
      )}
      role="tablist"
    >
      {options.map((option) => {
        const isActive = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            aria-selected={isActive}
            className={cn(
              "inline-flex h-full items-center gap-1 rounded px-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-primary",
              isActive ? classes.active : classes.idle,
            )}
            onClick={() => onChange(option.value)}
            role="tab"
            title={Icon ? option.label : undefined}
            type="button"
          >
            {Icon ? (
              <>
                <Icon aria-hidden="true" className="size-3.5" />
                <span className="sr-only">{option.label}</span>
              </>
            ) : (
              option.label
            )}
          </button>
        );
      })}
    </div>
  );
}
