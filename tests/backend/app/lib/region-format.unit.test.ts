import { describe, expect, it } from "vitest";

import {
  calendarDaysBefore,
  formatDate,
  formatDateTime,
  formatTimeOfDay,
  parseInstant,
} from "@/app/lib/region-format";

import type { RegionFormat } from "@/app/lib/region-format";

const BERLIN: RegionFormat = {
  timeZone: "Europe/Berlin",
  dateFormat: "DD.MM.YYYY",
};
const NEW_YORK: RegionFormat = {
  timeZone: "America/New_York",
  dateFormat: "MM/DD/YYYY",
};
const UTC: RegionFormat = { timeZone: "UTC", dateFormat: "YYYY-MM-DD" };

describe("parsing an instant", () => {
  it("reads a database timestamp as UTC and keeps an explicit offset", () => {
    expect(parseInstant("2026-06-10 22:30:00")?.toISOString()).toBe(
      "2026-06-10T22:30:00.000Z",
    );
    expect(parseInstant("2026-06-10T22:30:00Z")?.toISOString()).toBe(
      "2026-06-10T22:30:00.000Z",
    );
    expect(parseInstant("2026-06-10T22:30:00+02:00")?.toISOString()).toBe(
      "2026-06-10T20:30:00.000Z",
    );
  });

  it("refuses a calendar date without time and any unreadable text", () => {
    expect(parseInstant("2026-06-10")).toBeNull();
    expect(parseInstant("not a date")).toBeNull();
    expect(parseInstant("")).toBeNull();
  });
});

describe("formatting dates", () => {
  it("shows a placeholder for no value", () => {
    expect(formatDate(null, BERLIN)).toBe("---");
    expect(formatDate("", BERLIN)).toBe("---");
  });

  it("rearranges a calendar date without any time zone shift", () => {
    expect(formatDate("2026-06-10", BERLIN)).toBe("10.06.2026");
    expect(formatDate("2026-06-10", NEW_YORK)).toBe("06/10/2026");
    expect(formatDate("2026-06-10", UTC)).toBe("2026-06-10");
  });

  it("moves an instant into the time zone of the person before it reads the day", () => {
    // 23:30 UTC is already the next day in Berlin and still the same day in New York.
    expect(formatDate("2026-06-10 23:30:00", BERLIN)).toBe("11.06.2026");
    expect(formatDate("2026-06-10 23:30:00", NEW_YORK)).toBe("06/10/2026");
    expect(formatDate("2026-06-10 23:30:00", UTC)).toBe("2026-06-10");
  });

  it("returns an unreadable value unchanged", () => {
    expect(formatDate("soon", BERLIN)).toBe("soon");
  });

  it("appends the local time to an instant and keeps a plain date plain", () => {
    expect(formatDateTime("2026-06-10 23:30:00", BERLIN)).toBe(
      "11.06.2026 01:30",
    );
    expect(formatDateTime("2026-01-10 00:05:00", NEW_YORK)).toBe(
      "01/09/2026 19:05",
    );
    expect(formatDateTime("2026-06-10", BERLIN)).toBe("10.06.2026");
    expect(formatDateTime(null, BERLIN)).toBe("---");
    expect(formatDateTime("soon", BERLIN)).toBe("soon");
  });

  it("writes midnight as 00 and not as 24", () => {
    expect(formatDateTime("2026-06-10 22:00:00", BERLIN)).toBe(
      "11.06.2026 00:00",
    );
    expect(formatTimeOfDay("2026-06-10 22:00:00", BERLIN)).toBe("00:00");
  });

  it("reads the time of day in the time zone of the person", () => {
    expect(formatTimeOfDay("2026-06-10 12:15:00", BERLIN)).toBe("14:15");
    expect(formatTimeOfDay("2026-06-10 12:15:00", NEW_YORK)).toBe("08:15");
    expect(formatTimeOfDay("2026-06-10", BERLIN)).toBeNull();
    expect(formatTimeOfDay("soon", BERLIN)).toBeNull();
  });
});

describe("counting calendar days", () => {
  const now = new Date("2026-06-10T21:00:00Z");

  it("counts the days between two local calendar days, not 24-hour spans", () => {
    // 21:00 UTC is 23:00 in Berlin on the 10th, 23:30 UTC on the 9th is 01:30 on the 10th.
    expect(calendarDaysBefore("2026-06-09 23:30:00", now, BERLIN)).toBe(0);
    expect(calendarDaysBefore("2026-06-09 21:30:00", now, BERLIN)).toBe(1);
    expect(calendarDaysBefore("2026-06-09 21:30:00", now, UTC)).toBe(1);
    expect(calendarDaysBefore("2026-06-03 12:00:00", now, UTC)).toBe(7);
  });

  it("is negative for the future and null for an unreadable or date-only value", () => {
    expect(calendarDaysBefore("2026-06-12 12:00:00", now, UTC)).toBe(-2);
    expect(calendarDaysBefore("2026-06-10", now, UTC)).toBeNull();
    expect(calendarDaysBefore("soon", now, UTC)).toBeNull();
  });
});
