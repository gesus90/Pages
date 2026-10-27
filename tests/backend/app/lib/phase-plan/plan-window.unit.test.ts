import { describe, expect, it } from "vitest";

import {
  DAY_IN_MS,
  addMonths,
  addQuarters,
  addWeeks,
} from "@/app/lib/phase-plan/plan-dates";
import {
  BUFFER_MS,
  PIXELS_PER_DAY,
  buildColumns,
  buildDefaultWindow,
  buildSuperSegments,
  capWindow,
  extendWindow,
  extendWindowOnScroll,
  fitWindowToViewport,
  shiftBoundary,
  shiftWindow,
} from "@/app/lib/phase-plan/plan-window";

import type { PlanView } from "@/app/lib/phase-plan/plan-types";

const VIEWS: readonly PlanView[] = ["weeks", "months", "quarter"];
const TODAY = new Date(2026, 5, 10).getTime();

/** A local calendar day. */
function day(year: number, month: number, date: number): number {
  return new Date(year, month - 1, date).getTime();
}

/** Widths count days, so a daylight saving change moves them by a fraction of a day. */
function expectWidths(
  actual: readonly { readonly width: number }[],
  expected: readonly number[],
): void {
  expect(actual.map((entry) => Math.round(entry.width))).toEqual(expected);
}

function isAligned(time: number, view: PlanView): boolean {
  const date = new Date(time);
  if (view === "weeks") return date.getDay() === 1;
  if (view === "months") return date.getDate() === 1;
  return date.getDate() === 1 && date.getMonth() % 3 === 0;
}

describe("window boundaries", () => {
  it("shifts a snapped boundary by whole units of the view", () => {
    expect(shiftBoundary(day(2026, 6, 8), "weeks", 2)).toBe(day(2026, 6, 22));
    expect(shiftBoundary(day(2026, 6, 1), "months", -2)).toBe(day(2026, 4, 1));
    expect(shiftBoundary(day(2026, 4, 1), "quarter", 1)).toBe(day(2026, 7, 1));
  });

  it("keeps a buffer of at least two weeks around the track for every view", () => {
    expect(BUFFER_MS.weeks).toBe(14 * DAY_IN_MS);
    expect(BUFFER_MS.months).toBeGreaterThan(BUFFER_MS.weeks);
    expect(BUFFER_MS.quarter).toBeGreaterThan(BUFFER_MS.months);
  });
});

describe("the default window", () => {
  it.each(VIEWS)(
    "surrounds today with an aligned window without data (%s)",
    (view) => {
      const window = buildDefaultWindow([], view, TODAY);

      expect(isAligned(window.start, view)).toBe(true);
      expect(isAligned(window.end, view)).toBe(true);
      expect(window.start).toBeLessThanOrEqual(TODAY);
      expect(window.end).toBeGreaterThan(TODAY);
    },
  );

  it("spans thirteen weeks, five months or four quarters without data", () => {
    const weeks = buildDefaultWindow([], "weeks", TODAY);
    const months = buildDefaultWindow([], "months", TODAY);
    const quarters = buildDefaultWindow([], "quarter", TODAY);

    expect(weeks.end).toBe(addWeeks(weeks.start, 13));
    expect(months.end).toBe(addMonths(months.start, 5));
    expect(quarters.end).toBe(addQuarters(quarters.start, 4));
  });

  it("anchors at today when the data lies around it and at the first date otherwise", () => {
    const near = [day(2026, 6, 1), day(2026, 7, 1)];
    const far = [day(2024, 1, 10), day(2024, 3, 1)];

    for (const view of VIEWS) {
      const around = buildDefaultWindow(near, view, TODAY);
      const away = buildDefaultWindow(far, view, TODAY);

      expect(around.start).toBeLessThan(TODAY);
      expect(around.end).toBeGreaterThan(TODAY);
      expect(away.start).toBeLessThan(far[0] ?? 0);
      expect(away.end).toBeGreaterThan(far[1] ?? 0);
      expect(isAligned(away.start, view)).toBe(true);
    }
    expect(buildDefaultWindow(near, "weeks", TODAY).end).toBe(
      addWeeks(buildDefaultWindow(near, "weeks", TODAY).start, 20),
    );
    expect(buildDefaultWindow(near, "months", TODAY).end).toBe(
      addMonths(buildDefaultWindow(near, "months", TODAY).start, 8),
    );
    expect(buildDefaultWindow(near, "quarter", TODAY).end).toBe(
      addQuarters(buildDefaultWindow(near, "quarter", TODAY).start, 6),
    );
  });

  it("treats today as near the data up to thirty days outside it", () => {
    const times = [day(2026, 7, 1)];

    expect(buildDefaultWindow(times, "weeks", TODAY).start).toBeLessThan(TODAY);
    expect(
      buildDefaultWindow([day(2026, 8, 20)], "weeks", TODAY).start,
    ).toBeGreaterThan(TODAY);
  });
});

