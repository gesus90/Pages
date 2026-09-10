import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/app/lib/cn";

import type { ReactNode } from "react";

interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
  /** Optional leading icon shown in the trigger and the option row. */
  readonly icon?: ReactNode;
  /**
   * Optional explanatory text shown below the option label.
   *
   * @remarks
   * Rendered `aria-hidden` so the accessible option name stays the label.
   */
  readonly description?: string;
}

interface SelectProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly placeholder?: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly id?: string;
}

// Radix Select items require non-empty values, so empty-string options
// (used for "none" / "unassigned") are mapped to a private sentinel.
const EMPTY_OPTION_SENTINEL = "__pages_empty_option__";

function toRadixValue(value: string): string {
  if (value === "") {
    return EMPTY_OPTION_SENTINEL;
  }

  return value;
}

function fromRadixValue(value: string): string {
  if (value === EMPTY_OPTION_SENTINEL) {
    return "";
  }

  return value;
}

/**
 * Renders a Pages-styled select built on Radix UI.
 *
 * @remarks
 * Fachlicher Code soll diese Abstraktion verwenden statt
 * `Select.Root` direkt zu nutzen oder native `select`-Elemente
 * mit duplizierten Klassen zu pflegen.
 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  ariaLabel,
  disabled = false,
  className,
  id,
}: SelectProps): React.ReactElement {
  function handleValueChange(nextValue: string): void {
    onValueChange(fromRadixValue(nextValue));
  }

  const selectedIcon = options.find(
    (option) => toRadixValue(option.value) === toRadixValue(value),
  )?.icon;

  return (
    <SelectPrimitive.Root
      value={toRadixValue(value)}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-9 max-w-full items-center justify-between gap-2 rounded-lg bg-card px-2.5 text-xs font-medium text-foreground shadow-xs outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
      >
        {selectedIcon ? (
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex shrink-0 items-center" aria-hidden="true">
              {selectedIcon}
            </span>
            <SelectPrimitive.Value placeholder={placeholder} />
          </span>
        ) : (
          <SelectPrimitive.Value placeholder={placeholder} />
        )}
        <SelectPrimitive.Icon asChild>
          <ChevronDown
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="z-50 max-h-72 min-w-40 overflow-hidden rounded-xl bg-surface p-1 shadow-panel outline-none"
          position="popper"
          sideOffset={6}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value === "" ? EMPTY_OPTION_SENTINEL : option.value}
                value={toRadixValue(option.value)}
                disabled={option.disabled}
                className={cn(
                  "flex min-h-8 cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted",
                  option.description && "items-start py-2",
                )}
              >
                {option.icon ? (
                  <span
                    className="flex shrink-0 items-center pt-0.5"
                    aria-hidden="true"
                  >
                    {option.icon}
                  </span>
                ) : null}
                <span className="flex min-w-0 flex-1 flex-col">
                  <SelectPrimitive.ItemText>
                    {option.label}
                  </SelectPrimitive.ItemText>
                  {option.description ? (
                    <span
                      className="text-xs leading-relaxed font-normal text-muted-foreground"
                      aria-hidden="true"
                    >
                      {option.description}
                    </span>
                  ) : null}
                </span>
                <SelectPrimitive.ItemIndicator>
                  <Check className="size-3.5 text-primary" aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
