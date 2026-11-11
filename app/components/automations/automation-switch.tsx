import { cn } from "@/app/lib/cn";

interface AutomationSwitchProps {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange: () => void;
  readonly disabled?: boolean;
}

/**
 * The switch "Aktiv" of an automation, with the look of the settings
 * switches.
 */
export function AutomationSwitch({
  checked,
  label,
  onChange,
  disabled = false,
}: AutomationSwitchProps): React.ReactElement {
  function handleClick(event: React.MouseEvent<HTMLButtonElement>): void {
    // The switch sits in a clickable row; switching must not select it.
    event.stopPropagation();
    onChange();
  }

  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full shadow-control-edge transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "justify-end bg-primary" : "justify-start bg-muted",
      )}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={(event) => event.stopPropagation()}
      role="switch"
      type="button"
    >
      <span
        aria-hidden="true"
        className={cn(
          "mx-0.5 size-5 rounded-full shadow",
          checked ? "bg-toggle-thumb-active" : "bg-toggle-thumb",
        )}
      />
    </button>
  );
}
