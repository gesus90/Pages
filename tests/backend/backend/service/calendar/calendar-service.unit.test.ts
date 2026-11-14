import { describe, expect, it } from "vitest";

import { CalendarError } from "@/backend/error/CalendarError";

import { createCalendarWorld } from "./calendar-fakes";

const WEEK = { from: "2026-11-09", to: "2026-11-15" };

const WEEKLY = {
  title: "Weekly",
  start: "2026-11-09T09:00:00+01:00",
  end: "2026-11-09T10:00:00+01:00",
  allDay: false,
  invitees: [
    { kind: "group", id: "team" },
    { kind: "department", id: "design" },
    { kind: "agent", id: "pica" },
  ],
  recurrence: {
    frequency: "weekly",
    interval: 1,
    weekdays: ["mo"],
    until: null,
    count: null,
  },
};

async function expectCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(CalendarError);
  expect(error instanceof CalendarError ? error.code : null).toBe(code);
}

describe("calendar service visibility and invitations", () => {
  it("shows an event to the creator, group, department and agent invitees but not to others", async () => {
    const world = createCalendarWorld();
    const entry = await world.service.create(world.user("ada"), WEEKLY);
    expect(entry.start).toBe("2026-11-09T09:00:00+01:00");
    expect(entry.seriesId).toBe(entry.details.eventId);
    for (const id of ["ada", "bob", "cleo", "pica"]) {
      const range = await world.service.readRange(world.user(id), WEEK);
      expect(range.entries.some((item) => item.title === "Weekly")).toBe(true);
    }
    const dan = await world.service.readRange(world.user("dan"), WEEK);
    expect(dan.entries.some((item) => item.title === "Weekly")).toBe(false);
    expect(world.pushed[0]?.userIds).toEqual(["bob", "cleo"]);
    expect(world.published[0]?.type).toBe("calendar.changed");
  });
});

describe("calendar service visibility and invitations", () => {
  it("counts answers per person, keeps agents open and lets only invitees answer", async () => {
    const world = createCalendarWorld();
    const created = await world.service.create(world.user("ada"), WEEKLY);
    expect(await world.service.countOpenInvitations(world.user("bob"))).toBe(1);
    const answered = await world.service.respond(
      world.user("bob"),
      created.id,
      "accepted",
    );
    expect(answered.myResponse).toBe("accepted");
    expect(await world.service.countOpenInvitations(world.user("bob"))).toBe(0);
    const creatorView = await world.service.readEntry(
      world.user("ada"),
      created.id,
    );
    expect(creatorView.myResponse).toBeNull();
    expect(creatorView.responses).toEqual([
      { userId: "bob", name: "Bob", response: "accepted" },
      { userId: "cleo", name: "Cleo", response: "open" },
      { userId: "pica", name: "Pica", response: "open" },
    ]);
    await expectCode(
      world.service.respond(world.user("ada"), created.id, "accepted"),
      "forbidden",
    );
    await expectCode(
      world.service.respond(world.user("pica"), created.id, "declined"),
      "forbidden",
    );
    await expectCode(
      world.service.respond(world.user("dan"), created.id, "declined"),
      "not_found",
    );
  });
});

describe("calendar service visibility and invitations", () => {
  it("lets only the creator or an administrator change and delete; deleted events vanish for all", async () => {
    const world = createCalendarWorld();
    const created = await world.service.create(world.user("ada"), {
      ...WEEKLY,
      recurrence: null,
    });
    const id = created.id;
    await expectCode(
      world.service.update(
        world.user("bob"),
        { id, scope: "all" },
        { title: "X" },
      ),
      "forbidden",
    );
    await expectCode(
      world.service.delete(world.user("bob"), { id, scope: "all" }),
      "forbidden",
    );
    const changed = await world.service.update(
      world.user("admin"),
      { id, scope: "all" },
      { title: "Admin" },
    );
    expect(changed.title).toBe("Admin");
    await expectCode(
      world.service.update(
        world.user("ada"),
        { id, scope: "all", expectedRevision: 1 },
        { title: "Old" },
      ),
      "conflict",
    );
    await world.service.delete(world.user("ada"), { id, scope: "all" });
    const bob = await world.service.readRange(world.user("bob"), WEEK);
    expect(bob.entries.some((item) => item.details.eventId === id)).toBe(false);
  });
});

describe("calendar service visibility and invitations", () => {
  it("reopens acceptances but keeps declines when the time changes", async () => {
    const world = createCalendarWorld();
    const created = await world.service.create(world.user("ada"), {
      ...WEEKLY,
      recurrence: null,
    });
    await world.service.respond(world.user("bob"), created.id, "accepted");
    await world.service.respond(world.user("cleo"), created.id, "declined");
    await world.service.update(
      world.user("ada"),
      { id: created.id, scope: "all" },
      {
        start: "2026-11-09T11:00:00+01:00",
        end: "2026-11-09T12:00:00+01:00",
      },
    );
    const view = await world.service.readEntry(world.user("ada"), created.id);
    expect(view.responses.map((item) => item.response)).toEqual([
      "open",
      "declined",
      "open",
    ]);
  });
});

describe("calendar service visibility and invitations", () => {
  it("refuses an end before the start, a range over 92 days and a foreign project", async () => {
    const world = createCalendarWorld();
    await expectCode(
      world.service.create(world.user("ada"), {
        ...WEEKLY,
        end: "2026-11-09T08:00:00+01:00",
      }),
      "invalid_request",
    );
    await expectCode(
      world.service.readRange(world.user("ada"), {
        from: "2026-01-01",
        to: "2026-06-01",
      }),
      "invalid_request",
    );
    await expectCode(
      world.service.create(world.user("bob"), {
        ...WEEKLY,
        calendarProjectId: "p1",
      }),
      "forbidden",
    );
  });
});

