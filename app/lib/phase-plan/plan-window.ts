import {
  DAY_IN_MS,
  addMonths,
  addQuarters,
  addWeeks,
  formatMonthYear,
  getIsoWeek,
  getQuarterLabel,
  startOfMonth,
  startOfQuarter,
  startOfWeekMonday,
} from "@/app/lib/phase-plan/plan-dates";

import type {
  PlanView,
  SuperSegment,
  TimeWindow,
  TimelineColumn,
} from "@/app/lib/phase-plan/plan-types";

/** Pixels per day at the default scale of every view. */
export const PIXELS_PER_DAY: Readonly<Record<PlanView, number>> = {
  weeks: 12,
  months: 4,
  quarter: 1.2,
};

/** Most columns the DOM holds per view; farther ones are dropped. */
const MAX_COLUMNS: Readonly<Record<PlanView, number>> = {
  weeks: 56,
  months: 30,
  quarter: 20,
};

/** Columns kept to the left of the viewport after a reset. */
const INITIAL_OFFSET_COLUMNS: Readonly<Record<PlanView, number>> = {
  weeks: 2,
  months: 2,
  quarter: 1,
};

/** Approximate days of one column, used to place the viewport after a reset. */
const COLUMN_DAYS: Readonly<Record<PlanView, number>> = {
  weeks: 7,
  months: 30,
  quarter: 91,
};

/** How far outside the track milestones are still rendered, per view. */
export const BUFFER_MS: Readonly<Record<PlanView, number>> = {
  weeks: 2 * 7 * DAY_IN_MS,
  months: 31 * DAY_IN_MS,
  quarter: 92 * DAY_IN_MS,
};

/** Distance to a scroll edge at which the window grows. */
export const SCROLL_EXTEND_THRESHOLD = 240;

/** Distance to a scroll edge that still counts as the edge for the fades. */
export const SCROLL_EDGE_TOLERANCE = 2;

/**
 * Moves a view-aligned boundary by whole units, keeping the grid snapped.
 *
 * @param time - Snapped boundary instant.
 * @param view - Timeline granularity selecting the unit.
 * @param units - Signed number of units to move.
 * @returns The moved boundary, still aligned.
 */
export function shiftBoundary(
  time: number,
  view: PlanView,
  units: number,
): number {
  if (view === "weeks") {
    return addWeeks(time, units);
  }

  if (view === "months") {
    return addMonths(time, units);
  }

  return addQuarters(time, units);
}

/**
 * Builds the default visible window for a view around an anchor instant.
 *
 * @param times - All usable milestone instants, unsorted.
 * @param view - Timeline granularity selecting span and snapping.
 * @param today - Anchor preferred when it lies near the data.
 * @returns Half-open window aligned to the view boundaries.
 */
export function buildDefaultWindow(
  times: readonly number[],
  view: PlanView,
  today: number,
): TimeWindow {
  if (times.length === 0) {
    if (view === "weeks") {
      return {
        end: addWeeks(startOfWeekMonday(today), 12),
        start: addWeeks(startOfWeekMonday(today), -1),
      };
    }

    if (view === "months") {
      return {
        end: addMonths(startOfMonth(today), 4),
        start: addMonths(startOfMonth(today), -1),
      };
    }

    return {
      end: addQuarters(startOfQuarter(today), 3),
      start: addQuarters(startOfQuarter(today), -1),
    };
  }

  const minimum = Math.min(...times);
  const maximum = Math.max(...times);

  const anchor =
    today >= minimum - 30 * DAY_IN_MS && today <= maximum + 30 * DAY_IN_MS
      ? today
      : minimum;

  if (view === "weeks") {
    const start = addWeeks(startOfWeekMonday(anchor), -6);
    return { end: addWeeks(start, 20), start };
  }

  if (view === "months") {
    const start = addMonths(startOfMonth(anchor), -2);
    return { end: addMonths(start, 8), start };
  }

  const start = addQuarters(startOfQuarter(anchor), -2);
  return { end: addQuarters(start, 6), start };
}

/**
 * Extends a window by whole view units on one side.
 *
 * @param window - Currently visible window.
 * @param view - Timeline granularity selecting the unit size.
 * @param direction - Which side grows.
 * @returns The extended window, still aligned to view boundaries.
 */
export function extendWindow(
  window: TimeWindow,
  view: PlanView,
  direction: "start" | "end",
): TimeWindow {
  if (view === "weeks") {
    return direction === "start"
      ? { end: window.end, start: addWeeks(window.start, -8) }
      : { end: addWeeks(window.end, 8), start: window.start };
  }

  if (view === "months") {
    return direction === "start"
      ? { end: window.end, start: addMonths(window.start, -3) }
      : { end: addMonths(window.end, 3), start: window.start };
  }

  return direction === "start"
    ? { end: window.end, start: addQuarters(window.start, -2) }
    : { end: addQuarters(window.end, 2), start: window.start };
}

