import { useEffect, useRef, useState } from "react";

/** Local, read-only disclosure state; pointer activation pins hover or focus details. */
export function useChatContextDetails(): {
  readonly container: React.RefObject<HTMLSpanElement | null>;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  toggle(): void;
  handlePointerEnter(event: React.PointerEvent<HTMLSpanElement>): void;
  handleMouseEnter(): void;
  handlePointerLeave(): void;
} {
  const container = useRef<HTMLSpanElement>(null);
  const isPinned = useRef(false);
  const isTouch = useRef(false);
  const [isOpen, setIsOpen] = useState(false);

  function open(): void {
    setIsOpen(true);
  }

  function close(): void {
    isPinned.current = false;
    setIsOpen(false);
  }

  function toggle(): void {
    const shouldOpen = !isPinned.current;
    isPinned.current = shouldOpen;
    setIsOpen(shouldOpen);
  }

  function handlePointerEnter(
    event: React.PointerEvent<HTMLSpanElement>,
  ): void {
    isTouch.current = event.pointerType === "touch";
    if (!isTouch.current) open();
  }

  function handleMouseEnter(): void {
    // Ignore the compatibility mouse event a touch browser emits after a tap.
    if (!isTouch.current) open();
  }

  function handlePointerLeave(): void {
    if (isPinned.current) return;
    if (container.current?.contains(document.activeElement)) return;
    close();
  }

  useEffect(() => {
    if (!isOpen) return undefined;
    function handleOutsidePointer(event: PointerEvent): void {
      if (
        event.target instanceof Node &&
        container.current?.contains(event.target)
      )
        return;
      isPinned.current = false;
      setIsOpen(false);
    }
    function handleEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      isPinned.current = false;
      setIsOpen(false);
    }
    // Capture Escape even when only hovering while the editor retains focus.
    document.addEventListener("keydown", handleEscape, true);
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    return () => {
      document.removeEventListener("keydown", handleEscape, true);
      document.removeEventListener("pointerdown", handleOutsidePointer, true);
    };
  }, [isOpen]);

  return {
    container,
    isOpen,
    open,
    close,
    toggle,
    handlePointerEnter,
    handleMouseEnter,
    handlePointerLeave,
  };
}
