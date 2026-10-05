import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";

import { DAY_IN_MS } from "@/app/lib/phase-plan/plan-dates";
import {
  PIXELS_PER_DAY,
  SCROLL_EDGE_TOLERANCE,
  buildColumns,
  buildDefaultWindow,
  buildSuperSegments,
  extendWindowOnScroll,
  fitWindowToViewport,
  shiftWindow,
} from "@/app/lib/phase-plan/plan-window";

import type {
  PlanView,
  SuperSegment,
  TimeWindow,
  TimelineColumn,
} from "@/app/lib/phase-plan/plan-types";
import type { RefObject, UIEvent } from "react";

/** The visible part of the timeline and the controls that move it. */
export interface PlanViewport {
  readonly view: PlanView;
  readonly window: TimeWindow;
  readonly pixelsPerDay: number;
  readonly trackWidth: number;
  readonly columns: readonly TimelineColumn[];
  readonly superSegments: readonly SuperSegment[];
  readonly hasStartFade: boolean;
  readonly hasEndFade: boolean;
  /** Attach to the scrolling element of the timeline. */
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly timeToX: (time: number) => number;
  readonly changeView: (view: PlanView) => void;
  readonly reset: () => void;
  readonly shift: (direction: "start" | "end") => void;
  readonly handleScroll: (event: UIEvent<HTMLDivElement>) => void;
}

/** Whether the timeline fades at its start and end, and how to update that. */
interface PlanFades {
  readonly hasStartFade: boolean;
  readonly hasEndFade: boolean;
  readonly setFades: (scrollLeft: number, maxScrollLeft: number) => void;
}

function usePlanFades(): PlanFades {
  const [hasStartFade, setHasStartFade] = useState(false);
  const [hasEndFade, setHasEndFade] = useState(true);

  function setFades(scrollLeft: number, maxScrollLeft: number): void {
    setHasStartFade(scrollLeft > SCROLL_EDGE_TOLERANCE);
    setHasEndFade(scrollLeft < maxScrollLeft - SCROLL_EDGE_TOLERANCE);
  }

  return { hasEndFade, hasStartFade, setFades };
}

/**
 * Keeps the visible window of the timeline and its scroll position.
 *
 * @remarks
 * The visible window extends on demand while scrolling and rebases distant
 * columns away, which keeps the DOM bounded while the axis feels endless in
 * both directions at a constant scroll speed. Resets and view changes fill
 * the viewport width and park near the left edge. Both run as layout
 * effects, so the first paint already shows the final scale and position.
 *
 * @param times - Instants of all dated milestones, for the default window.
 * @param today - The current instant.
 */
export function usePlanViewport(
  times: readonly number[],
  today: number,
): PlanViewport {
  const [view, setView] = useState<PlanView>("weeks");
  const [window, setWindow] = useState<TimeWindow>(() =>
    buildDefaultWindow(times, "weeks", today),
  );
  const [fillPixelsPerDay, setFillPixelsPerDay] = useState<number | null>(null);
  const [resetCounter, setResetCounter] = useState(0);
  const { hasEndFade, hasStartFade, setFades } = usePlanFades();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingShift = useRef(0);

  const pixelsPerDay = fillPixelsPerDay ?? PIXELS_PER_DAY[view];

  function updateFades(viewport: HTMLElement): void {
    setFades(viewport.scrollLeft, viewport.scrollWidth - viewport.clientWidth);
  }

  function changeView(nextView: PlanView): void {
    setView(nextView);
    setWindow(buildDefaultWindow(times, nextView, today));
    setResetCounter((counter) => counter + 1);
  }

  function reset(): void {
    setWindow(buildDefaultWindow(times, view, today));
    setResetCounter((counter) => counter + 1);
  }

  function shift(direction: "start" | "end"): void {
    setWindow(shiftWindow(window, view, direction));
  }

  function handleScroll(event: UIEvent<HTMLDivElement>): void {
    const viewport = event.currentTarget;

    updateFades(viewport);

    const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;

    if (maxScrollLeft <= 0) {
      return;
    }

    const extension = extendWindowOnScroll(window, view, {
      maxScrollLeft,
      pixelsPerDay,
      scrollLeft: viewport.scrollLeft,
    });

    if (extension) {
      pendingShift.current += extension.shiftPixels;
      setWindow(extension.window);
    }
  }

  // Applies pending scroll compensation after the extended content rendered,
  // but before the browser paints, so the visible anchor never jumps or
  // flashes. Direct writes on stale content would clamp or misplace it.
  useLayoutEffect(() => {
    const viewport = scrollRef.current;

    if (!viewport || pendingShift.current === 0) {
      return;
    }

    viewport.scrollLeft += pendingShift.current;
    pendingShift.current = 0;
    updateFades(viewport);
  });

  // Fits the window to the viewport with the window and view of the moment it
  // is called, which an effect that only depends on `resetCounter` cannot.
  const fitToViewport = useEffectEvent((viewport: HTMLElement): void => {
    const fitted = fitWindowToViewport(window, view, viewport.clientWidth);

    if (fitted.window !== window) {
      setWindow(fitted.window);
    }

    setFillPixelsPerDay(fitted.pixelsPerDay);
    viewport.scrollLeft = fitted.scrollLeft;
    setFades(fitted.scrollLeft, fitted.maxScrollLeft);
  });

  // Only explicit navigation resets the virtual scroll position on purpose.
  useLayoutEffect(() => {
    const viewport = scrollRef.current;

    if (!viewport || viewport.clientWidth <= 0) {
      return;
    }

    fitToViewport(viewport);
  }, [resetCounter]);

  return {
    changeView,
    columns: buildColumns(window, view, pixelsPerDay),
    handleScroll,
    hasEndFade,
    hasStartFade,
    pixelsPerDay,
    reset,
    scrollRef,
    shift,
    superSegments: buildSuperSegments(window, view, pixelsPerDay),
    timeToX: (time) => ((time - window.start) / DAY_IN_MS) * pixelsPerDay,
    trackWidth: Math.max(
      1,
      Math.round(((window.end - window.start) / DAY_IN_MS) * pixelsPerDay),
    ),
    view,
    window,
  };
}
