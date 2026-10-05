import { cn } from "@/app/lib/cn";

import type { ReactNode } from "react";

/** A single choice of a segmented control. */
export interface SegmentedControlOption<Value extends string = string> {
  readonly value: Value;
  readonly label: string;
  readonly icon?: ReactNode;
}

interface SegmentedControlProps<Value extends string> {
  readonly value: Value;
  readonly onValueChange: (value: Value) => void;
  readonly options: readonly SegmentedControlOption<Value>[];
  readonly ariaLabel: string;
  readonly className?: string;
}

/**
 * Renders the Pages segmented switch used for scopes and view modes.
 *
 * @remarks
 * Die Auswahl wechselt sofort den Seitenzustand, deshalb sind es
 * gedrückte Schalter statt Radix-Tabs: es gibt kein zugehöriges
 * Tab-Panel, das die Komponente selbst verwalten würde. Die Höhe
 * entspricht bewusst der Höhe von `Input` und `Select`, damit die
 * Filterzeile exakt auf einer Linie liegt.
 */
export function SegmentedControl<Value extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
}: SegmentedControlProps<Value>): React.ReactElement {
  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-9 items-center gap-0.5 rounded-xl bg-muted/70 p-1",
        className,
      )}
      role="group"
    >
      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <button
            aria-pressed={isActive}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-lg px-3 text-xs font-medium whitespace-nowrap transition-colors select-none",
              isActive
                ? "bg-surface text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
            key={option.value}
            onClick={() => onValueChange(option.value)}
            type="button"
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
