import { describe, expect, it } from "vitest";

import { DAY_IN_MS } from "@/app/lib/phase-plan/plan-dates";
import {
  BUFFER_MS,
  PIXELS_PER_DAY,
  SCROLL_EXTEND_THRESHOLD,
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

function local(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getTime();
}

const VIEWS: readonly PlanView[] = ["weeks", "months", "quarter"];

describe("buildDefaultWindow", () => {
  const today = local(2026, 9, 30);

  it.each([
    ["weeks", local(2026, 9, 21), local(2026, 12, 21)],
    ["months", local(2026, 8, 1), local(2027, 1, 1)],
    ["quarter", local(2026, 4, 1), local(2027, 4, 1)],
  ] as const)(
    "surrounds today in the %s view without data",
    (view, start, end) => {
      expect(buildDefaultWindow([], view, today)).toEqual({ end, start });
    },
  );

  it.each([
    ["weeks", local(2026, 8, 17), 20 * 7 * DAY_IN_MS],
    ["months", local(2026, 7, 1), undefined],
    ["quarter", local(2026, 1, 1), undefined],
  ] as const)(
    "centers on today when milestones lie near it (%s)",
    (view, start, span) => {
      const result = buildDefaultWindow(
        [local(2026, 9, 1), local(2026, 10, 15)],
        view,
        today,
      );

      expect(result.start).toBe(start);

      if (span !== undefined) {
        expect(result.end - result.start).toBe(span);
      }
    },
  );

  it("anchors at the earliest milestone when today is far away", () => {
    const far = [local(2027, 6, 1), local(2027, 6, 20)];

    expect(buildDefaultWindow(far, "weeks", today).start).toBe(
      local(2027, 5, 31) - 6 * 7 * DAY_IN_MS,
    );
    expect(buildDefaultWindow(far, "months", today).start).toBe(
      local(2027, 4, 1),
    );
    expect(buildDefaultWindow(far, "quarter", today).start).toBe(
      local(2026, 10, 1),
    );
  });

  it("works with a single milestone", () => {
    const single = buildDefaultWindow([local(2026, 9, 30)], "months", today);

    expect(single.end).toBeGreaterThan(single.start);
  });
});

describe("extendWindow", () => {
  const window = { end: local(2027, 1, 1), start: local(2026, 7, 1) };

  it.each(VIEWS)("grows the start in the %s view", (view) => {
    const extended = extendWindow(window, view, "start");

    expect(extended.end).toBe(window.end);
    expect(extended.start).toBeLessThan(window.start);
  });

  it.each(VIEWS)("grows the end in the %s view", (view) => {
    const extended = extendWindow(window, view, "end");

    expect(extended.start).toBe(window.start);
    expect(extended.end).toBeGreaterThan(window.end);
  });
});

describe("shiftBoundary", () => {
  it("moves by weeks, months and quarters", () => {
    expect(shiftBoundary(local(2026, 9, 7), "weeks", 2)).toBe(
      local(2026, 9, 21),
    );
    expect(shiftBoundary(local(2026, 9, 1), "months", -2)).toBe(
      local(2026, 7, 1),
    );
    expect(shiftBoundary(local(2026, 7, 1), "quarter", 1)).toBe(
      local(2026, 10, 1),
    );
  });
});

describe("buildColumns and buildSuperSegments", () => {
  const window = { end: local(2026, 10, 12), start: local(2026, 9, 7) };

  it("builds week columns of a fixed width", () => {
    const columns = buildColumns(window, "weeks", 10);

    expect(columns.map((column) => column.label)).toEqual([
      "KW 37",
      "KW 38",
      "KW 39",
      "KW 40",
      "KW 41",
    ]);
    expect(columns.every((column) => column.width === 70)).toBe(true);
  });

  it("clips month and quarter columns to the window", () => {
    const months = buildColumns(
      { end: local(2026, 10, 15), start: local(2026, 9, 15) },
      "months",
      1,
    );

    expect(months.map((column) => column.width)).toEqual([16, 14]);

    const quarters = buildColumns(
      { end: local(2026, 11, 1), start: local(2026, 5, 1) },
      "quarter",
      1,
    );

    expect(quarters.map((column) => column.label)).toEqual([
      "Q2 2026",
      "Q3 2026",
      "Q4 2026",
    ]);
    expect(quarters[0]?.width).toBe(61);
  });

  it("groups weeks by month, months by quarter and quarters by year", () => {
    expect(
      buildSuperSegments(window, "weeks", 1).map((segment) => segment.key),
    ).toEqual([`month-${local(2026, 9, 1)}`, `month-${local(2026, 10, 1)}`]);
    expect(
      buildSuperSegments(
        { end: local(2027, 2, 1), start: local(2026, 8, 1) },
        "months",
        1,
      ).map((segment) => segment.label),
    ).toEqual(["Q3 2026", "Q4 2026", "Q1 2027"]);

    const years = buildSuperSegments(
      { end: local(2027, 7, 1), start: local(2026, 4, 1) },
      "quarter",
      1,
    );

    expect(years.map((segment) => segment.label)).toEqual(["2026", "2027"]);
    expect(years[0]?.width).toBe(275);
  });

  it("includes an empty last year when the window ends on New Year", () => {
    const years = buildSuperSegments(
      { end: local(2027, 1, 1), start: local(2026, 4, 1) },
      "quarter",
      1,
    );

    expect(years.map((segment) => segment.label)).toEqual(["2026", "2027"]);
    expect(years[1]?.width).toBe(0);
  });
});

describe("capWindow", () => {
  it("keeps a window that fits the column budget", () => {
    const window = { end: local(2026, 12, 1), start: local(2026, 9, 7) };

    expect(capWindow(window, "weeks", 1, "end")).toEqual({
      droppedLeftMs: 0,
      window,
    });
  });

  it("drops the oldest columns when growing to the right", () => {
    const window = { end: local(2030, 1, 1), start: local(2026, 1, 5) };
    const capped = capWindow(window, "weeks", 1, "end");

    expect(capped.window.end).toBe(window.end);
    expect(capped.window.start).toBeGreaterThan(window.start);
    expect(capped.droppedLeftMs).toBe(capped.window.start - window.start);
    expect(buildColumns(capped.window, "weeks", 1)).toHaveLength(56);
  });

  it("drops the newest columns when growing to the left", () => {
    const window = { end: local(2030, 1, 1), start: local(2026, 1, 5) };
    const capped = capWindow(window, "weeks", 1, "start");

    expect(capped.window.start).toBe(window.start);
    expect(capped.window.end).toBeLessThan(window.end);
    expect(capped.droppedLeftMs).toBe(0);
  });
});

describe("shiftWindow", () => {
  const window = { end: local(2027, 1, 4), start: local(2026, 9, 7) };

  it("moves by half the span, keeping the length", () => {
    for (const view of VIEWS) {
      const later = shiftWindow(window, view, "end");
      const earlier = shiftWindow(window, view, "start");

      expect(later.end - later.start).toBe(window.end - window.start);
      expect(later.start).toBeGreaterThan(window.start);
      expect(earlier.start).toBeLessThan(window.start);
    }
  });

  it("moves at least one unit for a tiny window", () => {
    const tiny = { end: window.start + DAY_IN_MS, start: window.start };

    expect(shiftWindow(tiny, "weeks", "end").start).toBe(
      window.start + 7 * DAY_IN_MS,
    );
    expect(shiftWindow(tiny, "months", "end").start).toBe(local(2026, 10, 1));
    expect(shiftWindow(tiny, "quarter", "start").start).toBe(local(2026, 4, 1));
  });
});

describe("fitWindowToViewport", () => {
  it("keeps a window that already fills the viewport", () => {
    const window = { end: local(2027, 1, 4), start: local(2026, 9, 7) };
    const fitted = fitWindowToViewport(window, "weeks", 800);

    expect(fitted.window).toBe(window);
    expect(fitted.pixelsPerDay).toBe(PIXELS_PER_DAY.weeks);
    expect(fitted.scrollLeft).toBe(2 * 7 * PIXELS_PER_DAY.weeks);
    expect(fitted.maxScrollLeft).toBeGreaterThan(0);
  });

  it("grows a narrow window and scales up for a wide viewport", () => {
    const window = { end: local(2026, 10, 5), start: local(2026, 9, 7) };
    const fitted = fitWindowToViewport(window, "weeks", 6000);

    expect(fitted.window).not.toBe(window);
    expect(fitted.window.end - fitted.window.start).toBeGreaterThan(
      window.end - window.start,
    );
    expect(fitted.pixelsPerDay).toBeGreaterThanOrEqual(PIXELS_PER_DAY.weeks);
  });

  it("parks the quarter view one column in", () => {
    const window = { end: local(2027, 7, 1), start: local(2026, 1, 1) };
    const fitted = fitWindowToViewport(window, "quarter", 800);

    expect(fitted.scrollLeft).toBeCloseTo(91 * fitted.pixelsPerDay, 5);
  });
});

describe("extendWindowOnScroll", () => {
  const window = { end: local(2027, 1, 4), start: local(2026, 9, 7) };
  const scroll = { maxScrollLeft: 5000, pixelsPerDay: 12, scrollLeft: 2000 };

  it("does nothing away from the edges", () => {
    expect(extendWindowOnScroll(window, "weeks", scroll)).toBeNull();
  });

  it("grows to the left and compensates the added width", () => {
    const result = extendWindowOnScroll(window, "weeks", {
      ...scroll,
      scrollLeft: SCROLL_EXTEND_THRESHOLD - 1,
    });

    expect(result?.window.start).toBeLessThan(window.start);
    expect(result?.shiftPixels).toBeGreaterThan(0);
  });

  it("grows to the right without moving the scroll position", () => {
    const result = extendWindowOnScroll(window, "weeks", {
      ...scroll,
      scrollLeft: scroll.maxScrollLeft,
    });

    expect(result?.window.end).toBeGreaterThan(window.end);
    expect(result?.shiftPixels).toBeCloseTo(0, 5);
  });

  it("compensates dropped columns when the budget is exceeded", () => {
    const wide = { end: local(2030, 1, 1), start: local(2026, 1, 5) };
    const result = extendWindowOnScroll(wide, "weeks", {
      maxScrollLeft: 100_000,
      pixelsPerDay: 12,
      scrollLeft: 99_999,
    });

    expect(result?.shiftPixels).toBeLessThan(0);
  });
});

describe("constants", () => {
  it("buffers every view", () => {
    expect(BUFFER_MS.weeks).toBe(14 * DAY_IN_MS);
    expect(BUFFER_MS.months).toBe(31 * DAY_IN_MS);
    expect(BUFFER_MS.quarter).toBe(92 * DAY_IN_MS);
  });
});
