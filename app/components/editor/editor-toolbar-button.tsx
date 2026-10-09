import { cn } from "@/app/lib/cn";
import { formatShortcut } from "@/app/lib/editor/editor-shortcuts";

import type { LucideIcon } from "lucide-react";
import type { EditorShortcut } from "@/app/lib/editor/editor-shortcuts";

interface EditorToolbarButtonProps {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly isApple: boolean;
  readonly shortcut?: EditorShortcut;
  /** Shows the button as switched on, for marks at the selection. */
  readonly isActive?: boolean;
  readonly isDisabled?: boolean;
  readonly onClick: () => void;
}

/**
 * A button of an editor toolbar. Pressing it keeps the selection of the
 * editor, so the action applies to what is selected.
 */
export function EditorToolbarButton({
  icon: Icon,
  label,
  isApple,
  shortcut,
  isActive,
  isDisabled = false,
  onClick,
}: EditorToolbarButtonProps): React.ReactElement {
  const name = shortcut
    ? `${label} (${formatShortcut(shortcut, isApple)})`
    : label;

  return (
    <button
      aria-label={name}
      aria-pressed={isActive}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted disabled:opacity-50 xl:size-8",
        isActive && "bg-primary-subtle text-primary",
      )}
      disabled={isDisabled}
      title={name}
      type="button"
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}

/**
 * Moves the focus between the buttons of a toolbar with the arrow keys, as
 * the toolbar pattern of WAI-ARIA describes.
 *
 * @param event - Key event of the toolbar.
 */
export function moveToolbarFocus(
  event: React.KeyboardEvent<HTMLElement>,
): void {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
    return;
  }

  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    ),
  ];
  const index = buttons.findIndex(
    (button) => button === document.activeElement,
  );
  const step = event.key === "ArrowRight" ? 1 : -1;

  event.preventDefault();
  buttons[(index + step + buttons.length) % buttons.length]?.focus();
}
