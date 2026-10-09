import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useFloatingStyle } from "@/app/components/editor/menus/use-floating-style";

interface FloatingPanelProps {
  /** Where the panel belongs; `null` keeps it closed. */
  readonly anchor: DOMRect | null;
  readonly label: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}

/**
 * A small dialog next to a point of the page, such as the emoji picker at
 * the caret. Escape and a click outside close it.
 */
export function FloatingPanel({
  anchor,
  label,
  onClose,
  children,
}: FloatingPanelProps): React.ReactElement | null {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const style = useFloatingStyle(element, anchor);

  useEffect(() => {
    if (anchor === null) {
      return undefined;
    }

    const closeOnOutside = (event: PointerEvent): void => {
      if (
        element &&
        event.target instanceof Node &&
        !element.contains(event.target)
      ) {
        onClose();
      }
    };

    document.addEventListener("pointerdown", closeOnOutside);

    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [anchor, element, onClose]);

  if (anchor === null) {
    return null;
  }

  return createPortal(
    <div
      ref={setElement}
      aria-label={label}
      className="pages-floating-panel z-50 p-2"
      role="dialog"
      style={style}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
