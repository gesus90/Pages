import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

/** A point on the screen in viewport coordinates. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

interface AnchoredMenuProps {
  /** Where the menu opens; `null` keeps it closed. */
  readonly anchor: ScreenPoint | null;
  readonly label: string;
  readonly onClose: () => void;
  /** Gives the focus back, typically to the editor and its selection. */
  readonly onReturnFocus: () => void;
  readonly children: React.ReactNode;
}

/**
 * A menu that opens at a point instead of below a button: at the pointer
 * for a right click, at the caret for Shift+F10, or next to a block handle.
 * Arrow keys, Enter and Escape work as in every Pages menu.
 */
export function AnchoredMenu({
  anchor,
  label,
  onClose,
  onReturnFocus,
  children,
}: AnchoredMenuProps): React.ReactElement {
  return (
    // The point cannot be clicked, so the menu only ever reports closing.
    <DropdownMenu open={anchor !== null} onOpenChange={() => onClose()}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed size-px"
          style={{ left: anchor?.x ?? 0, top: anchor?.y ?? 0 }}
          tabIndex={-1}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        aria-label={label}
        // The trigger is an invisible point, so the menu is named by its
        // label instead of by the trigger.
        aria-labelledby={undefined}
        className="max-h-[min(36rem,80vh)] overflow-y-auto"
        collisionPadding={8}
        sideOffset={2}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
