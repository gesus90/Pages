import { describe, expect, it } from "vitest";

import {
  countOccurrencesFrom,
  listOccurrenceDates,
  splitRecurrence,
} from "@/backend/service/calendar/CalendarRecurrence";
import {
  expandOccurrences,
  findOccurrence,
} from "@/backend/service/calendar/CalendarOccurrences";
import {
  formatInZone,
  fromLocal,
  toLocal,
} from "@/backend/service/calendar/CalendarTime";

import type { CalendarEventRecord } from "@/backend/database/repositories/calendar/CalendarEventRepository";
import type { CalendarRecurrence } from "@/definition/Calendar";

function rule(partial: Partial<CalendarRecurrence>): CalendarRecurrence {
  return {
    frequency: "daily",
    interval: 1,
    weekdays: [],
    until: null,
    count: null,
    ...partial,
  };
}

function dates(
  recurrence: CalendarRecurrence,
  start: string,
  until: string,
): string[] {
  return listOccurrenceDates(recurrence, start, until).map(
    (entry) => entry.date,
  );
}

function weekly(
  overrides: Partial<CalendarEventRecord> = {},
): CalendarEventRecord {
  return {
    id: "event-1",
    title: "Weekly",
    description: "",
    allDay: false,
    startAt: new Date(
      fromLocal({ date: "2026-10-19", time: "09:00:00" }, "Europe/Berlin"),
    ).toISOString(),
    endAt: new Date(
      fromLocal({ date: "2026-10-19", time: "10:00:00" }, "Europe/Berlin"),
    ).toISOString(),
    timeZone: "Europe/Berlin",
    projectId: null,
    createdBy: "creator",
    revision: 1,
    deletedAt: null,
    recurrence: rule({ frequency: "weekly", weekdays: ["mo"] }),
    ...overrides,
  };
}

describe("calendar recurrence", () => {
  it("repeats daily, every working day and with an end after N occurrences", () => {
    expect(dates(rule({ count: 3 }), "2026-11-09", "2026-12-31")).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
    ]);
    expect(
      dates(
        rule({ frequency: "weekly", weekdays: ["mo", "tu", "we", "th", "fr"] }),
        "2026-11-12",
        "2026-11-18",
      ),
    ).toEqual([
      "2026-11-12",
      "2026-11-13",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
    ]);
  });

  it("repeats every second week on chosen weekdays until a date", () => {
    expect(
      dates(
        rule({
          frequency: "weekly",
          interval: 2,
          weekdays: ["mo", "th"],
          until: "2026-11-30",
        }),
        "2026-11-02",
        "2026-12-31",
      ),
    ).toEqual([
      "2026-11-02",
      "2026-11-05",
      "2026-11-16",
      "2026-11-19",
      "2026-11-30",
    ]);
  });

  it("skips months without the day and leap days in other years", () => {
    expect(
      dates(rule({ frequency: "monthly" }), "2026-01-31", "2026-06-30"),
    ).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
    expect(
      dates(rule({ frequency: "yearly" }), "2024-02-29", "2032-12-31"),
    ).toEqual(["2024-02-29", "2028-02-29", "2032-02-29"]);
  });

  it("counts and splits a series for this and all following", () => {
    const counted = rule({ count: 10 });
    expect(countOccurrencesFrom(counted, "2026-11-01", "2026-11-05")).toBe(6);
    expect(countOccurrencesFrom(rule({}), "2026-11-01", "2026-11-05")).toBe(
      "unbegrenzt",
    );
    expect(splitRecurrence(counted, "2026-11-01", "2026-11-05")).toEqual({
      before: { ...counted, count: 4 },
      after: { ...counted, count: 6 },
    });
    expect(
      splitRecurrence(rule({}), "2026-11-01", "2026-11-01").before,
    ).toBeNull();
  });
});

describe("calendar occurrences", () => {
  it("keeps a weekly event at 09:00 local time across the change from summer time", () => {
    const window = {
      fromMs: Date.parse("2026-10-18T00:00:00Z"),
      toMs: Date.parse("2026-11-03T00:00:00Z"),
      fromDate: "2026-10-18",
      toDate: "2026-11-02",
    };
    const occurrences = expandOccurrences(weekly(), [], window);
    expect(
      occurrences.map((entry) =>
        formatInZone(entry.startMs ?? 0, "Europe/Berlin"),
      ),
    ).toEqual([
      "2026-10-19T09:00:00+02:00",
      "2026-10-26T09:00:00+01:00",
      "2026-11-02T09:00:00+01:00",
    ]);
    expect(toLocal(occurrences[1]?.endMs ?? 0, "Europe/Berlin").time).toBe(
      "10:00:00",
    );
  });

  it("applies cancelled and changed occurrences", () => {
    const event = weekly();
    const window = {
      fromMs: Date.parse("2026-10-18T00:00:00Z"),
      toMs: Date.parse("2026-11-03T00:00:00Z"),
      fromDate: "2026-10-18",
      toDate: "2026-11-02",
    };
    const [first, second] = expandOccurrences(event, [], window);
    const exceptions = [
      {
        eventId: event.id,
        occurrenceStart: first?.key ?? "",
        isCancelled: true,
        title: null,
        description: null,
        allDay: null,
        startAt: null,
        endAt: null,
      },
      {
        eventId: event.id,
        occurrenceStart: second?.key ?? "",
        isCancelled: false,
        title: "Moved",
        description: null,
        allDay: null,
        startAt: null,
        endAt: null,
      },
    ];
    const occurrences = expandOccurrences(event, exceptions, window);
    expect(occurrences.map((entry) => entry.title)).toEqual([
      "Moved",
      "Weekly",
    ]);
    expect(findOccurrence(event, exceptions, first?.key ?? "")).toBeNull();
    expect(findOccurrence(event, exceptions, second?.key ?? "")?.title).toBe(
      "Moved",
    );
  });

  it("shows multi-day all-day events in every window they touch", () => {
    const event = weekly({
      allDay: true,
      startAt: "2026-11-12",
      endAt: "2026-11-14",
      recurrence: null,
    });
    const window = {
      fromMs: Date.parse("2026-11-13T23:00:00Z"),
      toMs: Date.parse("2026-11-14T23:00:00Z"),
      fromDate: "2026-11-14",
      toDate: "2026-11-14",
    };
    expect(expandOccurrences(event, [], window)).toHaveLength(1);
  });
});
