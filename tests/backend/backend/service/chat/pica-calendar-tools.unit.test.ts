import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { CalendarError } from "@/backend/error/CalendarError";
import { ChatToolExecutor } from "@/backend/service/chat/ChatToolExecutor";
import {
  describeChatOperations,
  isChatDeleteOperation,
  isChatOperation,
  isChatWriteOperation,
} from "@/backend/service/chat/ChatToolCatalog";
import { PicaCalendarToolService } from "@/backend/service/chat/PicaCalendarToolService";
import { createPicaTools } from "@/backend/service/chat/PicaTools";
import { PICA_TOOL_OUTCOME } from "@/backend/service/chat/PicaToolSchemas";
import { picaOperatorEntries } from "@/backend/service/chat/admin/PicaOperatorCatalog";

import type { Mock } from "vitest";
import type { CalendarViewEntry } from "@/definition/Calendar";
import type { User } from "@/definition/User";
import type { PicaToolOutcome } from "@/backend/service/chat/PicaToolSchemas";

// Never start the independent MCP catalog in the Pages unit scope.
vi.mock("@/backend/service/chat/PicaPlanTools", () => ({
  registerPicaPlanTools: vi.fn(),
}));

const PERSON: User = {
  id: "person",
  username: "person",
  displayName: "Person",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

const ENTRY: CalendarViewEntry = {
  id: "event~2026-11-16",
  seriesId: "event",
  occurrenceStart: "2026-11-16T09:00:00+01:00",
  title: "Weekly",
  description: "",
  start: "2026-11-16T09:00:00+01:00",
  end: "2026-11-16T09:30:00+01:00",
  allDay: false,
  calendar: { kind: "personal", projectId: null, name: "Meine Termine" },
  invitees: [{ kind: "group", id: "pages", name: "Team Pages" }],
  responses: [{ userId: "other", name: "Other", response: "open" }],
  myResponse: null,
  recurrence: {
    frequency: "weekly",
    interval: 1,
    weekdays: ["mo"],
    until: null,
    count: null,
  },
  source: { kind: "event", ticketKey: null },
  createdBy: { id: "person", name: "Person" },
  editable: true,
  details: { eventId: "event", link: null, createdByMe: true },
};

const VISIBLE_ENTRY = Object.fromEntries(
  Object.entries(ENTRY).filter(([key]) => key !== "details"),
);

interface CalendarMocks {
  readonly readRange: Mock;
  readonly searchInvitees: Mock;
  readonly create: Mock;
  readonly update: Mock;
  readonly respond: Mock;
  readonly previewDelete: Mock;
  readonly delete: Mock;
  readonly runOnce: Mock;
}

let calendar: CalendarMocks;
let users: { getById: Mock };
let router: { handle: Mock };
let service: PicaCalendarToolService;

function callTool(
  tool: string,
  parameters: unknown,
): Promise<PicaToolOutcome | null> {
  const executor = new ChatToolExecutor({
    router,
    identities: {
      verify: async (userId) => ({ userId, isAdmin: false, permissions: [] }),
    },
    calendar: service,
  });
  const registry = createPicaTools({
    tools: executor,
    sessions: { confirmationWord: async () => "LÖSCHEN" },
    authorize: async () => undefined,
  });
  return registry
    .invoke(tool, parameters, {
      userId: "person",
      sessionId: "session",
      runId: "run",
      signal: new AbortController().signal,
      authorize: async () => undefined,
    })
    .then((invocation) =>
      invocation?.isValid ? PICA_TOOL_OUTCOME.parse(invocation.output) : null,
    );
}

function parsedResult(outcome: PicaToolOutcome | null): unknown {
  return JSON.parse(outcome?.result ?? "null");
}

beforeEach(() => {
  calendar = {
    readRange: vi.fn(async () => ({
      from: "2026-11-14",
      to: "2026-11-14",
      timeZone: "Europe/Berlin",
      entries: [ENTRY],
    })),
    searchInvitees: vi.fn(async () => [
      { kind: "group", id: "pages", name: "Team Pages" },
    ]),
    create: vi.fn(async () => ENTRY),
    update: vi.fn(async () => ENTRY),
    respond: vi.fn(async () => ENTRY),
    previewDelete: vi.fn(async () => ({
      confirmationRequired: true,
      event: { id: "event", title: "Weekly", start: ENTRY.start },
      scope: "following",
      affectedOccurrences: "unbegrenzt",
      invitedCount: 3,
    })),
    delete: vi.fn(async () => ({ eventId: "event" })),
    runOnce: vi.fn(
      async (actor: User, operation: unknown, work: () => unknown) => (
        void actor,
        void operation,
        {
          kind: "fresh",
          result: await work(),
        }
      ),
    ),
  };
  users = { getById: vi.fn(async () => PERSON) };
  router = { handle: vi.fn(async () => ({ result: "router" })) };
  service = new PicaCalendarToolService({
    users,
    calendar: async () => calendar,
  });
});

it("adds the calendar operations to the chat catalog but not to the administrator catalog", () => {
  expect(isChatOperation("calendar.read")).toBe(true);
  expect(isChatWriteOperation("calendar.read")).toBe(false);
  expect(isChatWriteOperation("calendar.event.create")).toBe(true);
  expect(isChatDeleteOperation("calendar.event.delete")).toBe(true);
  expect(describeChatOperations()).toContain("`calendar.event.delete`");
  expect(
    picaOperatorEntries(new Set()).some(({ operation }) =>
      operation.startsWith("calendar."),
    ),
  ).toBe(false);
});

it("offers the six tools with only the essential fields required", () => {
  const registry = createPicaTools({
    tools: { run: vi.fn() },
    sessions: { confirmationWord: async () => "LÖSCHEN" },
    authorize: async () => undefined,
  });
  const tools = new Map(
    registry
      .describe()
      .filter(({ id }) => id.startsWith("calendar_"))
      .map((tool) => [tool.id, tool]),
  );
  expect([...tools.keys()].sort()).toEqual([
    "calendar_event_create",
    "calendar_event_delete",
    "calendar_event_respond",
    "calendar_event_update",
    "calendar_invitees_search",
    "calendar_read",
  ]);
  expect(tools.get("calendar_event_create")?.inputSchema.required).toEqual([
    "title",
    "start",
    "end",
    "allDay",
  ]);
  expect(tools.get("calendar_event_delete")?.description).toContain(
    "explicit request in the current message",
  );
});

it("reads the range of the person without the interface details", async () => {
  const outcome = await callTool("calendar_read", {
    from: "2026-11-14",
    to: "2026-11-14",
  });
  expect(outcome?.ok).toBe(true);
  expect(parsedResult(outcome)).toEqual({
    from: "2026-11-14",
    to: "2026-11-14",
    timeZone: "Europe/Berlin",
    entries: [VISIBLE_ENTRY],
  });
  expect(calendar.readRange).toHaveBeenCalledWith(PERSON, {
    from: "2026-11-14",
    to: "2026-11-14",
  });
  expect(router.handle).not.toHaveBeenCalled();
});

it("searches invitees with the default and a given limit", async () => {
  const outcome = await callTool("calendar_invitees_search", {
    query: "Team Pages",
  });
  expect(parsedResult(outcome)).toEqual({
    invitees: [{ kind: "group", id: "pages", name: "Team Pages" }],
  });
  await callTool("calendar_invitees_search", { query: "Ann", limit: 5 });
  expect(calendar.searchInvitees.mock.calls).toEqual([
    [PERSON, "Team Pages", 20],
    [PERSON, "Ann", 5],
  ]);
});

it("creates a weekly series once per server-owned operation ID", async () => {
  const outcome = await callTool("calendar_event_create", {
    title: "Weekly",
    start: "2026-11-16T09:00:00+01:00",
    end: "2026-11-16T09:30:00+01:00",
    allDay: false,
    invitees: [{ kind: "group", id: "pages" }],
    recurrence: { frequency: "weekly", weekdays: ["mo"] },
  });
  expect(outcome?.ok).toBe(true);
  expect(parsedResult(outcome)).toEqual(VISIBLE_ENTRY);
  expect(calendar.create).toHaveBeenCalledWith(PERSON, {
    title: "Weekly",
    start: "2026-11-16T09:00:00+01:00",
    end: "2026-11-16T09:30:00+01:00",
    allDay: false,
    invitees: [{ kind: "group", id: "pages" }],
    recurrence: { frequency: "weekly", weekdays: ["mo"], interval: 1 },
  });
  const call: unknown[] = calendar.runOnce.mock.calls[0] ?? [];
  const operation: unknown = call[1];
  expect(operation).toMatchObject({
    operationId: expect.any(String) as unknown,
    request: { operation: "calendar.event.create" },
  });
});

it("returns a replayed answer of an earlier identical change", async () => {
  calendar.runOnce.mockResolvedValueOnce({ kind: "replayed", result: "old" });
  const outcome = await service.handle("person", "calendar.event.respond", {
    id: "event",
    response: "accepted",
    operationId: "operation",
  });
  expect(outcome).toEqual({ result: "old" });
  expect(calendar.respond).not.toHaveBeenCalled();
});

it("updates a scope of a series with the target apart from the patch", async () => {
  await callTool("calendar_event_update", {
    id: "event~2026-11-16",
    scope: "following",
    start: "2026-11-16T10:00:00+01:00",
    recurrence: { frequency: "weekly", interval: 2, weekdays: ["mo"] },
  });
  await callTool("calendar_event_update", {
    id: "event",
    scope: "this",
    occurrenceStart: "2026-11-23",
    title: "Moved",
  });
  expect(calendar.update.mock.calls).toEqual([
    [
      PERSON,
      {
        id: "event~2026-11-16",
        scope: "following",
        occurrenceStart: undefined,
      },
      {
        start: "2026-11-16T10:00:00+01:00",
        recurrence: { frequency: "weekly", interval: 2, weekdays: ["mo"] },
      },
    ],
    [
      PERSON,
      { id: "event", scope: "this", occurrenceStart: "2026-11-23" },
      { title: "Moved" },
    ],
  ]);
});

it("answers an invitation for the person", async () => {
  const outcome = await callTool("calendar_event_respond", {
    id: "event~2026-11-16",
    response: "declined",
  });
  expect(outcome?.ok).toBe(true);
  expect(calendar.respond).toHaveBeenCalledWith(
    PERSON,
    "event~2026-11-16",
    "declined",
  );
});

it.each([{}, { confirmed: false }])(
  "previews a deletion without changing anything for %j",
  async (confirmation) => {
    const outcome = await callTool("calendar_event_delete", {
      id: "event~2026-11-16",
      scope: "following",
      ...confirmation,
    });
    expect(parsedResult(outcome)).toEqual({
      confirmationRequired: true,
      event: { id: "event", title: "Weekly", start: ENTRY.start },
      scope: "following",
      affectedOccurrences: "unbegrenzt",
      invitedCount: 3,
    });
    expect(calendar.previewDelete).toHaveBeenCalledWith(PERSON, {
      id: "event~2026-11-16",
      scope: "following",
    });
    expect(calendar.delete).not.toHaveBeenCalled();
    expect(calendar.runOnce).not.toHaveBeenCalled();
  },
);

it("deletes only with confirmed: true", async () => {
  const outcome = await callTool("calendar_event_delete", {
    id: "event",
    scope: "all",
    confirmed: true,
  });
  expect(parsedResult(outcome)).toEqual({
    deleted: true,
    eventId: "event",
    scope: "all",
  });
  expect(calendar.delete).toHaveBeenCalledWith(PERSON, {
    id: "event",
    scope: "all",
  });
  expect(calendar.previewDelete).not.toHaveBeenCalled();
});

it.each([
  ["forbidden", "FORBIDDEN"],
  ["not_found", "NOT_FOUND"],
  ["too_large", "PAYLOAD_TOO_LARGE"],
  ["conflict", "CONFLICT"],
] as const)("maps the calendar refusal %s to %s", async (code, error) => {
  calendar.update.mockRejectedValueOnce(new CalendarError(code, "Refused."));
  const outcome = await callTool("calendar_event_update", {
    id: "event",
    scope: "all",
    title: "New",
  });
  expect(outcome).toEqual({ ok: false, error, result: null });
});

it("explains invalid requests and stale revisions to the model", async () => {
  calendar.readRange.mockRejectedValueOnce(
    new CalendarError("invalid_request", "The range is longer than 92 days."),
  );
  expect(
    parsedResult(
      await callTool("calendar_read", { from: "2026-01-01", to: "2026-12-31" }),
    ),
  ).toEqual({
    result: null,
    details: {
      reason: "validation",
      problems: ["The range is longer than 92 days."],
    },
  });
  calendar.delete.mockRejectedValueOnce(
    new CalendarError("conflict", "Changed.", 4),
  );
  await expect(
    service.handle("person", "calendar.event.delete", {
      id: "event",
      scope: "all",
      confirmed: true,
    }),
  ).rejects.toMatchObject({
    code: "CONFLICT",
    details: { currentRevision: 4 },
  });
});

it("passes other errors on unchanged", async () => {
  const failure = new Error("database");
  calendar.create.mockRejectedValueOnce(failure);
  await expect(
    service.handle("person", "calendar.event.create", {
      title: "T",
      start: "2026-11-16",
      end: "2026-11-16",
      allDay: true,
    }),
  ).rejects.toBe(failure);
});

it("refuses malformed input before the calendar is called", async () => {
  await expect(
    service.handle("person", "calendar.event.respond", {
      id: "event",
      response: "maybe",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(calendar.respond).not.toHaveBeenCalled();
});

it.each([
  null,
  { ...PERSON, isActive: false },
  { ...PERSON, mustChangePassword: true },
])("refuses an unavailable account %j", async (account) => {
  users.getById.mockResolvedValueOnce(account);
  await expect(
    service.handle("person", "calendar.read", {
      from: "2026-11-14",
      to: "2026-11-14",
    }),
  ).rejects.toEqual(new AgentOperationError("FORBIDDEN"));
  expect(calendar.readRange).not.toHaveBeenCalled();
});

it("leaves every other operation to the next handler", async () => {
  expect(await service.handle("person", "projects.list", {})).toBeNull();
  const outcome = await callTool("projects_list", {});
  expect(outcome).toEqual({ ok: true, error: null, result: '"router"' });
  expect(users.getById).not.toHaveBeenCalled();
});

describe("read-only agents in the calendar tools", () => {
  it("refuses changes of an agent with read-only access but lets it read", async () => {
    const agentCalendar = {
      readRange: vi.fn(async () => ({
        from: "a",
        to: "b",
        timeZone: "UTC",
        entries: [],
      })),
      searchInvitees: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      respond: vi.fn(),
      previewDelete: vi.fn(),
      delete: vi.fn(),
      runOnce: vi.fn(),
    };
    const agentService = new PicaCalendarToolService({
      users: {
        getById: vi.fn(async () => ({
          id: "agent",
          username: "agent",
          displayName: "Agent",
          role: "employee" as const,
          isActive: true,
          mustChangePassword: false,
          isAgent: true,
        })),
      },
      calendar: async () => agentCalendar,
      agentAccess: async () => ({
        find: async () => ({ access: "read_only" }),
      }),
    });
    await expect(
      agentService.handle("agent", "calendar.event.respond", {
        id: "e",
        response: "accepted",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calendar.runOnce).not.toHaveBeenCalled();
    await expect(
      agentService.handle("agent", "calendar.read", {
        from: "2026-11-09",
        to: "2026-11-10",
      }),
    ).resolves.not.toBeNull();
  });
});
