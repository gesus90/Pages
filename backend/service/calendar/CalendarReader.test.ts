import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calendarTexts } from "./CalendarProjection";
import { CalendarReader, readCalendarWindow } from "./CalendarReader";

import type {
  CalendarEventRecord,
  CalendarExceptionRecord,
} from "@/backend/database/repositories/calendar/CalendarEventRepository";
import type { CalendarKind, CalendarRecurrence } from "@/definition/Calendar";
import type { VisibleCalendarEvent } from "./CalendarReader";
import type { CalendarDependencies, CalendarViewer } from "./CalendarViewer";

const mocks = vi.hoisted(() => ({ readPeople: vi.fn() }));

vi.mock("./CalendarPeople", () => ({
  CalendarPeople: { read: mocks.readPeople },
}));

const single: CalendarEventRecord = {
  id: "e1",
  title: "Single",
  description: "text",
  allDay: false,
  startAt: "2030-06-10T10:00:00Z",
  endAt: "2030-06-10T11:00:00Z",
  timeZone: "UTC",
  projectId: null,
  createdBy: "owner",
  revision: 4,
  deletedAt: null,
  recurrence: null,
};
const rule: CalendarRecurrence = {
  frequency: "weekly",
  interval: 1,
  weekdays: [],
  until: null,
  count: 3,
};
const weekly: CalendarEventRecord = {
  ...single,
  id: "e2",
  title: "Weekly",
  projectId: "p1",
  recurrence: rule,
};

function viewerOf(id: string, extra: object = {}): CalendarViewer {
  return {
    user: { id },
    timeZone: "UTC",
    language: "de",
    groupIds: ["g1"],
    departmentIds: ["d1"],
    projects: [{ id: "p1", name: "Project" }],
    isAdmin: false,
    ...extra,
  } as unknown as CalendarViewer;
}

function peopleOf(
  options: {
    readonly affected?: readonly string[];
    readonly responses?: readonly { userId: string; response: string }[];
    readonly agents?: readonly string[];
  } = {},
): object {
  return {
    of: () => ({
      invitees: [],
      responses: options.responses ?? [],
      affectedIds: new Set(options.affected ?? []),
      createdBy: { id: "owner", name: "Owner" },
    }),
    isAgent: (id: string) => (options.agents ?? []).includes(id),
  };
}

function setup(events: readonly CalendarEventRecord[] = []): Fixture {
  const dependencies = {
    events: {
      findById: vi.fn(async (id: string) => events.find((e) => e.id === id)),
      findVisible: vi.fn(async () => events),
      findExceptions: vi.fn(async (): Promise<CalendarExceptionRecord[]> => []),
    },
    sources: {
      findProjectNames: vi.fn(async () => [{ id: "p2", name: "Other" }]),
      findProjectDates: vi.fn(async () => [
        {
          id: "pd1",
          projectId: "p1",
          projectName: "Project",
          title: "Date",
          description: "",
          date: "2030-06-11",
          time: null,
        },
      ]),
      findDueTickets: vi.fn(async () => [
        {
          id: "t1",
          key: "K-1",
          title: "Ticket",
          projectId: "p1",
          projectName: "Project",
          date: "2030-06-12",
        },
      ]),
      findMilestones: vi.fn(async () => [
        {
          id: "m1",
          name: "Mile",
          description: "",
          projectId: "p1",
          projectName: "Project",
          date: "2030-06-13",
        },
      ]),
    },
    projects: {
      canWriteProject: vi.fn(
        async (...args: [unknown, string]) => args[1] === "p1",
      ),
      workItemVisibility: vi.fn(async () => ({})),
    },
  };
  return {
    dependencies,
    reader: new CalendarReader(dependencies as unknown as CalendarDependencies),
  };
}

function visibleOf(
  event: CalendarEventRecord,
  affected: string[] = [],
): VisibleCalendarEvent {
  return {
    event,
    people: peopleOf({
      affected,
      responses: [{ userId: "me", response: "accepted" }],
    }) as never,
  };
}

