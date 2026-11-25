import { expect, it } from "vitest";

import {
  countOccurrencesFrom,
  isOccurrenceDate,
  lastOccurrenceDate,
  listOccurrenceDates,
  spanDays,
  splitRecurrence,
} from "./CalendarRecurrence";

import type { CalendarRecurrence } from "@/definition/Calendar";

function rule(overrides: Partial<CalendarRecurrence>): CalendarRecurrence {
  return {
    frequency: "daily",
    interval: 1,
    weekdays: [],
    until: null,
    count: null,
    ...overrides,
  };
}

const dates = (list: { date: string }[]): string[] =>
  list.map((entry) => entry.date);

it("lists daily dates with the interval", () => {
  const list = listOccurrenceDates(
    rule({ interval: 2 }),
    "2026-11-01",
    "2026-11-07",
  );
  expect(dates(list)).toEqual([
    "2026-11-01",
    "2026-11-03",
    "2026-11-05",
    "2026-11-07",
  ]);
  expect(list[1]?.index).toBe(1);
});

it("lists weekly dates on the weekday of the start by default", () => {
  expect(
    dates(
      listOccurrenceDates(
        rule({ frequency: "weekly" }),
        "2026-11-04",
        "2026-11-20",
      ),
    ),
  ).toEqual(["2026-11-04", "2026-11-11", "2026-11-18"]);
});

it("lists weekly dates on chosen weekdays and skips earlier ones", () => {
  expect(
    dates(
      listOccurrenceDates(
        rule({ frequency: "weekly", weekdays: ["fr", "mo", "mo"] }),
        "2026-11-04",
        "2026-11-17",
      ),
    ),
  ).toEqual(["2026-11-06", "2026-11-09", "2026-11-13", "2026-11-16"]);
});

it("lists monthly dates and skips months without the day", () => {
  expect(
    dates(
      listOccurrenceDates(
        rule({ frequency: "monthly" }),
        "2026-01-31",
        "2026-05-31",
      ),
    ),
  ).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
});

it("lists yearly dates", () => {
  expect(
    dates(
      listOccurrenceDates(
        rule({ frequency: "yearly", interval: 2 }),
        "2024-02-29",
        "2036-12-31",
      ),
    ),
  ).toEqual(["2024-02-29", "2028-02-29", "2032-02-29", "2036-02-29"]);
});

it("stops at until and count", () => {
  expect(
    listOccurrenceDates(
      rule({ until: "2026-11-03" }),
      "2026-11-01",
      "2026-11-30",
    ),
  ).toHaveLength(3);
  expect(
    listOccurrenceDates(rule({ count: 2 }), "2026-11-01", "2026-11-30"),
  ).toHaveLength(2);
});

it("stops after the step limit", () => {
  const list = listOccurrenceDates(
    rule({ frequency: "monthly", interval: 1200 }),
    "2026-02-29",
    "9999-12-31",
  );
  expect(list).toEqual([]);
});

it("tells the last date", () => {
  expect(lastOccurrenceDate(rule({ until: "2026-12-01" }), "2026-11-01")).toBe(
    "2026-12-01",
  );
  expect(lastOccurrenceDate(rule({}), "2026-11-01")).toBeNull();
  expect(lastOccurrenceDate(rule({ count: 3 }), "2026-11-01")).toBe(
    "2026-11-03",
  );
  expect(
    lastOccurrenceDate(
      rule({ frequency: "monthly", interval: 1200, count: 1 }),
      "2026-02-29",
    ),
  ).toBe("2026-02-29");
});

it("counts occurrences from a date", () => {
  expect(countOccurrencesFrom(rule({}), "2026-11-01", "2026-11-01")).toBe(
    "unbegrenzt",
  );
  expect(
    countOccurrencesFrom(rule({ count: 5 }), "2026-11-01", "2026-11-03"),
  ).toBe(3);
});

it("splits a series with an open end", () => {
  const open = rule({});
  const result = splitRecurrence(open, "2026-11-01", "2026-11-04");
  expect(result.before).toEqual({ ...open, until: "2026-11-03" });
  expect(result.after).toBe(open);
});

it("splits a counted series", () => {
  const counted = rule({ count: 5 });
  const result = splitRecurrence(counted, "2026-11-01", "2026-11-04");
  expect(result.before).toEqual({ ...counted, count: 3 });
  expect(result.after).toEqual({ ...counted, count: 2 });
});

it("leaves nothing before a split at the start", () => {
  const counted = rule({ count: 2 });
  const result = splitRecurrence(counted, "2026-11-01", "2026-11-01");
  expect(result.before).toBeNull();
  expect(result.after).toEqual({ ...counted, count: 2 });
  const over = splitRecurrence(counted, "2026-11-01", "2026-12-01");
  expect(over.after).toEqual({ ...counted, count: 1 });
});

it("recognizes occurrence dates", () => {
  const weekly = rule({ frequency: "weekly" });
  expect(isOccurrenceDate(weekly, "2026-11-04", "2026-11-11")).toBe(true);
  expect(isOccurrenceDate(weekly, "2026-11-04", "2026-11-12")).toBe(false);
  expect(isOccurrenceDate(weekly, "2026-11-04", "2026-11-01")).toBe(false);
});

it("counts span days", () => {
  expect(spanDays("2026-11-01", "2026-11-03")).toBe(2);
  expect(spanDays("2026-11-03", "2026-11-01")).toBe(0);
});
