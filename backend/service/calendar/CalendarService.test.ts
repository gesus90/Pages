import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarService } from "./CalendarService";
import { occurrenceEntryId } from "./CalendarProjection";

import type { User } from "@/definition/User";
import type { CalendarTargetRequest } from "./CalendarWriter";
import type { CalendarDependencies } from "./CalendarViewer";

const mocks = vi.hoisted(() => ({
  readCalendarViewer: vi.fn(),
  readCalendarWindow: vi.fn(),
  reader: {
    readEntries: vi.fn(),
    viewOf: vi.fn(),
    requireVisible: vi.fn(),
    entryOf: vi.fn(),
    targets: vi.fn(),
    options: vi.fn(),
    countOpenInvitations: vi.fn(),
  },
  writer: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    previewDelete: vi.fn(),
    respond: vi.fn(),
  },
}));

vi.mock("./CalendarViewer", () => ({
  readCalendarViewer: mocks.readCalendarViewer,
}));

vi.mock("./CalendarReader", () => ({
  CalendarReader: class {
    public readEntries = mocks.reader.readEntries;
    public viewOf = mocks.reader.viewOf;
    public requireVisible = mocks.reader.requireVisible;
    public entryOf = mocks.reader.entryOf;
    public targets = mocks.reader.targets;
    public options = mocks.reader.options;
    public countOpenInvitations = mocks.reader.countOpenInvitations;
  },
  readCalendarWindow: mocks.readCalendarWindow,
}));

vi.mock("./CalendarWriter", () => ({
  CalendarWriter: class {
    public create = mocks.writer.create;
    public update = mocks.writer.update;
    public delete = mocks.writer.delete;
    public previewDelete = mocks.writer.previewDelete;
    public respond = mocks.writer.respond;
  },
}));

const actor = doubleOf<User>({ id: "u1" });
const target: CalendarTargetRequest = { id: "e1", scope: "all" };
const viewer = { timeZone: "Europe/Berlin", projects: [{ id: "p1" }] };

function setup(): {
  readonly service: CalendarService;
  readonly dependencies: {
    readonly directory: { searchInvitees: ReturnType<typeof vi.fn> };
    readonly participation: Record<string, ReturnType<typeof vi.fn>>;
    readonly publisher: { publish: ReturnType<typeof vi.fn> };
  };
} {
  const dependencies = {
    directory: { searchInvitees: vi.fn() },
    participation: {
      isAffected: vi.fn(async () => true),
      findOperation: vi.fn(async (): Promise<unknown> => null),
      saveOperation: vi.fn(async () => {}),
    },
    publisher: { publish: vi.fn() },
  };
  const service = new CalendarService(
    doubleOf<CalendarDependencies>(dependencies),
  );
  return { service, dependencies };
}

function digestOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const validFields = {
  title: "Meeting",
  start: "2026-03-02T09:00:00Z",
  end: "2026-03-02T10:00:00Z",
  allDay: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readCalendarViewer.mockResolvedValue(viewer);
  mocks.readCalendarWindow.mockReturnValue({ window: true });
});

describe("CalendarService reads", () => {
  it("reads the viewer", async () => {
    const { service } = setup();
    expect(await service.viewer(actor)).toBe(viewer);
  });

  it("reads a range without and with a calendar filter", async () => {
    const { service } = setup();
    mocks.reader.readEntries.mockResolvedValue(["entry"]);
    const range = { from: "2026-03-01", to: "2026-03-08" };
    expect(await service.readRange(actor, range)).toEqual({
      ...range,
      timeZone: "Europe/Berlin",
      entries: ["entry"],
    });
    expect(mocks.reader.readEntries).toHaveBeenLastCalledWith(
      viewer,
      { window: true },
      undefined,
    );
    await service.readRange(actor, range, { kinds: ["project"] });
    expect(mocks.reader.readEntries).toHaveBeenLastCalledWith(
      viewer,
      { window: true },
      new Set(["project"]),
    );
  });

  it("reads one event", async () => {
    const { service } = setup();
    mocks.reader.requireVisible.mockResolvedValue("visible");
    mocks.reader.viewOf.mockResolvedValue("view");
    expect(await service.readEvent(actor, "e1")).toBe("view");
    expect(mocks.reader.viewOf).toHaveBeenCalledWith(viewer, "visible");
  });

  it("reads the entry of an occurrence named by id or by key", async () => {
    const { service } = setup();
    mocks.reader.requireVisible.mockResolvedValue("visible");
    mocks.reader.entryOf.mockResolvedValue("entry");
    await service.readEntry(actor, occurrenceEntryId("e1", "k1"), "other");
    expect(mocks.reader.entryOf).toHaveBeenLastCalledWith(
      viewer,
      "visible",
      "k1",
    );
    await service.readEntry(actor, "e1", "k2");
    expect(mocks.reader.entryOf).toHaveBeenLastCalledWith(
      viewer,
      "visible",
      "k2",
    );
    await service.readEntry(actor, "e1");
    expect(mocks.reader.entryOf).toHaveBeenLastCalledWith(
      viewer,
      "visible",
      null,
    );
  });

  it("reads targets, options and the count of open invitations", async () => {
    const { service } = setup();
    mocks.reader.targets.mockResolvedValue(["t"]);
    mocks.reader.options.mockResolvedValue("o");
    mocks.reader.countOpenInvitations.mockResolvedValue(3);
    expect(await service.targets(actor)).toEqual(["t"]);
    expect(await service.options(actor)).toBe("o");
    expect(await service.countOpenInvitations(actor)).toBe(3);
  });
});

