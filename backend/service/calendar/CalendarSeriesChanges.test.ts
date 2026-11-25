import { beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarError } from "@/backend/error/CalendarError";

import { CalendarSeriesChanges } from "./CalendarSeriesChanges";

import type {
  CalendarEventRecord,
  CalendarExceptionRecord,
} from "@/backend/database/repositories/calendar/CalendarEventRepository";
import type {
  CalendarEventPatch,
  CalendarRecurrence,
} from "@/definition/Calendar";
import type { CalendarOccurrence } from "./CalendarOccurrences";
import type { CalendarDependencies, CalendarViewer } from "./CalendarViewer";

const DAILY: CalendarRecurrence = {
  frequency: "daily",
  interval: 1,
  weekdays: [],
  until: null,
  count: null,
};

const viewer = doubleOf<CalendarViewer>({ timeZone: "UTC" });

function eventOf(
  overrides: Partial<CalendarEventRecord> = {},
): CalendarEventRecord {
  return {
    id: "e1",
    title: "Title",
    description: "Text",
    allDay: false,
    startAt: "2026-03-02T09:00:00.000Z",
    endAt: "2026-03-02T10:00:00.000Z",
    timeZone: "UTC",
    projectId: null,
    createdBy: "u1",
    revision: 1,
    deletedAt: null,
    recurrence: DAILY,
    ...overrides,
  };
}

function allDayEvent(): CalendarEventRecord {
  return eventOf({
    allDay: true,
    startAt: "2026-03-02",
    endAt: "2026-03-03",
  });
}

function exceptionOf(
  overrides: Partial<CalendarExceptionRecord> = {},
): CalendarExceptionRecord {
  return {
    eventId: "e1",
    occurrenceStart: "2026-03-04T09:00:00.000Z",
    isCancelled: false,
    title: "Old",
    description: "Old text",
    allDay: false,
    startAt: "2026-03-04T09:00:00.000Z",
    endAt: "2026-03-04T10:00:00.000Z",
    ...overrides,
  };
}

function setup(): {
  readonly changes: CalendarSeriesChanges;
  readonly events: Record<string, ReturnType<typeof vi.fn>>;
  readonly participation: Record<string, ReturnType<typeof vi.fn>>;
} {
  const events = {
    findExceptions: vi.fn(async () => [] as CalendarExceptionRecord[]),
    update: vi.fn(async () => {}),
    deleteExceptions: vi.fn(async () => {}),
    saveException: vi.fn(async () => {}),
    touch: vi.fn(async () => {}),
    insert: vi.fn(async () => {}),
    markDeleted: vi.fn(async () => {}),
  };
  const participation = {
    reopenAcceptances: vi.fn(async () => {}),
    replaceInvitations: vi.fn(async () => {}),
    findInvitations: vi.fn(async () => [
      { kind: "person", inviteeId: "u2" },
      { kind: "group", inviteeId: "g1" },
    ]),
    copyResponses: vi.fn(async () => {}),
  };
  const directory = {
    findAccounts: vi.fn(async () => [
      { id: "u2", isActive: true, isAgent: false },
    ]),
    findGroups: vi.fn(async () => []),
    findDepartments: vi.fn(async () => []),
  };
  const changes = new CalendarSeriesChanges(
    doubleOf<CalendarDependencies>({ events, participation, directory }),
  );
  return { changes, events, participation };
}

