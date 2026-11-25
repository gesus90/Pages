import { expect, it } from "vitest";

import {
  expandOccurrences,
  findOccurrence,
  normalizeOccurrenceKey,
  occurrenceDateOf,
  occurrenceKeyOn,
  readStoredTime,
  touchesWindow,
} from "./CalendarOccurrences";

import type { CalendarEventRecord } from "@/backend/database/repositories/calendar/CalendarEventRepository";
import type { CalendarExceptionRecord } from "@/backend/database/repositories/calendar/CalendarEventRepository";
import type { CalendarWindow, OccurrenceTime } from "./CalendarOccurrences";

const BERLIN = "Europe/Berlin";

function event(overrides: Partial<CalendarEventRecord>): CalendarEventRecord {
  return {
    id: "e1",
    title: "Title",
    description: "Text",
    allDay: false,
    startAt: "2026-11-02T08:00:00.000Z",
    endAt: "2026-11-02T09:00:00.000Z",
    timeZone: BERLIN,
    projectId: null,
    createdBy: "u1",
    revision: 1,
    deletedAt: null,
    recurrence: null,
    ...overrides,
  };
}

const DAILY = {
  frequency: "daily",
  interval: 1,
  weekdays: [],
  until: null,
  count: null,
} as const;

function exception(
  overrides: Partial<CalendarExceptionRecord>,
): CalendarExceptionRecord {
  return {
    eventId: "e1",
    occurrenceStart: "2026-11-03T08:00:00.000Z",
    isCancelled: false,
    title: null,
    description: null,
    allDay: null,
    startAt: null,
    endAt: null,
    ...overrides,
  };
}

const WINDOW: CalendarWindow = {
  fromMs: Date.parse("2026-11-01T00:00:00Z"),
  toMs: Date.parse("2026-11-06T00:00:00Z"),
  fromDate: "2026-11-01",
  toDate: "2026-11-05",
};

it("reads stored all-day times", () => {
  expect(
    readStoredTime(
      { allDay: true, startAt: "2026-11-01", endAt: "2026-11-02" },
      BERLIN,
    ),
  ).toEqual({
    allDay: true,
    startMs: null,
    endMs: null,
    startDate: "2026-11-01",
    endDate: "2026-11-02",
  });
});

it("reads stored timed times from instants and dates", () => {
  expect(
    readStoredTime(
      {
        allDay: false,
        startAt: "2026-11-01T23:30:00.000Z",
        endAt: "2026-11-02T10:00:00.000Z",
      },
      BERLIN,
    ),
  ).toMatchObject({ startDate: "2026-11-02", endDate: "2026-11-02" });
  expect(
    readStoredTime(
      { allDay: false, startAt: "2026-11-02", endAt: "2026-11-03" },
      BERLIN,
    ),
  ).toMatchObject({
    startMs: Date.parse("2026-11-01T23:00:00Z"),
    endMs: Date.parse("2026-11-02T23:00:00Z"),
  });
});

it("computes and reads occurrence keys", () => {
  expect(occurrenceKeyOn(event({}), "2026-11-04")).toBe(
    "2026-11-04T08:00:00.000Z",
  );
  expect(occurrenceKeyOn(event({ allDay: true }), "2026-11-04")).toBe(
    "2026-11-04",
  );
  expect(occurrenceDateOf(event({}), "2026-11-04")).toBe("2026-11-04");
  expect(occurrenceDateOf(event({}), "2026-11-04T23:30:00.000Z")).toBe(
    "2026-11-05",
  );
});

it("normalizes client keys", () => {
  const timed = event({});
  expect(
    normalizeOccurrenceKey(event({ allDay: true }), "2026-11-04T10:00"),
  ).toBe("2026-11-04");
  expect(normalizeOccurrenceKey(timed, "2026-11-04")).toBe(
    "2026-11-04T08:00:00.000Z",
  );
  expect(normalizeOccurrenceKey(timed, "2026-11-04T09:00:00+01:00")).toBe(
    "2026-11-04T08:00:00.000Z",
  );
  expect(normalizeOccurrenceKey(timed, "garbage")).toBe("garbage");
});