/**
 * Rebases a grown window back into its column budget.
 *
 * @remarks
 * The DOM never holds more than a fixed number of columns: when appending on
 * the right, the oldest columns on the left are dropped (the caller
 * compensates the scroll position by the dropped width); when prepending on
 * the left, the newest columns on the right are dropped, which needs no
 * compensation. Logical dates stay intact, so the rebase is invisible.
 *
 * @param window - Window after extending.
 * @param view - Timeline granularity selecting the budget.
 * @param pixelsPerDay - Horizontal scale, which decides how wide a column is.
 * @param keep - Which side triggered the extension.
 * @returns The capped window plus the dropped span on the left, if any.
 */
export function capWindow(
  window: TimeWindow,
  view: PlanView,
  pixelsPerDay: number,
  keep: "start" | "end",
): { readonly window: TimeWindow; readonly droppedLeftMs: number } {
  const columns = buildColumns(window, view, pixelsPerDay);
  const excess = columns.length - MAX_COLUMNS[view];

  if (excess <= 0) {
    return { droppedLeftMs: 0, window };
  }

  if (keep === "end") {
    const start = shiftBoundary(window.start, view, excess);
    return {
      droppedLeftMs: start - window.start,
      window: { end: window.end, start },
    };
  }

  return {
    droppedLeftMs: 0,
    window: {
      end: shiftBoundary(window.end, view, -excess),
      start: window.start,
    },
  };
}

/**
 * Builds the columns of the timeline body for a window.
 *
 * @param window - Visible time window.
 * @param view - Timeline granularity.
 * @param pixelsPerDay - Horizontal scale, which decides how wide a column is.
 */
export function buildColumns(
  window: TimeWindow,
  view: PlanView,
  pixelsPerDay: number,
): TimelineColumn[] {
  const columns: TimelineColumn[] = [];

  if (view === "weeks") {
    for (
      let time = startOfWeekMonday(window.start);
      time < window.end;
      time = addWeeks(time, 1)
    ) {
      columns.push({
        key: `week-${time}`,
        label: `KW ${getIsoWeek(time)}`,
        width: 7 * pixelsPerDay,
      });
    }

    return columns;
  }

  if (view === "months") {
    for (
      let time = startOfMonth(window.start);
      time < window.end;
      time = addMonths(time, 1)
    ) {
      const width =
        ((Math.min(addMonths(time, 1), window.end) -
          Math.max(time, window.start)) /
          DAY_IN_MS) *
        pixelsPerDay;
      columns.push({
        key: `month-${time}`,
        label: formatMonthYear(time),
        width,
      });
    }

    return columns;
  }

  for (
    let time = startOfQuarter(window.start);
    time < window.end;
    time = addQuarters(time, 1)
  ) {
    const width =
      ((Math.min(addQuarters(time, 1), window.end) -
        Math.max(time, window.start)) /
        DAY_IN_MS) *
      pixelsPerDay;
    columns.push({
      key: `quarter-${time}`,
      label: getQuarterLabel(time),
      width,
    });
  }

  return columns;
}

/**
 * Builds the segments of the timeline header row above the columns.
 *
 * @param window - Visible time window.
 * @param view - Timeline granularity.
 * @param pixelsPerDay - Horizontal scale, which decides how wide a segment is.
 */
export function buildSuperSegments(
  window: TimeWindow,
  view: PlanView,
  pixelsPerDay: number,
): SuperSegment[] {
  const segments: SuperSegment[] = [];

  if (view === "weeks") {
    for (
      let time = startOfMonth(window.start);
      time < window.end;
      time = addMonths(time, 1)
    ) {
      const label = new Intl.DateTimeFormat("de", {
        month: "long",
        year: "numeric",
      }).format(new Date(time));
      const width =
        ((Math.min(addMonths(time, 1), window.end) -
          Math.max(time, window.start)) /
          DAY_IN_MS) *
        pixelsPerDay;
      segments.push({ key: `month-${time}`, label, width });
    }

    return segments;
  }

  if (view === "months") {
    for (
      let time = startOfQuarter(window.start);
      time < window.end;
      time = addQuarters(time, 1)
    ) {
      const width =
        ((Math.min(addQuarters(time, 1), window.end) -
          Math.max(time, window.start)) /
          DAY_IN_MS) *
        pixelsPerDay;
      segments.push({
        key: `quarter-${time}`,
        label: getQuarterLabel(time),
        width,
      });
    }

    return segments;
  }

  const startYear = new Date(window.start).getFullYear();
  const endYear = new Date(window.end).getFullYear();

  for (let year = startYear; year <= endYear; year += 1) {
    const yearStart = new Date(year, 0, 1).getTime();
    const nextYearStart = new Date(year + 1, 0, 1).getTime();
    const width =
      ((Math.min(nextYearStart, window.end) -
        Math.max(yearStart, window.start)) /
        DAY_IN_MS) *
      pixelsPerDay;
    segments.push({ key: `year-${year}`, label: `${year}`, width });
  }

  return segments;
}

