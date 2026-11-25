import { expect, it, vi } from "vitest";

import { CalendarError } from "@/backend/error/CalendarError";

import {
  checkCalendarInvitees,
  normalizeRecurrence,
  readCalendarTime,
} from "./CalendarEventInput";

import type { CalendarRecurrence } from "@/definition/Calendar";

const BERLIN = "Europe/Berlin";

function rule(overrides: Partial<CalendarRecurrence>): CalendarRecurrence {
  return {
    frequency: "weekly",
    interval: 1,
    weekdays: [],
    until: null,
    count: null,
    ...overrides,
  };
}

it("reads an all-day time", () => {
  expect(
    readCalendarTime(
      { start: "2026-11-01", end: "2026-11-03T10:00:00Z", allDay: true },
      BERLIN,
    ),
  ).toEqual({
    allDay: true,
    startAt: "2026-11-01",
    endAt: "2026-11-03",
    startDate: "2026-11-01",
  });
});

it("rejects an all-day end before the start", () => {
  expect(() =>
    readCalendarTime(
      { start: "2026-11-03", end: "2026-11-01", allDay: true },
      BERLIN,
    ),
  ).toThrow(CalendarError);
});

it("reads a timed time", () => {
  expect(
    readCalendarTime(
      {
        start: "2026-11-01T10:00:00+01:00",
        end: "2026-11-01T11:00:00+01:00",
        allDay: false,
      },
      BERLIN,
    ),
  ).toEqual({
    allDay: false,
    startAt: "2026-11-01T09:00:00.000Z",
    endAt: "2026-11-01T10:00:00.000Z",
    startDate: "2026-11-01",
  });
});

it.each([
  ["2026-11-01T11:00:00Z", "2026-11-01T10:00:00Z"],
  ["2026-11-01T11:00:00Z", "2026-11-01T11:00:00Z"],
  ["nonsense", "2026-11-01T11:00:00Z"],
  ["2026-11-01T11:00:00Z", "nonsense"],
])("rejects the timed range %s to %s", (start, end) => {
  expect(() => readCalendarTime({ start, end, allDay: false }, BERLIN)).toThrow(
    CalendarError,
  );
});

it("keeps no rule", () => {
  expect(normalizeRecurrence(null, "2026-11-01")).toBeNull();
});

it("rejects a series that ends before it starts", () => {
  expect(() =>
    normalizeRecurrence(rule({ until: "2026-10-01" }), "2026-11-01"),
  ).toThrow(CalendarError);
});

it("clears weekdays of non weekly rules", () => {
  expect(
    normalizeRecurrence(
      rule({ frequency: "daily", weekdays: ["mo"], until: "2026-12-01" }),
      "2026-11-01",
    )?.weekdays,
  ).toEqual([]);
});

it("uses the weekday of the start for a weekly rule", () => {
  expect(normalizeRecurrence(rule({}), "2026-11-04")?.weekdays).toEqual(["we"]);
});

it("orders the weekdays of a weekly rule", () => {
  expect(
    normalizeRecurrence(rule({ weekdays: ["fr", "mo"] }), "2026-11-04")
      ?.weekdays,
  ).toEqual(["mo", "fr"]);
});

it("falls back to Monday when the weekday index has no name", async () => {
  vi.resetModules();
  vi.doMock("./CalendarTime", async () => ({
    ...(await vi.importActual<Record<string, unknown>>("./CalendarTime")),
    weekdayIndex: () => 9,
  }));
  const fresh = await import("./CalendarEventInput");
  expect(fresh.normalizeRecurrence(rule({}), "2026-11-04")?.weekdays).toEqual([
    "mo",
  ]);
  vi.doUnmock("./CalendarTime");
  vi.resetModules();
});

function directory(): Parameters<typeof checkCalendarInvitees>[0] {
  return {
    findAccounts: vi.fn(() =>
      Promise.resolve([
        { id: "p1", name: "P", isAgent: false, isActive: true },
        { id: "a1", name: "A", isAgent: true, isActive: true },
        { id: "p2", name: "Q", isAgent: false, isActive: false },
      ]),
    ),
    findGroups: vi.fn(() => Promise.resolve([{ id: "g1", name: "G" }])),
    findDepartments: vi.fn(() => Promise.resolve([{ id: "d1", name: "D" }])),
  };
}

it("accepts valid invitees without duplicates", async () => {
  const list = await checkCalendarInvitees(directory(), [
    { kind: "person", id: "p1" },
    { kind: "person", id: "p1" },
    { kind: "agent", id: "a1" },
    { kind: "group", id: "g1" },
    { kind: "department", id: "d1" },
  ]);
  expect(list).toHaveLength(4);
});

it.each([
  { kind: "person", id: "a1" },
  { kind: "agent", id: "p1" },
  { kind: "person", id: "p2" },
  { kind: "person", id: "missing" },
  { kind: "agent", id: "missing" },
  { kind: "group", id: "missing" },
  { kind: "department", id: "missing" },
] as const)("rejects the invitee %j", async (invitee) => {
  await expect(checkCalendarInvitees(directory(), [invitee])).rejects.toThrow(
    CalendarError,
  );
});
