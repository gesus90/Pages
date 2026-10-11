import { describe, expect, it } from "vitest";

import {
  DAY_IN_MS,
  addMonths,
  addQuarters,
  addWeeks,
  formatDayMonth,
  formatMonthYear,
  formatRangeLabel,
  getIsoWeek,
  getQuarterLabel,
  parsePlanDate,
  serverTimestamp,
  startOfMonth,
  startOfQuarter,
  startOfWeekMonday,
  toISODate,
} from "@/app/lib/phase-plan/plan-dates";

function local(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getTime();
}

describe("parsePlanDate", () => {
  it("parses a stored date as local midnight", () => {
    expect(parsePlanDate("2026-09-30")).toBe(local(2026, 9, 30));
  });

  it.each([null, "", "2026-9-30", "30.09.2026", "2026-09-30T10:00"])(
    "rejects %j",
    (value) => {
      expect(parsePlanDate(value)).toBeNull();
    },
  );

  it("rolls a day beyond the end of its month over", () => {
    expect(parsePlanDate("2026-02-31")).toBe(local(2026, 3, 3));
  });
});

describe("toISODate", () => {
  it("formats local dates with zero padding", () => {
    expect(toISODate(local(2026, 1, 5))).toBe("2026-01-05");
    expect(toISODate(local(2026, 12, 31))).toBe("2026-12-31");
  });
});

describe("formatting", () => {
  it("formats a day as a German date", () => {
    expect(formatDayMonth(local(2026, 9, 5))).toBe("05.09.2026");
  });

  it("leaves out the first year of a range within one year", () => {
    expect(formatRangeLabel(local(2026, 9, 5), local(2026, 10, 7))).toBe(
      "05.09. – 07.10.2026",
    );
  });

  it("keeps both years of a range across years", () => {
    expect(formatRangeLabel(local(2026, 12, 20), local(2027, 1, 7))).toBe(
      "20.12.2026 – 07.01.2027",
    );
  });

  it("formats month and year", () => {
    expect(formatMonthYear(local(2026, 9, 5))).toMatch(/Sept?\.? 2026/);
  });

  it("labels quarters", () => {
    expect(getQuarterLabel(local(2026, 1, 1))).toBe("Q1 2026");
    expect(getQuarterLabel(local(2026, 6, 30))).toBe("Q2 2026");
    expect(getQuarterLabel(local(2026, 12, 31))).toBe("Q4 2026");
  });
});

describe("ISO weeks and grid starts", () => {
  it.each([
    [local(2026, 1, 1), 1],
    [local(2026, 9, 30), 40],
    [local(2026, 12, 31), 53],
    [local(2027, 1, 1), 53],
    [local(2027, 1, 4), 1],
    [local(2024, 12, 30), 1],
  ])("numbers %d as week %d", (time, week) => {
    expect(getIsoWeek(time)).toBe(week);
  });

  it("starts weeks on Monday", () => {
    expect(startOfWeekMonday(local(2026, 9, 30))).toBe(local(2026, 9, 28));
    expect(startOfWeekMonday(local(2026, 9, 28))).toBe(local(2026, 9, 28));
    expect(startOfWeekMonday(local(2026, 10, 4))).toBe(local(2026, 9, 28));
  });

  it("moves by whole weeks across changes of daylight saving time", () => {
    expect(addWeeks(local(2026, 10, 19), 3)).toBe(local(2026, 11, 9));
    expect(addWeeks(local(2027, 4, 5), -4)).toBe(local(2027, 3, 8));
    expect(addWeeks(new Date(2026, 9, 25, 23).getTime(), 1)).toBe(
      new Date(2026, 10, 1, 23).getTime(),
    );
  });

  it("snaps to months and quarters", () => {
    expect(startOfMonth(local(2026, 9, 30))).toBe(local(2026, 9, 1));
    expect(startOfQuarter(local(2026, 9, 30))).toBe(local(2026, 7, 1));
    expect(startOfQuarter(local(2026, 1, 15))).toBe(local(2026, 1, 1));
  });

  it("moves by months and quarters across years", () => {
    expect(addMonths(local(2026, 11, 20), 3)).toBe(local(2027, 2, 1));
    expect(addMonths(local(2026, 2, 20), -3)).toBe(local(2025, 11, 1));
    expect(addQuarters(local(2026, 11, 20), 2)).toBe(local(2027, 4, 1));
    expect(addQuarters(local(2026, 2, 20), -1)).toBe(local(2025, 10, 1));
  });
});

describe("serverTimestamp", () => {
  it("formats like the stamps of the server", () => {
    expect(serverTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("has a day of the expected length", () => {
    expect(DAY_IN_MS).toBe(24 * 60 * 60 * 1000);
  });
});