/** The result of fitting a window to the width of the viewport. */
export interface FittedWindow {
  readonly window: TimeWindow;
  readonly pixelsPerDay: number;
  readonly scrollLeft: number;
  readonly maxScrollLeft: number;
}

/**
 * Fills the viewport width after a reset or a change of the view.
 *
 * @remarks
 * Resets and view changes fill the viewport width when the default scale
 * would leave it half empty, guarantee scrollable overflow on both sides,
 * then park near the left edge with a small buffer behind, so both
 * directions stay visibly scrollable.
 *
 * @param window - Window the view starts with.
 * @param view - Timeline granularity.
 * @param viewportWidth - Width of the scrolling viewport in pixels.
 */
export function fitWindowToViewport(
  window: TimeWindow,
  view: PlanView,
  viewportWidth: number,
): FittedWindow {
  let fitted = window;
  let spanDays = (fitted.end - fitted.start) / DAY_IN_MS;
  let pixelsPerDay = Math.max(PIXELS_PER_DAY[view], viewportWidth / spanDays);

  for (
    let guard = 0;
    guard < 4 &&
    spanDays * pixelsPerDay < viewportWidth + 2 * SCROLL_EXTEND_THRESHOLD;
    guard += 1
  ) {
    fitted = extendWindow(extendWindow(fitted, view, "start"), view, "end");
    spanDays = (fitted.end - fitted.start) / DAY_IN_MS;
    pixelsPerDay = Math.max(PIXELS_PER_DAY[view], viewportWidth / spanDays);
  }

  return {
    maxScrollLeft: spanDays * pixelsPerDay - viewportWidth,
    pixelsPerDay,
    scrollLeft: INITIAL_OFFSET_COLUMNS[view] * COLUMN_DAYS[view] * pixelsPerDay,
    window: fitted,
  };
}

/**
 * Moves the window by half its span, keeping its length and the grid.
 *
 * @param window - Currently visible window.
 * @param view - Timeline granularity.
 * @param direction - Whether to look at earlier or later dates.
 */
export function shiftWindow(
  window: TimeWindow,
  view: PlanView,
  direction: "start" | "end",
): TimeWindow {
  const span = window.end - window.start;
  const sign = direction === "start" ? -1 : 1;
  let shiftedStart = window.start;

  if (view === "weeks") {
    const weeks = Math.max(1, Math.round(span / 2 / (7 * DAY_IN_MS)));
    shiftedStart = addWeeks(window.start, sign * weeks);
  } else if (view === "months") {
    const months = Math.max(1, Math.round(span / 2 / (30 * DAY_IN_MS)));
    shiftedStart = addMonths(window.start, sign * months);
  } else {
    const quarters = Math.max(1, Math.round(span / 2 / (90 * DAY_IN_MS)));
    shiftedStart = addQuarters(window.start, sign * quarters);
  }

  return { end: shiftedStart + span, start: shiftedStart };
}

/** A grown window together with the scroll compensation it needs. */
export interface ScrollExtension {
  readonly window: TimeWindow;
  readonly shiftPixels: number;
}

/** Scale and horizontal scroll position of the viewport. */
export interface ScrollPosition {
  readonly pixelsPerDay: number;
  readonly scrollLeft: number;
  readonly maxScrollLeft: number;
}

/**
 * Grows the window when the viewport scrolled close to one of its edges.
 *
 * @param window - Currently visible window.
 * @param view - Timeline granularity.
 * @param scroll - Current scale and horizontal scroll position.
 * @returns The new window and how far the scroll position has to move so the
 * visible anchor stays put, or `null` when no edge is close.
 */
export function extendWindowOnScroll(
  window: TimeWindow,
  view: PlanView,
  scroll: ScrollPosition,
): ScrollExtension | null {
  const { pixelsPerDay, scrollLeft, maxScrollLeft } = scroll;

  if (scrollLeft < SCROLL_EXTEND_THRESHOLD) {
    const extended = extendWindow(window, view, "start");
    const addedPixels =
      ((window.start - extended.start) / DAY_IN_MS) * pixelsPerDay;
    const capped = capWindow(extended, view, pixelsPerDay, "start");

    return {
      shiftPixels:
        addedPixels - (capped.droppedLeftMs / DAY_IN_MS) * pixelsPerDay,
      window: capped.window,
    };
  }

  if (scrollLeft > maxScrollLeft - SCROLL_EXTEND_THRESHOLD) {
    const extended = extendWindow(window, view, "end");
    const capped = capWindow(extended, view, pixelsPerDay, "end");

    return {
      shiftPixels: -(capped.droppedLeftMs / DAY_IN_MS) * pixelsPerDay,
      window: capped.window,
    };
  }

  return null;
}
