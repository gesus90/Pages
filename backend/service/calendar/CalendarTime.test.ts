import { afterEach, expect, it, vi } from "vitest";

import {
  addDays,
  dateIn,
  dateOf,
  daysBetween,
  formatInZone,
  fromLocal,
  isCalendarDate,
  isKnownTimeZone,
  offsetMinutes,
  parseInstant,
  serverTimeZone,
  toLocal,
  toUtcText,
  weekdayIndex,
} from "./CalendarTime";

const BERLIN = "Europe/Berlin";

afterEach(() => {
  vi.restoreAllMocks();
});

it("recognizes dates", () => {
  expect(isCalendarDate("2026-11-12")).toBe(true);
  expect(isCalendarDate("2026-11-12T10:00:00Z")).toBe(false);
});

it("knows time zones", () => {
  expect(isKnownTimeZone(BERLIN)).toBe(true);
  expect(isKnownTimeZone(BERLIN)).toBe(true);
  expect(isKnownTimeZone("Nowhere/Land")).toBe(false);
});

it("returns the zone of the server", () => {
  expect(serverTimeZone()).not.toBe("");
});

it("falls back to UTC without a resolved zone", () => {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    locale: "en-US",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "",
  });
  expect(serverTimeZone()).toBe("UTC");
});

it("reads the wall clock of an instant", () => {
  expect(toLocal(Date.parse("2026-11-12T13:00:00Z"), BERLIN)).toEqual({
    date: "2026-11-12",
    time: "14:00:00",
  });
});

it("fills missing parts with zeros", () => {
  vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue([]);
  expect(toLocal(0, "UTC")).toEqual({ date: "00-00-00", time: "00:00:00" });
});

it("computes offsets in winter and summer", () => {
  expect(offsetMinutes(Date.parse("2026-01-01T00:00:00Z"), BERLIN)).toBe(60);
  expect(offsetMinutes(Date.parse("2026-07-01T00:00:00Z"), BERLIN)).toBe(120);
});

it("converts the wall clock to an instant", () => {
  expect(
    toUtcText(fromLocal({ date: "2026-07-01", time: "09:00:00" }, BERLIN)),
  ).toBe("2026-07-01T07:00:00.000Z");
});

it("moves a time in a summer time gap forward", () => {
  expect(
    toUtcText(fromLocal({ date: "2026-03-29", time: "02:30:00" }, BERLIN)),
  ).toBe("2026-03-29T01:30:00.000Z");
});

it("formats instants with the offset", () => {
  expect(formatInZone(Date.parse("2026-11-12T13:00:00Z"), BERLIN)).toBe(
    "2026-11-12T14:00:00+01:00",
  );
  expect(formatInZone(Date.parse("2026-11-12T13:00:00Z"), "UTC")).toBe(
    "2026-11-12T13:00:00+00:00",
  );
  expect(
    formatInZone(Date.parse("2026-11-12T13:00:00Z"), "America/New_York"),
  ).toBe("2026-11-12T08:00:00-05:00");
  expect(formatInZone(Date.parse("2026-11-12T13:00:00Z"), "Asia/Kolkata")).toBe(
    "2026-11-12T18:30:00+05:30",
  );
});

it("adds days and counts them", () => {
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  expect(daysBetween("2026-01-01", "2026-01-11")).toBe(10);
});

it("numbers weekdays from Monday", () => {
  expect(weekdayIndex("2026-11-23")).toBe(0);
  expect(weekdayIndex("2026-11-29")).toBe(6);
});

it("builds dates that exist", () => {
  expect(dateOf(2026, 2, 28)).toBe("2026-02-28");
  expect(dateOf(2026, 2, 30)).toBeNull();
  expect(dateOf(2026, 14, 5)).toBe("2027-02-05");
  expect(dateOf(2026, 0, 5)).toBe("2025-12-05");
  expect(dateOf(2026, -11, 5)).toBe("2025-01-05");
});

it("reads client times", () => {
  expect(parseInstant("2026-07-01", BERLIN)).toBe(
    Date.parse("2026-06-30T22:00:00Z"),
  );
  expect(parseInstant("2026-07-01T10:00:00+02:00", BERLIN)).toBe(
    Date.parse("2026-07-01T08:00:00Z"),
  );
});

it("reads the date of client times", () => {
  expect(dateIn("2026-07-01", BERLIN)).toBe("2026-07-01");
  expect(dateIn("2026-06-30T23:30:00Z", BERLIN)).toBe("2026-07-01");
});