describe("extending and capping", () => {
  const window = { start: day(2026, 6, 1), end: day(2026, 12, 1) };

  it("grows one side by a fixed number of units", () => {
    expect(extendWindow(window, "weeks", "start")).toEqual({
      start: addWeeks(window.start, -8),
      end: window.end,
    });
    expect(extendWindow(window, "weeks", "end")).toEqual({
      start: window.start,
      end: addWeeks(window.end, 8),
    });
    expect(extendWindow(window, "months", "start")).toEqual({
      start: addMonths(window.start, -3),
      end: window.end,
    });
    expect(extendWindow(window, "months", "end")).toEqual({
      start: window.start,
      end: addMonths(window.end, 3),
    });
    expect(extendWindow(window, "quarter", "start")).toEqual({
      start: addQuarters(window.start, -2),
      end: window.end,
    });
    expect(extendWindow(window, "quarter", "end")).toEqual({
      start: window.start,
      end: addQuarters(window.end, 2),
    });
  });

  it("leaves a window within its column budget alone", () => {
    for (const view of VIEWS)
      expect(capWindow(window, view, PIXELS_PER_DAY[view], "end")).toEqual({
        window,
        droppedLeftMs: 0,
      });
  });

  it("drops the oldest columns when appending and reports the dropped span", () => {
    const wide = { start: day(2020, 1, 6), end: day(2023, 1, 2) };

    const capped = capWindow(wide, "weeks", PIXELS_PER_DAY.weeks, "end");

    expect(capped.window.end).toBe(wide.end);
    expect(capped.window.start).toBeGreaterThan(wide.start);
    expect(capped.droppedLeftMs).toBe(capped.window.start - wide.start);
    expect(isAligned(capped.window.start, "weeks")).toBe(true);
    expect(
      buildColumns(capped.window, "weeks", PIXELS_PER_DAY.weeks),
    ).toHaveLength(56);
  });

  it("drops the newest columns when prepending without any compensation", () => {
    const wide = { start: day(2020, 1, 1), end: day(2030, 1, 1) };

    const capped = capWindow(wide, "months", PIXELS_PER_DAY.months, "start");

    expect(capped.window.start).toBe(wide.start);
    expect(capped.window.end).toBeLessThan(wide.end);
    expect(capped.droppedLeftMs).toBe(0);
    expect(
      buildColumns(capped.window, "months", PIXELS_PER_DAY.months),
    ).toHaveLength(30);
  });
});

describe("columns and header segments", () => {
  it("numbers week columns and gives each seven days of width", () => {
    const columns = buildColumns(
      { start: day(2026, 6, 8), end: day(2026, 6, 29) },
      "weeks",
      10,
    );

    expect(columns.map((column) => column.label)).toEqual([
      "KW 24",
      "KW 25",
      "KW 26",
    ]);
    expect(columns.map((column) => column.width)).toEqual([70, 70, 70]);
    expect(columns[0]?.key).toBe(`week-${day(2026, 6, 8)}`);
  });

  it("cuts the first and the last month column at the window", () => {
    const columns = buildColumns(
      { start: day(2026, 1, 16), end: day(2026, 3, 11) },
      "months",
      2,
    );

    expect(columns).toHaveLength(3);
    expectWidths(columns, [16 * 2, 28 * 2, 10 * 2]);
    expect(columns[1]?.key).toBe(`month-${day(2026, 2, 1)}`);
  });

  it("labels quarter columns and cuts them at the window", () => {
    const columns = buildColumns(
      { start: day(2026, 2, 1), end: day(2026, 8, 1) },
      "quarter",
      1,
    );

    expect(columns.map((column) => column.label)).toEqual([
      "Q1 2026",
      "Q2 2026",
      "Q3 2026",
    ]);
    expectWidths(columns.slice(0, 1), [59]);
    expectWidths(columns.slice(2), [31]);
  });

  it("groups week columns under German month names", () => {
    const segments = buildSuperSegments(
      { start: day(2026, 6, 8), end: day(2026, 8, 3) },
      "weeks",
      1,
    );

    expect(segments.map((segment) => segment.label)).toEqual([
      "Juni 2026",
      "Juli 2026",
      "August 2026",
    ]);
    expectWidths(segments, [23, 31, 2]);
  });

  it("groups month columns under quarters and quarter columns under years", () => {
    const quarters = buildSuperSegments(
      { start: day(2026, 2, 1), end: day(2026, 8, 1) },
      "months",
      1,
    );
    const years = buildSuperSegments(
      { start: day(2025, 11, 1), end: day(2027, 2, 1) },
      "quarter",
      1,
    );

    expect(quarters.map((segment) => segment.label)).toEqual([
      "Q1 2026",
      "Q2 2026",
      "Q3 2026",
    ]);
    expect(years.map((segment) => segment.label)).toEqual([
      "2025",
      "2026",
      "2027",
    ]);
    expectWidths(years.slice(0, 1), [61]);
    expect(years[1]?.key).toBe("year-2026");
  });
});