async function occurrenceOf(
  changes: CalendarSeriesChanges,
  event: CalendarEventRecord,
  key: string,
): Promise<CalendarOccurrence & { readonly key: string }> {
  return changes.requireOccurrence(event, key);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CalendarSeriesChanges patchedEvent", () => {
  it("keeps the stored values without a patch", () => {
    const { changes } = setup();
    const event = eventOf();
    const next = changes.patchedEvent(event, {}, { viewer, occurrence: null });
    expect(next).toMatchObject({
      id: "e1",
      title: "Title",
      description: "Text",
      startAt: event.startAt,
      endAt: event.endAt,
      projectId: null,
      recurrence: { frequency: "daily", weekdays: [] },
    });
  });

  it("takes title, description, project and recurrence of the patch", () => {
    const { changes } = setup();
    const next = changes.patchedEvent(
      eventOf(),
      {
        title: "New",
        description: "Other",
        calendarProjectId: "p1",
        recurrence: null,
      },
      { viewer, occurrence: null },
    );
    expect(next).toMatchObject({
      title: "New",
      description: "Other",
      projectId: "p1",
      recurrence: null,
    });
  });

  it("reads a time patch without occurrence in the zone of the viewer", () => {
    const { changes } = setup();
    const next = changes.patchedEvent(
      eventOf({ recurrence: null }),
      { start: "2026-03-02T08:00:00.000Z" },
      { viewer, occurrence: null },
    );
    expect(next.startAt).toBe("2026-03-02T08:00:00.000Z");
    expect(next.endAt).toBe("2026-03-02T10:00:00.000Z");
  });

  it("reads an end and all-day patch of an event without rule", () => {
    const { changes } = setup();
    const next = changes.patchedEvent(
      eventOf({ recurrence: null }),
      { end: "2026-03-02T12:00:00.000Z", allDay: false },
      { viewer, occurrence: null },
    );
    expect(next.endAt).toBe("2026-03-02T12:00:00.000Z");
    const allDay = changes.patchedEvent(
      eventOf({ recurrence: null }),
      { allDay: true },
      { viewer, occurrence: null },
    );
    expect(allDay.allDay).toBe(true);
  });

  it("shifts a timed series by the change of one occurrence", async () => {
    const { changes } = setup();
    const event = eventOf();
    const occurrence = await occurrenceOf(
      changes,
      event,
      "2026-03-04T09:00:00.000Z",
    );
    const next = changes.patchedEvent(
      event,
      { start: "2026-03-05T11:00:00.000Z", end: "2026-03-05T13:00:00.000Z" },
      { viewer, occurrence },
    );
    expect(next.startAt).toBe("2026-03-03T11:00:00.000Z");
    expect(next.endAt).toBe("2026-03-03T13:00:00.000Z");
  });

  it("shifts an all-day series by the change of one occurrence", async () => {
    const { changes } = setup();
    const event = allDayEvent();
    const occurrence = await occurrenceOf(changes, event, "2026-03-04");
    const next = changes.patchedEvent(
      event,
      { start: "2026-03-05", end: "2026-03-06" },
      { viewer, occurrence },
    );
    expect(next).toMatchObject({
      allDay: true,
      startAt: "2026-03-03",
      endAt: "2026-03-04",
    });
  });
});

describe("CalendarSeriesChanges updateAll", () => {
  it("only updates an unchanged event", async () => {
    const { changes, events, participation } = setup();
    const event = eventOf();
    const next = changes.patchedEvent(event, {}, { viewer, occurrence: null });
    const result = await changes.updateAll(event, next, {});
    expect(result).toEqual({ eventIds: ["e1"], eventId: "e1", key: null });
    expect(events.update).toHaveBeenCalledWith(next);
    expect(events.deleteExceptions).not.toHaveBeenCalled();
    expect(participation.reopenAcceptances).not.toHaveBeenCalled();
    expect(participation.replaceInvitations).not.toHaveBeenCalled();
  });

  it("drops exceptions and reopens acceptances when the time changes", async () => {
    const { changes, events, participation } = setup();
    const event = eventOf();
    const patch = {
      start: "2026-03-02T11:00:00.000Z",
      end: "2026-03-02T12:00:00.000Z",
    };
    const next = changes.patchedEvent(event, patch, {
      viewer,
      occurrence: null,
    });
    await changes.updateAll(event, next, patch);
    expect(events.deleteExceptions).toHaveBeenCalledWith("e1");
    expect(participation.reopenAcceptances).toHaveBeenCalledWith("e1");
  });

  it("drops exceptions when only the rule changes, and checks invitees", async () => {
    const { changes, events, participation } = setup();
    const event = eventOf();
    const patch: CalendarEventPatch = {
      recurrence: {
        frequency: "daily",
        interval: 2,
        weekdays: [],
        until: null,
        count: null,
      },
      invitees: [{ kind: "person", id: "u2" }],
    };
    const next = changes.patchedEvent(event, patch, {
      viewer,
      occurrence: null,
    });
    await changes.updateAll(event, next, patch);
    expect(events.deleteExceptions).toHaveBeenCalledWith("e1");
    expect(participation.reopenAcceptances).not.toHaveBeenCalled();
    expect(participation.replaceInvitations).toHaveBeenCalledWith("e1", [
      { kind: "person", id: "u2" },
    ]);
  });
});

