import { beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarError } from "@/backend/error/CalendarError";

import { CalendarWriter } from "./CalendarWriter";

import type { CalendarEventRecord } from "@/backend/database/repositories/calendar/CalendarEventRepository";
import type {
  CalendarDeletionPreview,
  CalendarEventFields,
  CalendarRecurrence,
} from "@/definition/Calendar";
import type { CalendarReader } from "./CalendarReader";
import type { CalendarDependencies, CalendarViewer } from "./CalendarViewer";

const mocks = vi.hoisted(() => ({
  series: {
    patchedEvent: vi.fn(),
    updateAll: vi.fn(),
    updateThis: vi.fn(),
    updateFollowing: vi.fn(),
    delete: vi.fn(),
    requireOccurrence: vi.fn(),
    isFirstOccurrence: vi.fn(),
  },
  readPeople: vi.fn(),
  logCaughtError: vi.fn(),
}));

vi.mock("./CalendarSeriesChanges", () => ({
  CalendarSeriesChanges: class {
    public patchedEvent = mocks.series.patchedEvent;
    public updateAll = mocks.series.updateAll;
    public updateThis = mocks.series.updateThis;
    public updateFollowing = mocks.series.updateFollowing;
    public delete = mocks.series.delete;
    public requireOccurrence = mocks.series.requireOccurrence;
    public isFirstOccurrence = mocks.series.isFirstOccurrence;
  },
}));
vi.mock("./CalendarPeople", () => ({
  CalendarPeople: { read: mocks.readPeople },
}));
vi.mock("./CalendarEventInput", () => ({
  checkCalendarInvitees: vi.fn(async () => [
    { kind: "person", inviteeId: "ann" },
  ]),
  normalizeRecurrence: vi.fn(() => null),
  readCalendarTime: vi.fn(() => ({
    allDay: false,
    startAt: "2030-01-01T10:00:00Z",
    endAt: "2030-01-01T11:00:00Z",
    startDate: "2030-01-01",
  })),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));

const rule: CalendarRecurrence = {
  frequency: "weekly",
  interval: 1,
  weekdays: [],
  until: null,
  count: 3,
};
const recurring: CalendarEventRecord = {
  id: "e1",
  title: "Weekly",
  description: "",
  allDay: false,
  startAt: "2030-01-01T10:00:00Z",
  endAt: "2030-01-01T11:00:00Z",
  timeZone: "UTC",
  projectId: "p1",
  createdBy: "owner",
  revision: 3,
  deletedAt: null,
  recurrence: rule,
};
const single: CalendarEventRecord = {
  ...recurring,
  id: "e2",
  projectId: null,
  recurrence: null,
};
const occurrence = {
  key: "K",
  allDay: false,
  startMs: Date.parse("2030-01-08T10:00:00Z"),
  endMs: Date.parse("2030-01-08T11:00:00Z"),
  startDate: "2030-01-08",
  endDate: "2030-01-08",
  title: "Weekly",
  description: "",
};

function viewerOf(id: string, extra: object = {}): CalendarViewer {
  return {
    user: { id },
    timeZone: "UTC",
    isAdmin: false,
    ...extra,
  } as unknown as CalendarViewer;
}

function peopleOf(
  affected: readonly string[],
  agents: readonly string[] = [],
): object {
  return {
    of: () => ({
      affectedIds: new Set(affected),
      createdBy: { id: "owner", name: "Owner" },
    }),
    isAgent: (id: string) => agents.includes(id),
  };
}

interface DependenciesDouble {
  readonly publisher: { announce: ReturnType<typeof vi.fn> };
  readonly events: {
    insert: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  readonly participation: {
    replaceInvitations: ReturnType<typeof vi.fn>;
    saveResponse: ReturnType<typeof vi.fn>;
  };
  readonly directory: object;
  readonly invitations: ReturnType<typeof vi.fn>;
}

interface Setup {
  readonly writer: CalendarWriter;
  readonly dependencies: DependenciesDouble;
  readonly reader: {
    requireVisible: ReturnType<typeof vi.fn>;
    targets: ReturnType<typeof vi.fn>;
  };
  readonly listener: { invited: ReturnType<typeof vi.fn> };
}

function dependenciesOf(listener: object | null): DependenciesDouble {
  return {
    publisher: {
      announce: vi.fn(
        async (
          work: () => Promise<unknown>,
          notice: (result: never) => unknown,
        ) => {
          const result = await work();
          notice(result as never);
          return result;
        },
      ),
    },
    events: { insert: vi.fn(), findById: vi.fn(async () => single) },
    participation: { replaceInvitations: vi.fn(), saveResponse: vi.fn() },
    directory: {},
    invitations: vi.fn(() => listener),
  };
}

function setup(withListener = true): Setup {
  const listener = { invited: vi.fn(async () => undefined) };
  const dependencies = dependenciesOf(withListener ? listener : null);
  const reader = {
    requireVisible: vi.fn(),
    targets: vi.fn(async () => [{ projectId: null }, { projectId: "p1" }]),
  };
  const writer = new CalendarWriter(
    dependencies as unknown as CalendarDependencies,
    reader as unknown as CalendarReader,
  );
  return { writer, dependencies, reader, listener };
}

const fields = (calendarProjectId: string | null): CalendarEventFields =>
  ({
    title: "New",
    description: "d",
    calendarProjectId,
    invitees: [],
    recurrence: null,
  }) as unknown as CalendarEventFields;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readPeople.mockResolvedValue(peopleOf(["ann", "bot"], ["bot"]));
  mocks.series.requireOccurrence.mockResolvedValue(occurrence);
  mocks.series.isFirstOccurrence.mockReturnValue(false);
  mocks.series.patchedEvent.mockReturnValue({ id: "next" });
  mocks.series.updateAll.mockResolvedValue({
    eventIds: ["e2"],
    eventId: "e2",
    key: null,
  });
  mocks.series.updateThis.mockResolvedValue({
    eventIds: ["e1"],
    eventId: "e1",
    key: "K",
  });
  mocks.series.updateFollowing.mockResolvedValue({
    eventIds: ["e1", "e3"],
    eventId: "e3",
    key: "K",
  });
});

