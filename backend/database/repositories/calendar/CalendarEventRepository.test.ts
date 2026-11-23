import { expect, it, vi } from "vitest";

import { CalendarEventRepository } from "./CalendarEventRepository";

import type {
  CalendarDatabase,
  NewCalendarEvent,
} from "./CalendarEventRepository";

function doubleOf(rows: unknown[][] = []): {
  repository: CalendarEventRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new CalendarEventRepository({
      query,
      execute,
    } as unknown as CalendarDatabase),
    query,
    execute,
  };
}

const BASE = [
  "e1",
  "Title",
  "Text",
  0,
  "2026-01-01T10:00:00Z",
  "2026-01-01T11:00:00Z",
  "UTC",
  null,
  "u1",
  3,
  null,
];
const PLAIN_ROW = [...BASE, null, null, null, null, null];
const SERIES_ROW = [...BASE, "weekly", 2, '["mo","xx",1]', "2026-12-31", null];
const COUNTED_ROW = [...BASE, "daily", 1n, "{}", null, 4];

const NEW_EVENT: NewCalendarEvent = {
  id: "e1",
  title: "Title",
  description: "Text",
  allDay: false,
  startAt: "2026-01-01T10:00:00Z",
  endAt: "2026-01-01T11:00:00Z",
  timeZone: "UTC",
  projectId: "p1",
  createdBy: "u1",
  recurrence: null,
};

it("finds an event without a rule or returns null", async () => {
  const found = doubleOf([PLAIN_ROW]);
  const missing = doubleOf();

  await expect(found.repository.findById("e1")).resolves.toEqual({
    id: "e1",
    title: "Title",
    description: "Text",
    allDay: false,
    startAt: "2026-01-01T10:00:00Z",
    endAt: "2026-01-01T11:00:00Z",
    timeZone: "UTC",
    projectId: null,
    createdBy: "u1",
    revision: 3,
    deletedAt: null,
    recurrence: null,
  });
  await expect(missing.repository.findById("x")).resolves.toBeNull();
});

it("reads the rule of a series and keeps only valid weekdays", async () => {
  const { repository } = doubleOf([SERIES_ROW, COUNTED_ROW]);

  const events = await repository.findVisible(
    { userId: "u1", groupIds: [], departmentIds: [], projectIds: [] },
    { fromDate: "2026-01-01", toDate: "2026-01-31" },
  );

  expect(events.map((event) => event.recurrence)).toEqual([
    {
      frequency: "weekly",
      interval: 2,
      weekdays: ["mo"],
      until: "2026-12-31",
      count: null,
    },
    { frequency: "daily", interval: 1, weekdays: [], until: null, count: 4 },
  ]);
});

it("rejects an unknown frequency", async () => {
  const { repository } = doubleOf([[...BASE, "hourly", 1, "[]", null, null]]);

  await expect(repository.findById("e1")).rejects.toThrow("frequency");
});

it("passes the viewer scope and the padded range to the query", async () => {
  const { repository, query } = doubleOf();

  await repository.findVisible(
    { userId: "u1", groupIds: ["g1"], departmentIds: ["d1"], projectIds: [] },
    { fromDate: "2026-01-01", toDate: "2026-01-31" },
  );

  const parameters = query.mock.calls[0]?.[1] as Record<string, unknown>;
  expect(parameters).toMatchObject({
    user_id: "u1",
    from_bound: "2026-01-01",
    to_bound: "2026-01-31T99",
  });
  expect(Object.values(parameters)).toEqual(
    expect.arrayContaining(["g1", "d1"]),
  );
});

it("maps exceptions", async () => {
  const { repository } = doubleOf([
    ["e1", "2026-01-08", 1, null, null, null, null, null],
    ["e1", "2026-01-15", 0, "T", "D", 1, "s", "e"],
  ]);

  await expect(repository.findExceptions(["e1"])).resolves.toEqual([
    {
      eventId: "e1",
      occurrenceStart: "2026-01-08",
      isCancelled: true,
      title: null,
      description: null,
      allDay: null,
      startAt: null,
      endAt: null,
    },
    {
      eventId: "e1",
      occurrenceStart: "2026-01-15",
      isCancelled: false,
      title: "T",
      description: "D",
      allDay: true,
      startAt: "s",
      endAt: "e",
    },
  ]);
});

it("inserts an event and clears its absent rule", async () => {
  const { repository, execute } = doubleOf();

  await repository.insert(NEW_EVENT);

  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    id: "e1",
    is_all_day: false,
    created_by: "u1",
    project_id: "p1",
  });
  expect(execute.mock.calls[1]?.[1]).toEqual({ event_id: "e1" });
});

it("updates an event and stores a new rule", async () => {
  const { repository, execute } = doubleOf();

  await repository.update({
    ...NEW_EVENT,
    recurrence: {
      frequency: "weekly",
      interval: 1,
      weekdays: ["mo", "we"],
      until: null,
      count: 5,
    },
  });

  expect(execute).toHaveBeenCalledTimes(3);
  expect(execute.mock.calls[2]?.[1]).toEqual({
    event_id: "e1",
    frequency: "weekly",
    interval: 1,
    weekdays: '["mo","we"]',
    until_date: null,
    occurrence_count: 5,
  });
});

it("touches and deletes an event by identifier", async () => {
  const { repository, execute } = doubleOf();

  await repository.touch("e1");
  await repository.markDeleted("e2");

  expect(execute.mock.calls.map((call) => call[1])).toEqual([
    { id: "e1" },
    { id: "e2" },
  ]);
});

it("saves an exception", async () => {
  const { repository, execute } = doubleOf();

  await repository.saveException({
    eventId: "e1",
    occurrenceStart: "2026-01-08",
    isCancelled: true,
    title: null,
    description: null,
    allDay: null,
    startAt: null,
    endAt: null,
  });

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    event_id: "e1",
    is_cancelled: true,
  });
});

it("deletes exceptions with and without options", async () => {
  const { repository, execute } = doubleOf();

  await repository.deleteExceptions("e1");
  await repository.deleteExceptions("e1", {
    fromOccurrence: "2026-02-01",
    onlyChanged: true,
  });

  expect(execute.mock.calls.map((call) => call[1])).toEqual([
    { event_id: "e1", from_occurrence: null, only_changed: false },
    { event_id: "e1", from_occurrence: "2026-02-01", only_changed: true },
  ]);
});