describe("CalendarSeriesChanges updateThis", () => {
  it("stores an exception with the patched fields", async () => {
    const { changes, events, participation } = setup();
    const event = eventOf();
    const occurrence = await occurrenceOf(
      changes,
      event,
      "2026-03-04T09:00:00.000Z",
    );
    const result = await changes.updateThis(event, occurrence, {
      patch: { title: "Only", description: "Here" },
      viewer,
    });
    expect(result).toEqual({
      eventIds: ["e1"],
      eventId: "e1",
      key: "2026-03-04T09:00:00.000Z",
    });
    expect(events.saveException).toHaveBeenCalledWith({
      eventId: "e1",
      occurrenceStart: "2026-03-04T09:00:00.000Z",
      isCancelled: false,
      title: "Only",
      description: "Here",
      allDay: null,
      startAt: null,
      endAt: null,
    });
    expect(events.touch).toHaveBeenCalledWith("e1");
    expect(participation.reopenAcceptances).not.toHaveBeenCalled();
  });

  it("keeps the values of an existing exception and sets a new time", async () => {
    const { changes, events, participation } = setup();
    const event = eventOf();
    events.findExceptions.mockResolvedValue([
      exceptionOf({ occurrenceStart: "other" }),
      exceptionOf(),
    ]);
    const occurrence = await occurrenceOf(
      changes,
      event,
      "2026-03-04T09:00:00.000Z",
    );
    await changes.updateThis(event, occurrence, {
      patch: {
        start: "2026-03-04T08:00:00.000Z",
        invitees: [{ kind: "person", id: "u2" }],
      },
      viewer,
    });
    expect(events.saveException).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Old",
        description: "Old text",
        allDay: false,
        startAt: "2026-03-04T08:00:00.000Z",
      }),
    );
    expect(participation.reopenAcceptances).toHaveBeenCalledWith("e1");
    expect(participation.replaceInvitations).toHaveBeenCalled();
  });
});

describe("CalendarSeriesChanges updateThis with exceptions", () => {
  it("keeps the time of an existing exception without a time patch", async () => {
    const { changes, events } = setup();
    const event = eventOf();
    events.findExceptions.mockResolvedValue([exceptionOf()]);
    const occurrence = await occurrenceOf(
      changes,
      event,
      "2026-03-04T09:00:00.000Z",
    );
    await changes.updateThis(event, occurrence, {
      patch: { title: "Again" },
      viewer,
    });
    expect(events.saveException).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Again",
        startAt: "2026-03-04T09:00:00.000Z",
        endAt: "2026-03-04T10:00:00.000Z",
      }),
    );
  });

  it("reads end and all-day patches of an occurrence", async () => {
    const { changes, events } = setup();
    const event = eventOf();
    const occurrence = await occurrenceOf(
      changes,
      event,
      "2026-03-04T09:00:00.000Z",
    );
    await changes.updateThis(event, occurrence, {
      patch: { end: "2026-03-04T12:00:00.000Z" },
      viewer,
    });
    await changes.updateThis(event, occurrence, {
      patch: { allDay: true },
      viewer,
    });
    expect(events.saveException).toHaveBeenCalledTimes(2);
  });
});

describe("CalendarSeriesChanges updateFollowing", () => {
  it("rejects an event that is no series", async () => {
    const { changes } = setup();
    const event = eventOf({ recurrence: null });
    const occurrence = doubleOf<CalendarOccurrence & { key: string }>({
      key: "2026-03-04T09:00:00.000Z",
    });
    await expect(
      changes.updateFollowing(event, occurrence, { patch: {}, viewer }),
    ).rejects.toBeInstanceOf(CalendarError);
  });

  it("splits the series and copies invitations and responses", async () => {
    const { changes, events, participation } = setup();
    const event = eventOf();
    const occurrence = await occurrenceOf(
      changes,
      event,
      "2026-03-04T09:00:00.000Z",
    );
    const result = await changes.updateFollowing(event, occurrence, {
      patch: { title: "Following" },
      viewer,
    });
    expect(result.eventIds[0]).toBe("e1");
    expect(result.eventId).toBe(result.eventIds[1]);
    expect(result.key).toBeNull();
    expect(events.update).toHaveBeenCalledWith({
      ...event,
      recurrence: { ...DAILY, until: "2026-03-03" },
    });
    expect(events.deleteExceptions).toHaveBeenCalledWith("e1", {
      fromOccurrence: "2026-03-04T09:00:00.000Z",
    });
    expect(events.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.eventId,
        title: "Following",
        description: "Text",
        projectId: null,
        startAt: "2026-03-04T09:00:00.000Z",
      }),
    );
    expect(participation.replaceInvitations).toHaveBeenCalledWith(
      result.eventId,
      [
        { kind: "person", id: "u2" },
        { kind: "group", id: "g1" },
      ],
    );
    expect(participation.copyResponses).toHaveBeenCalledWith(
      "e1",
      result.eventId,
    );
    expect(participation.reopenAcceptances).not.toHaveBeenCalled();
  });

  it("applies a full patch with a new time and invitees", async () => {
    const { changes, events, participation } = setup();
    const event = eventOf();
    const occurrence = await occurrenceOf(
      changes,
      event,
      "2026-03-04T09:00:00.000Z",
    );
    const result = await changes.updateFollowing(event, occurrence, {
      patch: {
        description: "Later",
        calendarProjectId: "p1",
        recurrence: null,
        start: "2026-03-04T10:00:00.000Z",
        end: "2026-03-04T11:00:00.000Z",
        allDay: false,
        invitees: [{ kind: "person", id: "u2" }],
      },
      viewer,
    });
    expect(events.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Later",
        projectId: "p1",
        recurrence: null,
        startAt: "2026-03-04T10:00:00.000Z",
      }),
    );
    expect(participation.replaceInvitations).toHaveBeenCalledWith(
      result.eventId,
      [{ kind: "person", id: "u2" }],
    );
    expect(participation.reopenAcceptances).toHaveBeenCalledWith(
      result.eventId,
    );
  });
});

