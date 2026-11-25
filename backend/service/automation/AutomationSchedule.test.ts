import { afterEach, describe, expect, it, vi } from "vitest";

import {
  firstRunAt,
  isInWindow,
  nextRunAfter,
  wallClockOf,
  zonedInstant,
} from "./AutomationSchedule";

import { AUTOMATION_EVENT_TYPES } from "@/definition/Automation";

import type {
  AutomationEventTrigger,
  AutomationIntervalTrigger,
  AutomationWeeklyTrigger,
} from "@/definition/Automation";

const BERLIN = "Europe/Berlin";
const EVENT: AutomationEventTrigger = {
  type: "event",
  eventType: AUTOMATION_EVENT_TYPES[0],
};

function interval(
  overrides: Partial<AutomationIntervalTrigger> = {},
): AutomationIntervalTrigger {
  return {
    type: "interval",
    every: 1,
    unit: "hour",
    timeZone: "UTC",
    ...overrides,
  };
}

function weekly(
  overrides: Partial<AutomationWeeklyTrigger> = {},
): AutomationWeeklyTrigger {
  return {
    type: "weekly",
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    times: ["09:00"],
    timeZone: "UTC",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isInWindow", () => {
  it("allows every minute without a window", () => {
    expect(isInWindow(5, undefined)).toBe(true);
  });

  it("allows the whole day for an equal start and end", () => {
    expect(isInWindow(700, { start: "08:00", end: "08:00" })).toBe(true);
  });

  it("treats the end of a same-day window as exclusive", () => {
    const window = { start: "08:00", end: "10:00" };
    expect(isInWindow(480, window)).toBe(true);
    expect(isInWindow(599, window)).toBe(true);
    expect(isInWindow(600, window)).toBe(false);
    expect(isInWindow(479, window)).toBe(false);
  });

  it("supports windows that cross midnight", () => {
    const window = { start: "22:00", end: "02:00" };
    expect(isInWindow(23 * 60, window)).toBe(true);
    expect(isInWindow(60, window)).toBe(true);
    expect(isInWindow(12 * 60, window)).toBe(false);
  });

  it("reads a time without minutes as zero minutes", () => {
    expect(isInWindow(30, { start: "01", end: "02:00" })).toBe(false);
    expect(isInWindow(90, { start: "01", end: "02:00" })).toBe(true);
  });

  it("reads a split without parts as zero", () => {
    vi.spyOn(String.prototype, "split").mockReturnValueOnce([]);
    expect(isInWindow(10, { start: "09:00", end: "00:30" })).toBe(true);
  });

  it("reads malformed times as zero", () => {
    expect(isInWindow(10, { start: "", end: "00:30" })).toBe(true);
    expect(isInWindow(40, { start: "", end: "00:30" })).toBe(false);
  });
});

describe("firstRunAt", () => {
  const now = new Date("2026-11-25T10:00:00Z");

  it("returns no time for manual and event triggers", () => {
    expect(firstRunAt({ type: "manual" }, now)).toBeNull();
    expect(firstRunAt(EVENT, now)).toBeNull();
  });

  it("keeps the time of a once trigger", () => {
    expect(
      firstRunAt(
        { type: "once", at: "2026-12-01T08:00:00Z", timeZone: "UTC" },
        now,
      ),
    ).toBe("2026-12-01T08:00:00.000Z");
    expect(
      firstRunAt({ type: "once", at: null, timeZone: "UTC" }, now),
    ).toBeNull();
  });

  it("adds a fixed interval for seconds to hours", () => {
    expect(firstRunAt(interval({ every: 2, unit: "hour" }), now)).toBe(
      "2026-11-25T12:00:00.000Z",
    );
  });

  it("adds calendar days of the time zone across a clock change", () => {
    const start = new Date("2026-10-24T10:30:15Z");
    expect(
      firstRunAt(interval({ every: 2, unit: "day", timeZone: BERLIN }), start),
    ).toBe("2026-10-26T11:30:15.000Z");
  });

  it("moves to the start of the window", () => {
    const trigger = interval({ window: { start: "13:00", end: "14:00" } });
    expect(firstRunAt(trigger, now)).toBe("2026-11-25T13:00:00.000Z");
    expect(firstRunAt(trigger, new Date("2026-11-25T15:00:00Z"))).toBe(
      "2026-11-26T13:00:00.000Z",
    );
  });

  it("moves to the next allowed weekday", () => {
    // 2026-11-25 is a Wednesday.
    expect(firstRunAt(interval({ weekdays: [5] }), now)).toBe(
      "2026-11-27T00:00:00.000Z",
    );
  });

  it("gives up when no day is ever allowed", () => {
    expect(firstRunAt(interval({ weekdays: [] }), now)).toBeNull();
  });

  it("plans weekly triggers", () => {
    expect(firstRunAt(weekly(), now)).toBe("2026-11-26T09:00:00.000Z");
    expect(firstRunAt(weekly({ times: ["11:00", "10:30"] }), now)).toBe(
      "2026-11-25T10:30:00.000Z",
    );
  });

  it("skips weekdays that do not match", () => {
    expect(firstRunAt(weekly({ weekdays: [1] }), now)).toBe(
      "2026-11-30T09:00:00.000Z",
    );
  });

  it("returns no time without usable weekly times or days", () => {
    expect(
      firstRunAt(weekly({ window: { start: "10:00", end: "11:00" } }), now),
    ).toBeNull();
    expect(firstRunAt(weekly({ weekdays: [] }), now)).toBeNull();
  });
});