it("tests windows for all-day and timed occurrences", () => {
  const allDay: OccurrenceTime = {
    allDay: true,
    startMs: null,
    endMs: null,
    startDate: "2026-11-05",
    endDate: "2026-11-07",
  };
  expect(touchesWindow(allDay, WINDOW)).toBe(true);
  expect(touchesWindow({ ...allDay, startDate: "2026-11-06" }, WINDOW)).toBe(
    false,
  );
  const timed: OccurrenceTime = {
    allDay: false,
    startMs: WINDOW.fromMs - 1000,
    endMs: WINDOW.fromMs - 1000,
    startDate: "x",
    endDate: "x",
  };
  expect(touchesWindow(timed, WINDOW)).toBe(false);
  expect(touchesWindow({ ...timed, endMs: WINDOW.fromMs + 1000 }, WINDOW)).toBe(
    true,
  );
  expect(touchesWindow({ ...timed, startMs: null, endMs: null }, WINDOW)).toBe(
    false,
  );
});

it("expands a single event", () => {
  expect(expandOccurrences(event({}), [], WINDOW)).toEqual([
    expect.objectContaining({ key: null, title: "Title" }),
  ]);
  expect(
    expandOccurrences(
      event({
        startAt: "2026-12-02T08:00:00.000Z",
        endAt: "2026-12-02T09:00:00.000Z",
      }),
      [],
      WINDOW,
    ),
  ).toEqual([]);
});

it("expands a daily series with exceptions", () => {
  const list = expandOccurrences(
    event({ recurrence: DAILY }),
    [
      exception({
        occurrenceStart: "2026-11-02T08:00:00.000Z",
        title: "Moved",
        description: "D",
      }),
      exception({
        occurrenceStart: "2026-11-03T08:00:00.000Z",
        isCancelled: true,
      }),
      exception({
        occurrenceStart: "2026-11-04T08:00:00.000Z",
        allDay: true,
        startAt: "2026-11-04",
        endAt: "2026-11-04",
      }),
    ],
    WINDOW,
  );
  expect(list.map((entry) => entry.key)).toEqual([
    "2026-11-02T08:00:00.000Z",
    "2026-11-04T08:00:00.000Z",
    "2026-11-05T08:00:00.000Z",
  ]);
  expect(list[0]).toMatchObject({ title: "Moved", description: "D" });
  expect(list[1]).toMatchObject({ allDay: true, title: "Title" });
});

it("expands an all-day series spanning days", () => {
  const list = expandOccurrences(
    event({
      allDay: true,
      startAt: "2026-10-30",
      endAt: "2026-11-01",
      recurrence: { ...DAILY, interval: 3, count: 4 },
    }),
    [],
    WINDOW,
  );
  expect(list.map((entry) => [entry.startDate, entry.endDate])).toEqual([
    ["2026-10-30", "2026-11-01"],
    ["2026-11-02", "2026-11-04"],
    ["2026-11-05", "2026-11-07"],
  ]);
});

it("uses an exception with partial time as the plain occurrence", () => {
  const list = expandOccurrences(
    event({ recurrence: { ...DAILY, count: 1 } }),
    [exception({ occurrenceStart: "2026-11-02T08:00:00.000Z", allDay: true })],
    WINDOW,
  );
  expect(list[0]?.allDay).toBe(false);
  const startless = expandOccurrences(
    event({ recurrence: { ...DAILY, count: 1 } }),
    [
      exception({
        occurrenceStart: "2026-11-02T08:00:00.000Z",
        startAt: "2026-11-02T10:00:00.000Z",
        allDay: false,
      }),
    ],
    WINDOW,
  );
  expect(startless[0]?.allDay).toBe(false);
  const noAllDay = expandOccurrences(
    event({ recurrence: { ...DAILY, count: 1 } }),
    [
      exception({
        occurrenceStart: "2026-11-02T08:00:00.000Z",
        startAt: "2026-11-02T10:00:00.000Z",
        endAt: "2026-11-02T11:00:00.000Z",
      }),
    ],
    WINDOW,
  );
  expect(noAllDay[0]?.startMs).toBe(Date.parse("2026-11-02T08:00:00.000Z"));
});

it("finds occurrences", () => {
  const series = event({ recurrence: DAILY });
  const key = "2026-11-03T08:00:00.000Z";
  expect(findOccurrence(event({}), [], key)).toBeNull();
  expect(findOccurrence(series, [], key)).toMatchObject({ key });
  expect(
    findOccurrence(series, [exception({ title: "Own" })], key),
  ).toMatchObject({ title: "Own" });
  expect(
    findOccurrence(series, [exception({ isCancelled: true })], key),
  ).toBeNull();
  expect(findOccurrence(series, [], "2026-11-03T09:00:00.000Z")).toBeNull();
  expect(findOccurrence(series, [], "2026-11-01T08:00:00.000Z")).toBeNull();
  expect(
    findOccurrence(
      event({ recurrence: { ...DAILY, interval: 2 } }),
      [],
      "2026-11-03T08:00:00.000Z",
    ),
  ).toBeNull();
});