describe("CalendarWriter.create", () => {
  it("stores the event, announces it and pushes the invitees", async () => {
    const { writer, dependencies, listener } = setup();
    mocks.readPeople.mockResolvedValue(peopleOf(["ann", "bot"], ["bot"]));

    const result = await writer.create(viewerOf("owner"), fields(null));

    expect(result.key).toBeNull();
    expect(dependencies.events.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id: result.eventId, createdBy: "owner" }),
    );
    expect(dependencies.participation.replaceInvitations).toHaveBeenCalled();
    expect(listener.invited).toHaveBeenCalledWith(
      expect.objectContaining({ creatorName: "Owner" }),
      ["ann"],
    );
  });

  it("refuses a project calendar the viewer cannot write", async () => {
    const { writer } = setup();

    await expect(
      writer.create(viewerOf("owner"), fields("other")),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("accepts a writable project calendar", async () => {
    const { writer, dependencies } = setup();

    await writer.create(viewerOf("owner"), fields("p1"));

    expect(dependencies.events.insert).toHaveBeenCalledOnce();
  });
});

function prepareUpdate(event: CalendarEventRecord, withListener = true): Setup {
  const current = setup(withListener);
  current.reader.requireVisible.mockResolvedValue({
    event,
    people: peopleOf(["old"]),
  });
  return current;
}

describe("CalendarWriter.update", () => {
  const prepare = prepareUpdate;

  it("changes a single event as a whole", async () => {
    const { writer, dependencies, listener } = prepare(single);

    const result = await writer.update(
      viewerOf("owner"),
      { id: "e2", scope: "all", expectedRevision: 3 },
      { title: "x" },
    );

    expect(result).toEqual({ eventId: "e2", key: null });
    expect(dependencies.publisher.announce).toHaveBeenCalled();
    expect(listener.invited).toHaveBeenCalledWith(expect.anything(), ["ann"]);
  });

  it("checks the target of a changed project", async () => {
    const { writer } = prepare(single);

    await writer.update(
      viewerOf("owner"),
      { id: "e2", scope: "all" },
      { calendarProjectId: "p1" },
    );
    await expect(
      writer.update(
        viewerOf("owner"),
        { id: "e2", scope: "all" },
        { calendarProjectId: "other" },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("skips the target check for an unchanged project", async () => {
    const { writer, reader } = prepare(single);

    await writer.update(
      viewerOf("owner"),
      { id: "e2", scope: "all" },
      { calendarProjectId: null },
    );

    expect(reader.targets).not.toHaveBeenCalled();
  });
});

describe("CalendarWriter.update of series and pushes", () => {
  const prepare = prepareUpdate;

  it("changes one occurrence", async () => {
    const { writer } = prepare(recurring);

    const result = await writer.update(
      viewerOf("owner"),
      { id: "e1", scope: "this", occurrenceStart: "2030-01-08" },
      { title: "x" },
    );

    expect(result).toEqual({ eventId: "e1", key: "K" });
    expect(mocks.series.updateThis).toHaveBeenCalled();
  });

  it("splits the series for the following occurrences", async () => {
    const { writer } = prepare(recurring);

    const result = await writer.update(
      viewerOf("owner"),
      { id: "e1~2030-01-08T10:00:00Z", scope: "following" },
      { title: "x" },
    );

    expect(result).toEqual({ eventId: "e3", key: "K" });
  });

  it("changes the whole series from its first occurrence", async () => {
    const { writer } = prepare(recurring);
    mocks.series.isFirstOccurrence.mockReturnValue(true);

    const result = await writer.update(
      viewerOf("owner"),
      { id: "e1", scope: "following", occurrenceStart: "2030-01-01" },
      { title: "x" },
    );

    expect(mocks.series.updateAll).toHaveBeenCalled();
    expect(result).toEqual({ eventId: "e2", key: "K" });
  });

  it("works without an invitation listener", async () => {
    const { writer, dependencies } = prepare(single, false);

    await writer.update(
      viewerOf("owner"),
      { id: "e2", scope: "all" },
      { title: "x" },
    );

    expect(dependencies.events.findById).not.toHaveBeenCalled();
  });

  it("skips gone events and events without new invitees", async () => {
    const { writer, dependencies, listener } = prepare(recurring);
    dependencies.events.findById
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ...single, deletedAt: "x" });

    await writer.update(
      viewerOf("owner"),
      { id: "e1", scope: "following", occurrenceStart: "2030-01-08" },
      { title: "x" },
    );
    mocks.readPeople.mockResolvedValue(peopleOf(["old", "bot"], ["bot"]));
    await writer.update(
      viewerOf("owner"),
      { id: "e1", scope: "following", occurrenceStart: "2030-01-08" },
      { title: "x" },
    );

    expect(listener.invited).not.toHaveBeenCalled();
  });
});

describe("CalendarWriter.update pushes and checks", () => {
  const prepare = prepareUpdate;

  it("logs a failed push without undoing the change", async () => {
    const { writer, listener } = prepare(single);
    const failure = new Error("push");
    listener.invited.mockRejectedValue(failure);

    await expect(
      writer.update(
        viewerOf("owner"),
        { id: "e2", scope: "all" },
        { title: "x" },
      ),
    ).resolves.toEqual({ eventId: "e2", key: null });
    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "CalendarWriter",
      failure,
    );
  });

  it("refuses strangers and stale revisions, lets administrators in", async () => {
    const { writer } = prepare(single);

    await expect(
      writer.update(viewerOf("other"), { id: "e2", scope: "all" }, {}),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      writer.update(
        viewerOf("owner"),
        { id: "e2", scope: "all", expectedRevision: 1 },
        {},
      ),
    ).rejects.toMatchObject({ code: "conflict", currentRevision: 3 });
    await expect(
      writer.update(
        viewerOf("admin", { isAdmin: true }),
        { id: "e2", scope: "all" },
        {},
      ),
    ).resolves.toBeDefined();
  });

  it("needs an occurrence for a scope of a series", async () => {
    const { writer } = prepare(recurring);

    await expect(
      writer.update(viewerOf("owner"), { id: "e1", scope: "this" }, {}),
    ).rejects.toBeInstanceOf(CalendarError);
    await expect(
      writer.update(viewerOf("owner"), { id: "e1", scope: "all" }, {}),
    ).resolves.toBeDefined();
  });
});

describe("CalendarWriter.delete and previewDelete", () => {
  function prepare(event: CalendarEventRecord): Setup {
    const current = setup();
    current.reader.requireVisible.mockResolvedValue({
      event,
      people: peopleOf(["ann", "bob"]),
    });
    return current;
  }

  it("deletes through the series changes", async () => {
    const { writer, dependencies } = prepare(recurring);

    const result = await writer.delete(viewerOf("owner"), {
      id: "e1",
      scope: "this",
      occurrenceStart: "2030-01-08",
    });

    expect(result).toEqual({ eventId: "e1" });
    expect(mocks.series.delete).toHaveBeenCalledWith(
      recurring,
      "this",
      occurrence,
    );
    expect(dependencies.publisher.announce).toHaveBeenCalled();
  });

  it("previews a single event", async () => {
    const { writer } = prepare(single);

    expect(
      await writer.previewDelete(viewerOf("owner"), {
        id: "e2",
        scope: "this",
      }),
    ).toEqual({
      confirmationRequired: true,
      event: { id: "e2", title: "Weekly", start: "2030-01-01T10:00:00+00:00" },
      scope: "all",
      affectedOccurrences: 1,
      invitedCount: 2,
    });
  });

  it("previews the scopes of a series", async () => {
    const { writer } = prepare(recurring);
    const preview = (
      scope: "this" | "following" | "all",
      occurrenceStart?: string,
    ): Promise<CalendarDeletionPreview> =>
      writer.previewDelete(viewerOf("owner"), {
        id: "e1",
        scope,
        occurrenceStart,
      });

    expect((await preview("this", "2030-01-08")).affectedOccurrences).toBe(1);
    expect((await preview("following", "2030-01-08")).affectedOccurrences).toBe(
      2,
    );
    expect((await preview("all")).affectedOccurrences).toBe(3);
  });

  it("says unlimited for a series without end", async () => {
    const { writer } = prepare({
      ...recurring,
      recurrence: { ...rule, count: null },
    });

    expect(
      (
        await writer.previewDelete(viewerOf("owner"), {
          id: "e1",
          scope: "all",
        })
      ).affectedOccurrences,
    ).toBe("unbegrenzt");
  });
});

describe("CalendarWriter.respond", () => {
  function prepare(
    affected: readonly string[],
    agents: readonly string[] = [],
  ): Setup {
    const current = setup();
    current.reader.requireVisible.mockResolvedValue({
      event: single,
      people: peopleOf(affected, agents),
    });
    return current;
  }

  it("stores the answer of an invited person", async () => {
    const { writer, dependencies } = prepare(["ann"]);

    expect(await writer.respond(viewerOf("ann"), "e2~K", "accepted")).toEqual({
      eventId: "e2",
      key: "K",
    });
    expect(dependencies.participation.saveResponse).toHaveBeenCalledWith({
      eventId: "e2",
      userId: "ann",
      response: "accepted",
    });
  });

  it("refuses those not invited and agents", async () => {
    await expect(
      prepare(["ann"]).writer.respond(viewerOf("bob"), "e2", "declined"),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      prepare(["bot"], ["bot"]).writer.respond(
        viewerOf("bot"),
        "e2",
        "declined",
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      prepare(["bot"]).writer.respond(
        viewerOf("bot", { user: { id: "bot", isAgent: true } }),
        "e2",
        "declined",
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
