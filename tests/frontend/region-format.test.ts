import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateTime,
  parseInstant,
} from "@/app/lib/region-format";

import type { RegionFormat } from "@/app/lib/region-format";
import type { UserDateFormat } from "@/definition/Settings";

function region(
  dateFormat: UserDateFormat = "DD.MM.YYYY",
  timeZone = "UTC",
): RegionFormat {
  return { dateFormat, timeZone };
}

describe("parseInstant", () => {
  it.each([
    ["2026-09-30 22:30:00", "2026-09-30T22:30:00.000Z"],
    ["2026-09-30T22:30:00", "2026-09-30T22:30:00.000Z"],
    ["2026-09-30T22:30:00Z", "2026-09-30T22:30:00.000Z"],
    ["2026-09-30T22:30:00+02:00", "2026-09-30T20:30:00.000Z"],
  ])("reads %s as an instant", (value, expected) => {
    expect(parseInstant(value)?.toISOString()).toBe(expected);
  });

  it.each(["2026-09-30", "not-a-date", ""])(
    "does not read %j as an instant",
    (value) => {
      expect(parseInstant(value)).toBeNull();
    },
  );
});

describe("formatDate", () => {
  it.each([
    ["DD.MM.YYYY", "30.09.2026"],
    ["MM/DD/YYYY", "09/30/2026"],
    ["YYYY-MM-DD", "2026-09-30"],
  ] as const)("writes a calendar date as %s", (dateFormat, expected) => {
    expect(formatDate("2026-09-30", region(dateFormat))).toBe(expected);
  });

  it("keeps a calendar date in every time zone", () => {
    expect(formatDate("2026-09-30", region("DD.MM.YYYY", "Asia/Tokyo"))).toBe(
      "30.09.2026",
    );
    expect(
      formatDate("2026-09-30", region("DD.MM.YYYY", "America/Los_Angeles")),
    ).toBe("30.09.2026");
  });

  it("moves a timestamp into the time zone of the visitor", () => {
    expect(
      formatDate("2026-09-30 22:30:00", region("DD.MM.YYYY", "Asia/Tokyo")),
    ).toBe("01.10.2026");
    expect(formatDate("2026-09-30 22:30:00", region("DD.MM.YYYY", "UTC"))).toBe(
      "30.09.2026",
    );
  });

  it.each([null, ""])("shows %j as a dash", (value) => {
    expect(formatDate(value, region())).toBe("---");
  });

  it("returns text that is no date unchanged", () => {
    expect(formatDate("not-a-date", region())).toBe("not-a-date");
  });
});

describe("formatDateTime", () => {
  it("adds the time of day in the time zone of the visitor", () => {
    expect(
      formatDateTime(
        "2026-09-30 22:30:00",
        region("DD.MM.YYYY", "Europe/Berlin"),
      ),
    ).toBe("01.10.2026 00:30");
  });

  it("writes midnight as 00:00", () => {
    expect(formatDateTime("2026-09-30 00:05:00", region("YYYY-MM-DD"))).toBe(
      "2026-09-30 00:05",
    );
  });

  it("follows the date format", () => {
    expect(formatDateTime("2026-09-30 14:05:00", region("MM/DD/YYYY"))).toBe(
      "09/30/2026 14:05",
    );
  });

  it("leaves a calendar date without a time", () => {
    expect(formatDateTime("2026-09-30", region())).toBe("30.09.2026");
  });

  it.each([
    [null, "---"],
    ["", "---"],
    ["not-a-date", "not-a-date"],
  ])("handles %j like a date", (value, expected) => {
    expect(formatDateTime(value, region())).toBe(expected);
  });
});
