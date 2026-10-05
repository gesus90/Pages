import type { MouseEvent, ReactNode } from "react";

interface InlineEditTriggerProps {
  readonly className: string;
  readonly onStartEdit: () => void;
  readonly children: ReactNode;
}

/**
 * Shows text that turns into an input.
 *
 * @remarks
 * A pointer starts editing with a double click, so a single click can still
 * select the text. A keyboard starts it with Enter or Space, which browsers
 * report as a click without a pointer (`detail` is 0).
 */
export function InlineEditTrigger({
  className,
  onStartEdit,
  children,
}: InlineEditTriggerProps): React.ReactElement {
  function handleClick(event: MouseEvent<HTMLButtonElement>): void {
    if (event.detail === 0) {
      onStartEdit();
    }
  }

  return (
    <button
      className={className}
      onClick={handleClick}
      onDoubleClick={onStartEdit}
      type="button"
    >
      {children}
    </button>
  );
}
