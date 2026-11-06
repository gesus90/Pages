import { useEffect, useRef, useState } from "react";

import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";

/** Height assumed for an entry until it was drawn and measured. */
const ESTIMATED_HEIGHT = 76;
/** Pixels drawn beyond each edge of the viewport, so scrolling shows no gap. */
const OVERSCAN = 800;

/** Where the viewport looks into the list, in pixels from the list's top. */
interface ListFrame {
  readonly top: number;
  readonly height: number;
}

/** The entries a history draws now and how it learns their heights. */
export interface HistoryWindow {
  /** Index of the first drawn entry. */
  readonly start: number;
  /** Index after the last drawn entry. */
  readonly end: number;
  /** Height of the entries before and after the drawn ones. */
  readonly spaceBefore: number;
  readonly spaceAfter: number;
  /** Rises whenever a measured height changed the layout. */
  readonly layoutVersion: number;
  readonly listRef: React.RefObject<HTMLOListElement | null>;
  /** Attach to every drawn entry; it reports the entry's height until it leaves. */
  readonly measure: (element: HTMLElement | null) => (() => void) | undefined;
  /** Reads the viewport position again, on scrolling and resizing. */
  readonly follow: (viewport: HTMLElement) => void;
}

function heightOf(
  heights: ReadonlyMap<string, number>,
  event: AgentSessionEvent,
): number {
  return heights.get(event.id) ?? ESTIMATED_HEIGHT;
}

/** The frame before the first measurement: the end of the list, where the log opens. */
function endFrame(
  events: readonly AgentSessionEvent[],
  heights: ReadonlyMap<string, number>,
): ListFrame {
  let top = 0;
  for (const event of events) top += heightOf(heights, event);
  return { top, height: 0 };
}

function windowOf(
  events: readonly AgentSessionEvent[],
  heights: ReadonlyMap<string, number>,
  frame: ListFrame,
): Pick<HistoryWindow, "start" | "end" | "spaceBefore" | "spaceAfter"> {
  const from = frame.top - OVERSCAN;
  const to = frame.top + frame.height + OVERSCAN;
  let offset = 0;
  let start = events.length;
  let end = events.length;
  let spaceBefore = 0;
  for (const [index, event] of events.entries()) {
    const height = heightOf(heights, event);
    if (start === events.length && offset + height > from) {
      start = index;
      spaceBefore = offset;
    }
    if (offset > to) {
      end = index;
      break;
    }
    offset += height;
  }
  // A viewport below the last entry draws none of them; all space lies before it.
  if (start === events.length) spaceBefore = offset;
  let spaceAfter = 0;
  for (const event of events.slice(end)) spaceAfter += heightOf(heights, event);
  return { start: Math.min(start, end), end, spaceBefore, spaceAfter };
}

/** Records the drawn height of every observed entry and reports a change. */
function heightObserver(
  known: Map<string, number>,
  onChange: () => void,
): ResizeObserver {
  return new ResizeObserver((entries) => {
    let isChanged = false;
    for (const entry of entries) {
      const element = entry.target;
      if (!(element instanceof HTMLElement) || !element.dataset.eventId)
        continue;
      const height = element.getBoundingClientRect().height;
      if (height === 0 || known.get(element.dataset.eventId) === height)
        continue;
      known.set(element.dataset.eventId, height);
      isChanged = true;
    }
    if (isChanged) onChange();
  });
}

/**
 * Draws only the session entries near the viewport, whatever their heights.
 *
 * @remarks
 * Every drawn entry is measured as it renders and whenever its size changes,
 * such as when tool output opens; entries never drawn count with an estimate.
 * The space of the entries not drawn stays as padding, so the scroll bar,
 * scrolling to the start and following the newest entry keep working.
 */
export function useHistoryWindow(
  events: readonly AgentSessionEvent[],
): HistoryWindow {
  const listRef = useRef<HTMLOListElement | null>(null);
  const heights = useRef(new Map<string, number>());
  const observer = useRef<ResizeObserver | null>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  // Before the first measurement the end is assumed in view, where the log opens.
  const [frame, setFrame] = useState<ListFrame | null>(null);
  useEffect(() => {
    const owned = observer;
    return () => {
      owned.current?.disconnect();
      owned.current = null;
    };
  }, []);
  function measure(element: HTMLElement | null): (() => void) | undefined {
    if (!element) return undefined;
    // Rows attach before effects run, so the observer starts with the first row.
    observer.current ??= heightObserver(heights.current, () =>
      setLayoutVersion((version) => version + 1),
    );
    observer.current.observe(element);
    return () => observer.current?.unobserve(element);
  }
  function follow(viewport: HTMLElement): void {
    const list = listRef.current;
    if (!list) return;
    const top =
      viewport.getBoundingClientRect().top - list.getBoundingClientRect().top;
    setFrame((previous) =>
      previous?.top === top && previous.height === viewport.clientHeight
        ? previous
        : { top, height: viewport.clientHeight },
    );
  }
  return {
    ...windowOf(
      events,
      heights.current,
      frame ?? endFrame(events, heights.current),
    ),
    layoutVersion,
    listRef,
    measure,
    follow,
  };
}