describe("nextRunAfter", () => {
  const now = new Date("2026-11-25T10:00:00Z");

  it("returns no time for triggers without a rhythm", () => {
    const dueAt = new Date("2026-11-25T09:00:00Z");
    expect(nextRunAfter({ type: "manual" }, dueAt, now)).toBeNull();
    expect(
      nextRunAfter({ type: "once", at: null, timeZone: "UTC" }, dueAt, now),
    ).toBeNull();
    expect(nextRunAfter(EVENT, dueAt, now)).toBeNull();
  });

  it("keeps the rhythm of an interval that is on time", () => {
    const dueAt = new Date("2026-11-25T09:30:00Z");
    expect(nextRunAfter(interval(), dueAt, now)).toBe(
      "2026-11-25T10:30:00.000Z",
    );
  });

  it("plans a missed interval from now", () => {
    const dueAt = new Date("2026-11-20T09:30:00Z");
    expect(nextRunAfter(interval(), dueAt, now)).toBe(
      "2026-11-25T11:00:00.000Z",
    );
  });

  it("plans weekly triggers after the later of due time and now", () => {
    expect(nextRunAfter(weekly(), new Date("2026-11-20T09:00:00Z"), now)).toBe(
      "2026-11-26T09:00:00.000Z",
    );
    expect(nextRunAfter(weekly(), new Date("2026-11-27T09:00:00Z"), now)).toBe(
      "2026-11-28T09:00:00.000Z",
    );
  });
});

describe("zonedInstant", () => {
  it("rejects text that is no wall clock", () => {
    expect(zonedInstant("2026-11-25", BERLIN)).toBeNull();
    expect(zonedInstant("2026-00-25T10:00", BERLIN)).toBeNull();
    expect(zonedInstant("2026-13-25T10:00", BERLIN)).toBeNull();
    expect(zonedInstant("2026-11-00T10:00", BERLIN)).toBeNull();
    expect(zonedInstant("2026-11-32T10:00", BERLIN)).toBeNull();
    expect(zonedInstant("2026-11-25T24:00", BERLIN)).toBeNull();
    expect(zonedInstant("2026-11-25T10:60", BERLIN)).toBeNull();
  });

  it("converts a wall clock with and without seconds", () => {
    expect(zonedInstant("2026-11-25T10:00", BERLIN)).toBe(
      "2026-11-25T09:00:00.000Z",
    );
    expect(zonedInstant("2026-07-25T10:00:30", BERLIN)).toBe(
      "2026-07-25T08:00:30.000Z",
    );
  });

  it("reads missing seconds as zero", () => {
    vi.spyOn(RegExp.prototype, "exec").mockReturnValueOnce([
      "",
      "2026",
      "11",
      "25",
      "10",
      "00",
    ] as unknown as RegExpExecArray);
    expect(zonedInstant("ignored", "UTC")).toBe("2026-11-25T10:00:00.000Z");
  });

  it("runs a time skipped by the clock change after the jump", () => {
    expect(zonedInstant("2026-03-29T02:30", BERLIN)).toBe(
      "2026-03-29T01:30:00.000Z",
    );
  });

  it("uses the first occurrence of a repeated time", () => {
    expect(zonedInstant("2026-10-25T02:30", BERLIN)).toBe(
      "2026-10-25T00:30:00.000Z",
    );
  });
});

describe("wallClockOf", () => {
  it("returns the wall clock parts of an instant", () => {
    expect(wallClockOf(Date.parse("2026-11-25T23:30:00Z"), BERLIN)).toEqual({
      year: 2026,
      month: 11,
      day: 26,
      hour: 0,
      minute: 30,
      weekday: 4,
    });
  });

  it("falls back for missing or unknown parts", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts")
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ type: "weekday", value: "Xyz" }]);
    expect(wallClockOf(0, "Asia/Tokyo")).toMatchObject({ year: 0, weekday: 1 });
    expect(wallClockOf(0, "Asia/Tokyo").weekday).toBe(1);
  });

  it("reads hour 24 as midnight", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue([
      { type: "hour", value: "24" },
    ]);
    expect(wallClockOf(0, "UTC").hour).toBe(0);
  });
});
