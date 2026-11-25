import { expect, it } from "vitest";

import {
  calendarTexts,
  compareEntries,
  formatOccurrence,
  formatOccurrenceKey,
  nextDay,
  occurrenceEntryId,
  parseEntryId,
  toDueEntry,
  toEventEntry,
  toMilestoneEntry,
  toProjectDateEntry,
} from "./CalendarProjection";

import type { CalendarEventRecord } from "@/backend/database/repositories/calendar/CalendarEventRepository";
import type { CalendarViewEntry } from "@/definition/Calendar";
import type { CalendarOccurrence } from "./CalendarOccurrences";
import type { CalendarParticipants } from "./CalendarPeople";
import type { CalendarViewer } from "./CalendarViewer";

function viewer(overrides: Partial<CalendarViewer> = {}): CalendarViewer {
  return {
    user: {
      id: "u1",
      username: "me",
      displayName: "Me",
      role: "employee",
      isActive: true,
      mustChangePassword: false,
    },
    timeZone: "Europe/Berlin",
    language: "en",
    groupIds: [],
    departmentIds: [],
    projects: [],
    isAdmin: false,
    ...overrides,
  };
}

function event(
  overrides: Partial<CalendarEventRecord> = {},
): CalendarEventRecord {
  return {
    id: "e1",
    title: "T",
    description: "",
    allDay: false,
    startAt: "2026-11-02T08:00:00.000Z",
    endAt: "2026-11-02T09:00:00.000Z",
    timeZone: "Europe/Berlin",
    projectId: null,
    createdBy: "u1",
    revision: 1,
    deletedAt: null,
    recurrence: null,
    ...overrides,
  };
}

const OCCURRENCE: CalendarOccurrence = {
  key: "2026-11-02T08:00:00.000Z",
  allDay: false,
  startMs: Date.parse("2026-11-02T08:00:00.000Z"),
  endMs: Date.parse("2026-11-02T09:00:00.000Z"),
  startDate: "2026-11-02",
  endDate: "2026-11-02",
  title: "Occ",
  description: "Desc",
};

function participants(
  overrides: Partial<CalendarParticipants> = {},
): CalendarParticipants {
  return {
    invitees: [],
    responses: [],
    affectedIds: new Set(["u1"]),
    createdBy: { id: "u1", name: "Me" },
    ...overrides,
  };
}

const RECURRENCE = {
  frequency: "daily",
  interval: 1,
  weekdays: [],
  until: null,
  count: null,
} as const;

it("offers texts per language", () => {
  expect(calendarTexts("de").due("A-1")).toBe("A-1 fällig");
  expect(calendarTexts("de").milestone("M")).toBe("Meilenstein M");
  expect(calendarTexts("en").due("A-1")).toBe("A-1 due");
  expect(calendarTexts("en").milestone("M")).toBe("Milestone M");
});

it("builds and parses entry ids", () => {
  expect(occurrenceEntryId("e1", "k")).toBe("e1~k");
  expect(parseEntryId("e1~k~x")).toEqual({ eventId: "e1", key: "k~x" });
  expect(parseEntryId("e1")).toEqual({ eventId: "e1", key: null });
});

it("formats occurrences and keys", () => {
  expect(
    formatOccurrence(
      { ...OCCURRENCE, allDay: true, startDate: "a", endDate: "b" },
      "UTC",
    ),
  ).toEqual({ start: "a", end: "b" });
  expect(formatOccurrence(OCCURRENCE, "Europe/Berlin")).toEqual({
    start: "2026-11-02T09:00:00+01:00",
    end: "2026-11-02T10:00:00+01:00",
  });
  expect(
    formatOccurrence({ ...OCCURRENCE, startMs: null, endMs: null }, "UTC"),
  ).toEqual({
    start: "1970-01-01T00:00:00+00:00",
    end: "1970-01-01T00:00:00+00:00",
  });
  expect(formatOccurrenceKey("2026-11-02", "UTC")).toBe("2026-11-02");
  expect(formatOccurrenceKey("2026-11-02T08:00:00.000Z", "UTC")).toBe(
    "2026-11-02T08:00:00+00:00",
  );
});

it("builds the entry of a recurring personal event", () => {
  const entry = toEventEntry({
    event: event({ recurrence: RECURRENCE }),
    occurrence: OCCURRENCE,
    participants: participants({
      responses: [
        { userId: "u2", name: "O", response: "declined" },
        { userId: "u1", name: "Me", response: "accepted" },
      ],
    }),
    viewer: viewer(),
    projectNames: new Map(),
    isViewerAgent: false,
  });
  expect(entry).toMatchObject({
    id: "e1~2026-11-02T08:00:00.000Z",
    seriesId: "e1",
    myResponse: "accepted",
    editable: true,
    calendar: { kind: "personal", name: "My events" },
    details: { createdByMe: true },
  });
});