interface Fixture {
  readonly dependencies: Record<
    string,
    Record<string, ReturnType<typeof vi.fn>>
  >;
  readonly reader: CalendarReader;
}

const window = {
  fromMs: Date.parse("2030-06-01T00:00:00Z"),
  toMs: Date.parse("2030-07-01T00:00:00Z"),
  fromDate: "2030-06-01",
  toDate: "2030-06-30",
};

beforeEach(() => {
  mocks.readPeople.mockReset();
  mocks.readPeople.mockResolvedValue(peopleOf());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("readCalendarWindow", () => {
  it("reads dates inclusively", () => {
    expect(readCalendarWindow("2030-06-01", "2030-06-30", "UTC")).toEqual(
      window,
    );
  });

  it("reads instants exclusively", () => {
    expect(
      readCalendarWindow("2030-06-01T00:00:00Z", "2030-06-02T00:00:00Z", "UTC"),
    ).toMatchObject({ fromDate: "2030-06-01", toDate: "2030-06-01" });
  });

  it("refuses reversed, unreadable and too long ranges", () => {
    for (const [from, to] of [
      ["2030-06-02", "2030-06-01"],
      ["2030-06-01T00:00:00Z", "2030-06-01T00:00:00Z"],
      ["2030-06-01", "garbage"],
      ["2030-01-01", "2030-12-31"],
    ])
      expect(() => readCalendarWindow(from, to, "UTC")).toThrow(
        expect.objectContaining({ code: "invalid_request" }),
      );
  });
});

describe("CalendarReader.readEntries", () => {
  it("lists events and derived entries of all calendars", async () => {
    const { reader, dependencies } = setup([single, weekly]);
    dependencies.events.findExceptions.mockResolvedValue([
      {
        eventId: "e2",
        occurrenceStart: "2030-06-17T10:00:00.000Z",
        isCancelled: true,
        title: null,
        description: null,
        allDay: null,
        startAt: null,
        endAt: null,
      },
    ]);
    mocks.readPeople.mockResolvedValue(
      peopleOf({ affected: ["me"], agents: ["me"] }),
    );

    const entries = await reader.readEntries(viewerOf("me"), window);

    expect(entries.map((entry) => entry.source.kind)).toEqual(
      expect.arrayContaining(["event", "project_event", "ticket"]),
    );
    expect(entries.filter((e) => e.title === "Weekly")).toHaveLength(2);
    expect(dependencies.projects.workItemVisibility).toHaveBeenCalled();
  });

  it("names projects the viewer is no member of", async () => {
    const { reader } = setup([{ ...single, id: "e9", projectId: "p2" }]);

    const entries = await reader.readEntries(
      viewerOf("me", { user: { id: "me", isAgent: true } }),
      window,
    );

    expect(entries.find((e) => e.id === "e9")?.calendar.name).toBe("Other");
  });

  it("filters by calendar kind", async () => {
    const { reader, dependencies } = setup([single]);
    const kinds = (...list: CalendarKind[]): ReadonlySet<CalendarKind> =>
      new Set(list);

    const personal = await reader.readEntries(
      viewerOf("owner"),
      window,
      kinds("personal"),
    );
    const due = await reader.readEntries(
      viewerOf("owner"),
      window,
      kinds("due"),
    );

    expect(personal.map((entry) => entry.id)).toEqual(["e1"]);
    expect(due.map((entry) => entry.source.kind)).toEqual(["ticket"]);
    expect(dependencies.sources.findProjectDates).not.toHaveBeenCalled();
    expect(
      (
        await reader.readEntries(viewerOf("owner"), window, kinds("milestone"))
      ).map((entry) => entry.source.kind),
    ).toEqual(["milestone"]);
  });

  it("returns only derived entries without events", async () => {
    const { reader } = setup([]);

    expect(
      await reader.readEntries(viewerOf("owner"), window, new Set(["project"])),
    ).toHaveLength(1);
  });
});

describe("CalendarReader.requireVisible", () => {
  it("returns a visible event, also by occurrence id", async () => {
    const { reader } = setup([single]);

    const visible = await reader.requireVisible(viewerOf("owner"), "e1~K");

    expect(visible.event).toBe(single);
  });

  it("hides missing, deleted and foreign events", async () => {
    const { reader } = setup([
      { ...single, id: "gone", deletedAt: "2030-01-01" },
      single,
    ]);

    for (const id of ["nope", "gone", "e1"])
      await expect(
        reader.requireVisible(viewerOf("stranger"), id),
      ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("CalendarReader.entryOf and viewOf", () => {
  it("builds the entry of a single event", async () => {
    const { reader } = setup([single]);

    const entry = await reader.entryOf(
      viewerOf("me"),
      visibleOf(single, ["me"]),
      null,
    );

    expect(entry).toMatchObject({ id: "e1", myResponse: "accepted" });
  });

  it("builds the entry of a named occurrence or falls back to the first", async () => {
    const { reader } = setup([weekly]);
    const visible = visibleOf(weekly);

    const named = await reader.entryOf(
      viewerOf("owner"),
      visible,
      "2030-06-17T10:00:00.000Z",
    );
    const unknown = await reader.entryOf(
      viewerOf("owner"),
      visible,
      "2030-06-11T10:00:00.000Z",
    );
    const first = await reader.entryOf(viewerOf("owner"), visible, null);

    expect(named.occurrenceStart).toBe("2030-06-17T10:00:00+00:00");
    expect(unknown.occurrenceStart).toBe(first.occurrenceStart);
    expect(first.id).toContain("e2");
  });

  it("falls back to the stored time when the series has no occurrence left", async () => {
    const { reader, dependencies } = setup([weekly]);
    dependencies.events.findExceptions.mockResolvedValue([
      {
        eventId: "e2",
        occurrenceStart: "2030-06-10T10:00:00.000Z",
        isCancelled: true,
        title: null,
        description: null,
        allDay: null,
        startAt: null,
        endAt: null,
      },
    ]);
    const shortSeries = { ...weekly, recurrence: { ...rule, count: 1 } };

    const entry = await reader.entryOf(
      viewerOf("owner"),
      visibleOf(shortSeries),
      null,
    );

    expect(entry.title).toBe("Weekly");
    expect(entry.occurrenceStart).toBeNull();
  });

  it("starts an all-day series on its date", async () => {
    const allDay = {
      ...weekly,
      allDay: true,
      startAt: "2030-06-10",
      endAt: "2030-06-10",
    };
    const { reader } = setup([allDay]);

    const entry = await reader.entryOf(
      viewerOf("owner"),
      visibleOf(allDay),
      null,
    );

    expect(entry).toMatchObject({ allDay: true, start: "2030-06-10" });
  });
});

describe("CalendarReader.viewOf", () => {
  it("builds the detail view with permissions", async () => {
    const { reader, dependencies } = setup([weekly]);
    dependencies.events.findExceptions.mockResolvedValue([
      {
        eventId: "e2",
        occurrenceStart: "2030-06-17",
        isCancelled: false,
        title: null,
        description: null,
        allDay: null,
        startAt: null,
        endAt: null,
      },
    ]);

    const view = await reader.viewOf(viewerOf("me"), visibleOf(weekly, ["me"]));

    expect(view).toMatchObject({
      id: "e2",
      revision: 4,
      permissions: { canEdit: false, canDelete: false, canRespond: true },
      exceptions: [{ occurrenceStart: "2030-06-17", isCancelled: false }],
    });
  });

  it("denies answers to agents and the uninvolved", async () => {
    const { reader } = setup([single]);
    const agentViewer = viewerOf("me", { user: { id: "me", isAgent: true } });
    const agentPeople = {
      event: single,
      people: peopleOf({ affected: ["me"], agents: ["me"] }) as never,
    };

    expect(
      (await reader.viewOf(agentViewer, visibleOf(single, ["me"]))).permissions
        .canRespond,
    ).toBe(false);
    expect(
      (await reader.viewOf(viewerOf("me"), agentPeople)).permissions.canRespond,
    ).toBe(false);
    expect(
      (await reader.viewOf(viewerOf("me"), visibleOf(single))).permissions
        .canRespond,
    ).toBe(false);
  });
});

describe("CalendarReader.countOpenInvitations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-06-15T12:00:00Z"));
  });

  const open = { userId: "me", response: "open" };

  it("counts nothing for an agent", async () => {
    const { reader } = setup([single]);

    expect(
      await reader.countOpenInvitations(
        viewerOf("me", { user: { id: "me", isAgent: true } }),
      ),
    ).toBe(0);
  });

  it("counts open invitations of events that are not over", async () => {
    const future = {
      ...single,
      id: "f",
      startAt: "2030-06-20T10:00:00Z",
      endAt: "2030-06-20T11:00:00Z",
    };
    const past = { ...single, id: "p" };
    const own = { ...single, id: "own", createdBy: "me" };
    const endless = {
      ...weekly,
      recurrence: { ...rule, count: null },
    };
    const ended = {
      ...weekly,
      id: "ended",
      startAt: "2030-05-01T10:00:00Z",
      endAt: "2030-05-01T11:00:00Z",
    };
    const running = {
      ...weekly,
      id: "running",
      startAt: "2030-06-10T10:00:00Z",
      recurrence: { ...rule, count: 5 },
    };
    const { reader } = setup([future, past, own, endless, ended, running]);
    mocks.readPeople.mockResolvedValue(peopleOf({ responses: [open] }));

    expect(await reader.countOpenInvitations(viewerOf("me"))).toBe(3);
  });

  it("skips events without an open own answer", async () => {
    const { reader } = setup([single]);

    mocks.readPeople.mockResolvedValue(peopleOf());
    expect(await reader.countOpenInvitations(viewerOf("me"))).toBe(0);
    mocks.readPeople.mockResolvedValue(
      peopleOf({ responses: [{ userId: "me", response: "accepted" }] }),
    );
    expect(await reader.countOpenInvitations(viewerOf("me"))).toBe(0);
  });
});

describe("CalendarReader targets, options and visibility", () => {
  it("lists the own calendar and writable project calendars", async () => {
    const { reader } = setup();
    const viewer = viewerOf("me", {
      projects: [
        { id: "p1", name: "Project" },
        { id: "p3", name: "Locked" },
      ],
    });

    expect(await reader.targets(viewer)).toEqual([
      { projectId: null, name: calendarTexts("de").mine },
      { projectId: "p1", name: "Project" },
    ]);
    const options = await reader.options(viewer);
    expect(options.timeZone).toBe("UTC");
    expect(options.targets).toHaveLength(2);
  });

  it("decides visibility", () => {
    const { reader } = setup();
    const people = peopleOf({ affected: ["invited"] }) as never;
    const canSee = (viewer: CalendarViewer, event = single): boolean =>
      reader.canSee(viewer, event, people);

    expect(canSee(viewerOf("owner"))).toBe(true);
    expect(canSee(viewerOf("x", { isAdmin: true }))).toBe(true);
    expect(canSee(viewerOf("x"), { ...single, projectId: "p1" })).toBe(true);
    expect(canSee(viewerOf("invited"))).toBe(true);
    expect(canSee(viewerOf("x"))).toBe(false);
    expect(canSee(viewerOf("x"), { ...single, projectId: "zzz" })).toBe(false);
  });

  it("names the projects of events", async () => {
    const { reader, dependencies } = setup();

    const names = await reader.projectNames(viewerOf("me"), [
      { ...single, projectId: "p1" },
      { ...single, projectId: "p2" },
      single,
    ]);

    expect(dependencies.sources.findProjectNames).toHaveBeenCalledWith(["p2"]);
    expect([...names]).toEqual([
      ["p1", "Project"],
      ["p2", "Other"],
    ]);
  });
});