describe("CalendarSeriesChanges delete", () => {
  it("deletes a single event, the whole series or without occurrence", async () => {
    const { changes, events } = setup();
    const series = eventOf();
    const occurrence = await occurrenceOf(
      changes,
      series,
      "2026-03-04T09:00:00.000Z",
    );
    await changes.delete(eventOf({ recurrence: null }), "this", occurrence);
    await changes.delete(series, "all", occurrence);
    await changes.delete(series, "following", null);
    expect(events.markDeleted).toHaveBeenCalledTimes(3);
  });

  it("cancels one occurrence", async () => {
    const { changes, events } = setup();
    const series = eventOf();
    const occurrence = await occurrenceOf(
      changes,
      series,
      "2026-03-04T09:00:00.000Z",
    );
    await changes.delete(series, "this", occurrence);
    expect(events.saveException).toHaveBeenCalledWith({
      eventId: "e1",
      occurrenceStart: "2026-03-04T09:00:00.000Z",
      isCancelled: true,
      title: null,
      description: null,
      allDay: null,
      startAt: null,
      endAt: null,
    });
    expect(events.touch).toHaveBeenCalledWith("e1");
  });

  it("ends the series before the occurrence", async () => {
    const { changes, events } = setup();
    const series = eventOf();
    const occurrence = await occurrenceOf(
      changes,
      series,
      "2026-03-04T09:00:00.000Z",
    );
    await changes.delete(series, "following", occurrence);
    expect(events.update).toHaveBeenCalledWith({
      ...series,
      recurrence: { ...DAILY, until: "2026-03-03" },
    });
    expect(events.deleteExceptions).toHaveBeenCalledWith("e1", {
      fromOccurrence: "2026-03-04T09:00:00.000Z",
    });
  });

  it("deletes the series when the first occurrence goes with its followers", async () => {
    const { changes, events } = setup();
    const series = eventOf();
    const occurrence = await occurrenceOf(
      changes,
      series,
      "2026-03-02T09:00:00.000Z",
    );
    await changes.delete(series, "following", occurrence);
    expect(events.markDeleted).toHaveBeenCalledWith("e1");
    expect(events.update).not.toHaveBeenCalled();
  });
});

describe("CalendarSeriesChanges requireOccurrence", () => {
  it("returns the occurrence of a key", async () => {
    const { changes } = setup();
    const occurrence = await changes.requireOccurrence(
      eventOf(),
      "2026-03-04T09:00:00.000Z",
    );
    expect(occurrence.key).toBe("2026-03-04T09:00:00.000Z");
    expect(occurrence.title).toBe("Title");
  });

  it("rejects a key that is no occurrence", async () => {
    const { changes } = setup();
    await expect(
      changes.requireOccurrence(eventOf(), "2026-03-04T08:00:00.000Z"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("CalendarSeriesChanges isFirstOccurrence", () => {
  it("counts an event without rule as first", () => {
    const { changes } = setup();
    expect(changes.isFirstOccurrence(eventOf({ recurrence: null }), "x")).toBe(
      true,
    );
  });

  it("compares the date with the first date of the rule", () => {
    const { changes } = setup();
    const event = eventOf();
    expect(changes.isFirstOccurrence(event, "2026-03-02T09:00:00.000Z")).toBe(
      true,
    );
    expect(changes.isFirstOccurrence(event, "2026-03-03T09:00:00.000Z")).toBe(
      false,
    );
  });

  it("falls back to the start date for a rule without dates", () => {
    const { changes } = setup();
    const event = eventOf({ recurrence: { ...DAILY, count: 0 } });
    expect(changes.isFirstOccurrence(event, "2026-03-02T09:00:00.000Z")).toBe(
      true,
    );
    expect(changes.isFirstOccurrence(event, "2026-03-03T09:00:00.000Z")).toBe(
      false,
    );
  });
});

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}