it("builds the entry of a single project event for an agent", () => {
  const entry = toEventEntry({
    event: event({ projectId: "p1", createdBy: "u2" }),
    occurrence: { ...OCCURRENCE, key: null },
    participants: participants(),
    viewer: viewer({ isAdmin: true }),
    projectNames: new Map([["p1", "Project"]]),
    isViewerAgent: true,
  });
  expect(entry).toMatchObject({
    id: "e1",
    seriesId: null,
    occurrenceStart: null,
    myResponse: "open",
    editable: true,
    calendar: { kind: "project", name: "Project" },
    details: { createdByMe: false },
  });
});

it("handles invitations, unknown projects and rules without key", () => {
  const entry = toEventEntry({
    event: event({ projectId: "p9", createdBy: "u2", recurrence: RECURRENCE }),
    occurrence: { ...OCCURRENCE, key: null },
    participants: participants({ affectedIds: new Set() }),
    viewer: viewer(),
    projectNames: new Map(),
    isViewerAgent: false,
  });
  expect(entry).toMatchObject({
    id: "e1",
    seriesId: null,
    myResponse: null,
    editable: false,
    calendar: { name: "p9" },
  });
  const invited = toEventEntry({
    event: event({ createdBy: "u2" }),
    occurrence: OCCURRENCE,
    participants: participants(),
    viewer: viewer({ language: "de" }),
    projectNames: new Map(),
    isViewerAgent: false,
  });
  expect(invited).toMatchObject({
    myResponse: "open",
    calendar: { name: "Einladungen" },
  });
});

it("builds project date entries", () => {
  const record = {
    id: "d1",
    projectId: "p 1",
    projectName: "P",
    title: "T",
    description: "D",
    date: "2026-11-02",
    time: null,
  };
  expect(toProjectDateEntry(record, viewer())).toMatchObject({
    id: "project-event:d1",
    allDay: true,
    start: "2026-11-02",
    details: { link: "/projekte/p%201" },
  });
  expect(
    toProjectDateEntry({ ...record, time: "10:30" }, viewer()),
  ).toMatchObject({
    allDay: false,
    start: "2026-11-02T10:30:00+01:00",
    end: "2026-11-02T11:30:00+01:00",
  });
});

it("builds due and milestone entries", () => {
  expect(
    toDueEntry(
      {
        id: "t1",
        key: "A-1",
        title: "Ticket",
        projectId: "p1",
        projectName: "P",
        date: "2026-11-02",
      },
      viewer(),
    ),
  ).toMatchObject({
    id: "due:t1",
    title: "A-1 due",
    description: "Ticket",
    details: { link: "/aufgaben/A-1" },
  });
  expect(
    toMilestoneEntry(
      {
        id: "m1",
        name: "Beta",
        description: "D",
        projectId: "p1",
        projectName: "P",
        date: "2026-11-02",
      },
      viewer({ language: "de" }),
    ),
  ).toMatchObject({
    id: "milestone:m1",
    title: "Meilenstein Beta",
    calendar: { name: "Fälligkeiten und Meilensteine" },
  });
});

it("orders entries", () => {
  const make = (
    start: string,
    allDay: boolean,
    title: string,
  ): CalendarViewEntry =>
    ({ start, allDay, title }) as unknown as CalendarViewEntry;
  const a = make("2026-11-02", true, "a");
  expect(
    compareEntries(
      make("2026-11-02", true, "a"),
      make("2026-11-03", true, "a"),
    ),
  ).toBe(-1);
  expect(
    compareEntries(
      make("2026-11-03", true, "a"),
      make("2026-11-02", true, "a"),
    ),
  ).toBe(1);
  expect(compareEntries(a, make("2026-11-02T10:00:00", false, "a"))).toBe(-1);
  expect(compareEntries(make("2026-11-02T10:00:00", false, "a"), a)).toBe(1);
  expect(
    compareEntries(
      make("2026-11-02T09:00:00", false, "a"),
      make("2026-11-02T10:00:00", false, "a"),
    ),
  ).toBe(-1);
  expect(
    compareEntries(
      make("2026-11-02T10:00:00", false, "a"),
      make("2026-11-02T09:00:00", false, "a"),
    ),
  ).toBe(1);
  expect(compareEntries(a, make("2026-11-02", true, "b"))).toBeLessThan(0);
});

it("returns the next day", () => {
  expect(nextDay("2026-11-30")).toBe("2026-12-01");
});
