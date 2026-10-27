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

/** A local calendar day; the helpers under test all work in local time. */
function day(year: number, month: number, date: number): number {
  return new Date(year, month - 1, date).getTime();
}

describe("plan dates", () => {
  it("parses only strict calendar dates in local time", () => {
    expect(parsePlanDate("2026-06-10")).toBe(day(2026, 6, 10));
    expect(parsePlanDate("2026-6-10")).toBeNull();
    expect(parsePlanDate("2026-06-10T10:00")).toBeNull();
    expect(parsePlanDate("")).toBeNull();
    expect(parsePlanDate(null)).toBeNull();
  });

  it("writes a local day as ISO date and round-trips with the parser", () => {
    expect(toISODate(day(2026, 1, 5))).toBe("2026-01-05");
    expect(toISODate(day(2026, 12, 31))).toBe("2026-12-31");
    expect(parsePlanDate(toISODate(day(2027, 3, 9)))).toBe(day(2027, 3, 9));
  });

  it("formats days and ranges in German, repeating the year only across years", () => {
    expect(formatDayMonth(day(2026, 6, 10))).toBe("10.06.2026");
    expect(formatRangeLabel(day(2026, 6, 10), day(2026, 7, 2))).toBe(
      "10.06. – 02.07.2026",
    );
    expect(formatRangeLabel(day(2026, 12, 20), day(2027, 1, 3))).toBe(
      "20.12.2026 – 03.01.2027",
    );
    expect(formatMonthYear(day(2026, 3, 1))).toMatch(/2026/u);
  });

  it("numbers ISO weeks, including the turn of the year", () => {
    expect(getIsoWeek(day(2026, 1, 1))).toBe(1);
    expect(getIsoWeek(day(2026, 6, 10))).toBe(24);
    expect(getIsoWeek(day(2021, 1, 3))).toBe(53);
    expect(getIsoWeek(day(2024, 12, 30))).toBe(1);
  });

  it("snaps to the Monday of the week, the month and the quarter", () => {
    expect(startOfWeekMonday(day(2026, 6, 10))).toBe(day(2026, 6, 8));
    expect(startOfWeekMonday(day(2026, 6, 14))).toBe(day(2026, 6, 8));
    expect(startOfWeekMonday(day(2026, 6, 8))).toBe(day(2026, 6, 8));
    expect(startOfMonth(day(2026, 6, 10))).toBe(day(2026, 6, 1));
    expect(startOfQuarter(day(2026, 5, 31))).toBe(day(2026, 4, 1));
    expect(startOfQuarter(day(2026, 12, 1))).toBe(day(2026, 10, 1));
  });

  it("moves by calendar units without drifting over daylight saving time", () => {
    expect(addWeeks(day(2026, 3, 23), 1)).toBe(day(2026, 3, 30));
    expect(addWeeks(day(2026, 6, 10), -2)).toBe(day(2026, 5, 27));
    expect(addMonths(day(2026, 11, 20), 3)).toBe(day(2027, 2, 1));
    expect(addMonths(day(2026, 1, 31), -1)).toBe(day(2025, 12, 1));
    expect(addQuarters(day(2026, 5, 17), 1)).toBe(day(2026, 7, 1));
    expect(addQuarters(day(2026, 2, 1), -1)).toBe(day(2025, 10, 1));
  });

  it("labels a quarter with its year", () => {
    expect(getQuarterLabel(day(2026, 2, 14))).toBe("Q1 2026");
    expect(getQuarterLabel(day(2026, 11, 14))).toBe("Q4 2026");
  });

  it("stamps the server time as UTC date and time without the T separator", () => {
    expect(serverTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
    expect(DAY_IN_MS).toBe(24 * 60 * 60 * 1000);
  });
});