describe("CalendarService changes", () => {
  it("creates an event and answers its entry", async () => {
    const { service } = setup();
    mocks.writer.create.mockResolvedValue({ eventId: "e1", key: null });
    mocks.reader.requireVisible.mockResolvedValue("visible");
    mocks.reader.entryOf.mockResolvedValue("entry");
    expect(await service.create(actor, validFields)).toBe("entry");
    expect(mocks.writer.create).toHaveBeenCalledWith(
      viewer,
      expect.objectContaining({ title: "Meeting", invitees: [] }),
    );
  });

  it("rejects invalid fields and an invalid patch", async () => {
    const { service } = setup();
    await expect(service.create(actor, { title: "" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(
      service.update(actor, target, { title: 1 }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("updates an event and answers the entry of the occurrence", async () => {
    const { service } = setup();
    mocks.writer.update.mockResolvedValue({ eventId: "e1", key: "k1" });
    mocks.reader.requireVisible.mockResolvedValue("visible");
    mocks.reader.entryOf.mockResolvedValue("entry");
    expect(await service.update(actor, target, { title: "New" })).toBe("entry");
    expect(mocks.writer.update).toHaveBeenCalledWith(viewer, target, {
      title: "New",
    });
    expect(mocks.reader.entryOf).toHaveBeenCalledWith(viewer, "visible", "k1");
  });

  it("deletes and previews a deletion", async () => {
    const { service } = setup();
    mocks.writer.delete.mockResolvedValue({ eventId: "e1" });
    mocks.writer.previewDelete.mockResolvedValue("preview");
    expect(await service.delete(actor, target)).toEqual({ eventId: "e1" });
    expect(await service.previewDelete(actor, target)).toBe("preview");
  });

  it("answers an invitation", async () => {
    const { service } = setup();
    mocks.writer.respond.mockResolvedValue({ eventId: "e1", key: null });
    mocks.reader.requireVisible.mockResolvedValue("visible");
    mocks.reader.entryOf.mockResolvedValue("entry");
    expect(await service.respond(actor, "e1", "accepted")).toBe("entry");
    expect(mocks.writer.respond).toHaveBeenCalledWith(viewer, "e1", "accepted");
  });
});

describe("CalendarService invitees and notices", () => {
  it("searches invitees without the account and within the limit", async () => {
    const { service, dependencies } = setup();
    dependencies.directory.searchInvitees.mockResolvedValue([
      { id: "u1" },
      { id: "u2" },
      { id: "u3" },
    ]);
    expect(await service.searchInvitees(actor, "x".repeat(300), 2)).toEqual([
      { id: "u2" },
      { id: "u3" },
    ]);
    expect(dependencies.directory.searchInvitees).toHaveBeenCalledWith(
      "x".repeat(200),
      3,
    );
    await service.searchInvitees(actor, "a", 0);
    expect(dependencies.directory.searchInvitees).toHaveBeenLastCalledWith(
      "a",
      2,
    );
    await service.searchInvitees(actor, "a", 1000);
    expect(dependencies.directory.searchInvitees).toHaveBeenLastCalledWith(
      "a",
      51,
    );
    await service.searchInvitees(actor, "a");
    expect(dependencies.directory.searchInvitees).toHaveBeenLastCalledWith(
      "a",
      21,
    );
  });

  it("tells who is affected by a project or an event", async () => {
    const { service, dependencies } = setup();
    expect(await service.isAffected(actor, "project:p1")).toBe(true);
    expect(await service.isAffected(actor, "project:p2")).toBe(false);
    expect(await service.isAffected(actor, "e1")).toBe(true);
    expect(dependencies.participation.isAffected).toHaveBeenCalledWith(
      "u1",
      "e1",
    );
  });

  it("announces changed project dates", () => {
    const { service, dependencies } = setup();
    service.announceProjectDates("p1");
    expect(dependencies.publisher.publish).toHaveBeenCalledWith({
      type: "calendar.changed",
      id: "project:p1",
    });
  });
});

describe("CalendarService runOnce", () => {
  const request = { b: [{ y: 1, x: 2 }, null], a: "text", c: 5 };
  const sortedRequest = { a: "text", b: [{ x: 2, y: 1 }, null], c: 5 };

  it("runs the work and stores its result", async () => {
    const { service, dependencies } = setup();
    const work = vi.fn(async () => ({ done: true }));
    const outcome = await service.runOnce(
      actor,
      { operationId: "op", request },
      work,
    );
    expect(outcome).toEqual({ kind: "fresh", result: { done: true } });
    expect(dependencies.participation.saveOperation).toHaveBeenCalledWith(
      "u1",
      "op",
      { requestDigest: digestOf(sortedRequest), response: '{"done":true}' },
    );
  });

  it("stores a missing result as null", async () => {
    const { service, dependencies } = setup();
    await service.runOnce(
      actor,
      { operationId: "op", request: "plain" },
      async () => undefined,
    );
    expect(dependencies.participation.saveOperation).toHaveBeenCalledWith(
      "u1",
      "op",
      expect.objectContaining({ response: "null" }),
    );
  });

  it("replays the stored answer of an identical request", async () => {
    const { service, dependencies } = setup();
    dependencies.participation.findOperation.mockResolvedValue({
      requestDigest: digestOf(sortedRequest),
      response: '{"stored":1}',
    });
    const work = vi.fn();
    expect(
      await service.runOnce(actor, { operationId: "op", request }, work),
    ).toEqual({ kind: "replayed", result: { stored: 1 } });
    expect(work).not.toHaveBeenCalled();
  });

  it("rejects the same operation ID for another request", async () => {
    const { service, dependencies } = setup();
    dependencies.participation.findOperation.mockResolvedValue({
      requestDigest: "other",
      response: "{}",
    });
    await expect(
      service.runOnce(actor, { operationId: "op", request }, vi.fn()),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}