describe("fitting and shifting", () => {
  it("keeps a window that already overflows the viewport on both sides", () => {
    const window = { start: day(2026, 1, 5), end: day(2026, 12, 28) };

    const fitted = fitWindowToViewport(window, "weeks", 800);

    expect(fitted.window).toEqual(window);
    expect(fitted.pixelsPerDay).toBe(PIXELS_PER_DAY.weeks);
    expect(fitted.scrollLeft).toBe(2 * 7 * PIXELS_PER_DAY.weeks);
    expect(fitted.maxScrollLeft).toBeGreaterThan(fitted.scrollLeft);
  });

  it("widens a window that would leave a wide viewport half empty", () => {
    const window = { start: day(2026, 6, 1), end: day(2026, 8, 1) };

    for (const view of VIEWS) {
      const fitted = fitWindowToViewport(window, view, 3000);
      const spanDays = (fitted.window.end - fitted.window.start) / DAY_IN_MS;

      expect(fitted.window.end - fitted.window.start).toBeGreaterThan(
        window.end - window.start,
      );
      expect(spanDays * fitted.pixelsPerDay).toBeGreaterThanOrEqual(3000);
      expect(fitted.maxScrollLeft).toBeCloseTo(
        spanDays * fitted.pixelsPerDay - 3000,
      );
    }
  });

  it("moves the window by half its span and keeps its length", () => {
    const weeks = { start: day(2026, 1, 5), end: day(2026, 3, 2) };
    const months = { start: day(2026, 1, 1), end: day(2026, 9, 1) };
    const quarters = { start: day(2025, 1, 1), end: day(2027, 1, 1) };

    for (const [window, view] of [
      [weeks, "weeks"],
      [months, "months"],
      [quarters, "quarter"],
    ] as const) {
      const later = shiftWindow(window, view, "end");
      const earlier = shiftWindow(window, view, "start");

      expect(later.start).toBeGreaterThan(window.start);
      expect(earlier.start).toBeLessThan(window.start);
      expect(later.end - later.start).toBe(window.end - window.start);
      expect(earlier.end - earlier.start).toBe(window.end - window.start);
    }
    expect(shiftWindow(weeks, "weeks", "end").start).toBe(
      addWeeks(weeks.start, 4),
    );
  });

  it("always shifts by at least one unit", () => {
    const tiny = { start: day(2026, 6, 8), end: day(2026, 6, 10) };

    expect(shiftWindow(tiny, "weeks", "end").start).toBe(day(2026, 6, 15));
    expect(shiftWindow(tiny, "months", "start").start).toBe(day(2026, 5, 1));
    expect(shiftWindow(tiny, "quarter", "end").start).toBe(day(2026, 7, 1));
  });
});

describe("growing on scroll", () => {
  const window = { start: day(2026, 1, 5), end: day(2026, 12, 28) };
  const scale = PIXELS_PER_DAY.weeks;
  const maxScrollLeft = 4000;

  it("does nothing while both edges are far away", () => {
    expect(
      extendWindowOnScroll(window, "weeks", {
        pixelsPerDay: scale,
        scrollLeft: 2000,
        maxScrollLeft,
      }),
    ).toBeNull();
  });

  it("grows the start and compensates the scroll position by the added width", () => {
    const extension = extendWindowOnScroll(window, "weeks", {
      pixelsPerDay: scale,
      scrollLeft: 10,
      maxScrollLeft,
    });

    expect(extension?.window.start).toBe(addWeeks(window.start, -8));
    expect(extension?.shiftPixels).toBe(8 * 7 * scale);
  });

  it("grows the end and moves the scroll position back by the dropped columns", () => {
    const extension = extendWindowOnScroll(window, "weeks", {
      pixelsPerDay: scale,
      scrollLeft: maxScrollLeft,
      maxScrollLeft,
    });

    expect(extension?.window.end).toBe(addWeeks(window.end, 8));
    // The column budget of 56 weeks drops the three oldest columns on the left.
    expect(extension?.window.start).toBe(addWeeks(window.start, 3));
    expect(extension?.shiftPixels).toBe(-3 * 7 * scale);
  });

  it("subtracts what the column budget drops from the left", () => {
    const wide = { start: day(2023, 1, 2), end: day(2026, 1, 5) };

    const extension = extendWindowOnScroll(wide, "weeks", {
      pixelsPerDay: scale,
      scrollLeft: maxScrollLeft,
      maxScrollLeft,
    });

    expect(extension?.window.start).toBeGreaterThan(wide.start);
    expect(extension?.shiftPixels).toBeLessThan(0);
  });
});
