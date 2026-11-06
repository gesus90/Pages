import { useEffect, useRef, useState } from "react";

import { useVirtualRows } from "./use-virtual-rows";

import type { VirtualRows } from "./use-virtual-rows";
import type { AgentPlanRunSummary } from "@/definition/AgentPlan";

/** Height of one run row in pixels, the `h-8` of the option. */
export const RUN_ROW_HEIGHT = 32;
/** The open list shows at most eight runs at once and scrolls the rest. */
const LIST_HEIGHT = RUN_ROW_HEIGHT * 8;
const PAGE_ROWS = 8;

interface RunPickerOptions {
  readonly runs: readonly AgentPlanRunSummary[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}

/** State and keyboard handling of the open run list. */
export interface RunPicker {
  readonly isOpen: boolean;
  readonly activeIndex: number;
  readonly listHeight: number;
  readonly rows: VirtualRows;
  readonly rootRef: React.RefObject<HTMLDivElement | null>;
  readonly triggerRef: React.RefObject<HTMLButtonElement | null>;
  readonly listRef: React.RefObject<HTMLDivElement | null>;
  readonly toggle: () => void;
  readonly choose: (index: number) => void;
  readonly onTriggerKeyDown: (event: React.KeyboardEvent) => void;
  readonly onListKeyDown: (event: React.KeyboardEvent) => void;
}

function movedIndex(key: string, index: number, count: number): number | null {
  const moves: Readonly<Record<string, number>> = {
    ArrowDown: index + 1,
    ArrowUp: index - 1,
    PageDown: index + PAGE_ROWS,
    PageUp: index - PAGE_ROWS,
    Home: 0,
    End: count - 1,
  };
  const target = moves[key];
  return target === undefined ? null : Math.min(count - 1, Math.max(0, target));
}

/** Closes the open list on a pointer press outside of it. */
function useOutsidePress(
  isOpen: boolean,
  rootRef: React.RefObject<HTMLDivElement | null>,
  setIsOpen: (isOpen: boolean) => void,
): void {
  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: PointerEvent): void {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      )
        setIsOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen, rootRef, setIsOpen]);
}

/**
 * Opens, scrolls and chooses in the list of runs like a select does.
 *
 * @remarks
 * Arrow keys, Page Up/Down, Home and End move the active run, Enter or Space
 * chooses it, Escape and Tab close the list. Escape is consumed, so the
 * console around the list stays open.
 */
export function useRunPicker({
  runs,
  selectedId,
  onSelect,
}: RunPickerOptions): RunPicker {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listHeight = Math.min(LIST_HEIGHT, runs.length * RUN_ROW_HEIGHT);
  const rows = useVirtualRows({
    count: runs.length,
    rowHeight: RUN_ROW_HEIGHT,
    viewportHeight: listHeight,
  });
  useOutsidePress(isOpen, rootRef, setIsOpen);
  function open(): void {
    const index = Math.max(
      0,
      runs.findIndex((entry) => entry.id === selectedId),
    );
    setActiveIndex(index);
    setIsOpen(true);
    // The list exists after this render; it takes the focus and shows the choice.
    requestAnimationFrame(() => {
      listRef.current?.focus({ preventScroll: true });
      rows.reveal(listRef.current, index);
    });
  }
  function closeToTrigger(): void {
    setIsOpen(false);
    triggerRef.current?.focus();
  }
  function choose(index: number): void {
    const entry = runs[index];
    closeToTrigger();
    if (entry) onSelect(entry.id);
  }
  function onTriggerKeyDown(event: React.KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    open();
  }
  function onListKeyDown(event: React.KeyboardEvent): void {
    const moved = movedIndex(event.key, activeIndex, runs.length);
    if (moved !== null) {
      event.preventDefault();
      setActiveIndex(moved);
      rows.reveal(listRef.current, moved);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeToTrigger();
    } else if (event.key === "Tab") setIsOpen(false);
  }
  return {
    isOpen,
    activeIndex,
    listHeight,
    rows,
    rootRef,
    triggerRef,
    listRef,
    toggle: () => (isOpen ? setIsOpen(false) : open()),
    choose,
    onTriggerKeyDown,
    onListKeyDown,
  };
}