async function eventEntries(
  world: ReturnType<typeof createCalendarWorld>,
  range: { from: string; to: string },
): Promise<Awaited<ReturnType<typeof world.service.readRange>>["entries"]> {
  return (
    await world.service.readRange(world.user("ada"), range)
  ).entries.filter((item) => item.details.eventId !== null);
}

describe("calendar service series scopes", () => {
  it("changes only this, this and following, or all occurrences", async () => {
    const world = createCalendarWorld();
    const created = await world.service.create(world.user("ada"), {
      ...WEEKLY,
      invitees: [],
    });
    const month = { from: "2026-11-09", to: "2026-11-30" };
    const second = (await eventEntries(world, month))[1];
    expect(second?.start).toBe("2026-11-16T09:00:00+01:00");
    await world.service.update(
      world.user("ada"),
      { id: second?.id ?? "", scope: "this" },
      { title: "Only" },
    );
    let titles = (await eventEntries(world, month)).map((item) => item.title);
    expect(titles).toEqual(["Weekly", "Only", "Weekly", "Weekly"]);
    await world.service.update(
      world.user("ada"),
      { id: created.id, scope: "all" },
      { description: "Notes" },
    );
    titles = (await eventEntries(world, month)).map((item) => item.title);
    expect(titles).toEqual(["Weekly", "Only", "Weekly", "Weekly"]);
    const third = (await eventEntries(world, month))[2];
    await world.service.update(
      world.user("ada"),
      { id: third?.id ?? "", scope: "following" },
      {
        title: "Later",
        start: "2026-11-23T10:00:00+01:00",
        end: "2026-11-23T11:00:00+01:00",
      },
    );
    const entries = await eventEntries(world, month);
    expect(entries.map((item) => `${item.title} ${item.start}`)).toEqual([
      "Weekly 2026-11-09T09:00:00+01:00",
      "Only 2026-11-16T09:00:00+01:00",
      "Later 2026-11-23T10:00:00+01:00",
      "Later 2026-11-30T10:00:00+01:00",
    ]);
  });
});

describe("calendar service series scopes", () => {
  it("deletes this, following or all occurrences and previews the deletion", async () => {
    const world = createCalendarWorld();
    const created = await world.service.create(world.user("ada"), {
      ...WEEKLY,
      recurrence: { ...WEEKLY.recurrence, count: 4 },
    });
    const month = { from: "2026-11-09", to: "2026-11-30" };
    const all = await eventEntries(world, month);
    const preview = await world.service.previewDelete(world.user("ada"), {
      id: all[2]?.id ?? "",
      scope: "following",
    });
    expect(preview).toMatchObject({
      confirmationRequired: true,
      affectedOccurrences: 2,
      invitedCount: 3,
    });
    await world.service.delete(world.user("ada"), {
      id: all[1]?.id ?? "",
      scope: "this",
    });
    expect(await eventEntries(world, month)).toHaveLength(3);
    await world.service.delete(world.user("ada"), {
      id: all[2]?.id ?? "",
      scope: "following",
    });
    expect(await eventEntries(world, month)).toHaveLength(1);
    await world.service.delete(world.user("ada"), {
      id: created.id,
      scope: "all",
    });
    expect(await eventEntries(world, month)).toHaveLength(0);
  });
});

describe("calendar service series scopes", () => {
  it("shows multi-day all-day events, project dates, due tickets and milestones with links", async () => {
    const world = createCalendarWorld();
    await world.service.create(world.user("ada"), {
      title: "Offsite",
      start: "2026-11-11",
      end: "2026-11-13",
      allDay: true,
    });
    const entries = (await world.service.readRange(world.user("ada"), WEEK))
      .entries;
    expect(
      entries.map((item) => [
        item.title,
        item.start,
        item.end,
        item.details.link,
      ]),
    ).toEqual([
      ["PAGE-297 fällig", "2026-11-10", "2026-11-10", "/aufgaben/PAGE-297"],
      ["Offsite", "2026-11-11", "2026-11-13", null],
      [
        "Release",
        "2026-11-12T14:00:00+01:00",
        "2026-11-12T15:00:00+01:00",
        "/projekte/p1",
      ],
      ["Meilenstein Version 1.0", "2026-11-13", "2026-11-13", "/projekte/p1"],
    ]);
    expect(
      entries
        .filter((item) => item.details.link !== null)
        .every((item) => !item.editable),
    ).toBe(true);
  });
});

describe("calendar service series scopes", () => {
  it("answers in the zone of the viewer", async () => {
    const world = createCalendarWorld("America/New_York");
    const entry = await world.service.create(world.user("ada"), {
      ...WEEKLY,
      recurrence: null,
      start: "2026-11-09T15:00:00Z",
      end: "2026-11-09T16:00:00Z",
    });
    expect(entry.start).toBe("2026-11-09T10:00:00-05:00");
  });
});

describe("calendar service series scopes", () => {
  it("replays an operation and refuses a reused ID with another request", async () => {
    const world = createCalendarWorld();
    const work = async (): Promise<string> => "done";
    const first = await world.service.runOnce(
      world.user("ada"),
      { operationId: "op", request: { a: 1 } },
      work,
    );
    const second = await world.service.runOnce(
      world.user("ada"),
      { operationId: "op", request: { a: 1 } },
      work,
    );
    expect(first.kind).toBe("fresh");
    expect(second).toEqual({ kind: "replayed", result: "done" });
    await expectCode(
      world.service.runOnce(
        world.user("ada"),
        { operationId: "op", request: { a: 2 } },
        work,
      ),
      "conflict",
    );
  });
});
