import { expect, it, vi } from "vitest";

import { ChatToolExecutor } from "@/backend/service/chat/ChatToolExecutor";
import { AgentChatSessionOperationService } from "@/backend/service/agents/AgentChatSessionOperationService";
import {
  ownerOperations,
  readingOperations,
  sessionOperations,
} from "@/backend/service/mcp/AgentOperationCatalog";

import {
  deletionFixture,
  FIRST,
  SECOND,
  FOREIGN,
  OWNER,
} from "./page48-chat-fixture";

const IDENTITY = { userId: OWNER.id, isAdmin: false, permissions: [] };

function mcpFixture(): ReturnType<typeof deletionFixture> & {
  readonly mcp: AgentChatSessionOperationService;
} {
  const fixture = deletionFixture();
  const mcp = new AgentChatSessionOperationService({
    sessions: fixture.service,
    users: { getById: async (id) => (id === OWNER.id ? OWNER : null) },
  });
  return { ...fixture, mcp };
}

it("deletes exactly the UI selection without a typed word, leaving unselected and foreign sessions intact", async () => {
  const fixture = deletionFixture();
  expect(await fixture.service.removeSelected(OWNER, [SECOND])).toEqual({
    deleted: [SECOND],
    failed: [],
    cleanupFailed: [],
  });
  expect([...fixture.stored.keys()]).toEqual([FIRST, FOREIGN]);
  expect(fixture.files).toHaveBeenCalledExactlyOnceWith([`file-${SECOND}`]);
});

it("deletes every explicitly selected own session and never lists foreign sessions", async () => {
  const fixture = deletionFixture();
  const own = await fixture.service.list(OWNER);
  expect(own.map(({ id }) => id)).toEqual([FIRST, SECOND]);
  expect(
    (
      await fixture.service.removeSelected(
        OWNER,
        own.map(({ id }) => id),
      )
    ).deleted,
  ).toEqual([FIRST, SECOND]);
  expect(await fixture.service.list(OWNER)).toEqual([]);
  expect(fixture.stored.has(FOREIGN)).toBe(true);
});

it.each(
  [
    [],
    [FIRST, FIRST],
    ["invalid"],
    [FIRST, FOREIGN],
    [FIRST, "foo-bar-baz-quux-plum"],
  ].map((ids) => [ids]),
)(
  "refuses an invalid, empty or unauthorized selection before any mutation: %j",
  async (ids) => {
    const fixture = deletionFixture();
    await expect(fixture.service.removeSelected(OWNER, ids)).rejects.toThrow();
    expect(fixture.remove).not.toHaveBeenCalled();
  },
);

it("refuses inactive accounts before reading or deleting sessions", async () => {
  const fixture = deletionFixture();
  await expect(
    fixture.service.removeSelected({ ...OWNER, isActive: false }, [FIRST]),
  ).rejects.toMatchObject({ code: "accessDenied" });
  expect(fixture.remove).not.toHaveBeenCalled();
});

it("reports per-session partial failures and file cleanup failures after a committed deletion", async () => {
  const fixture = deletionFixture();
  fixture.remove.mockRejectedValueOnce(new Error("database failure"));
  fixture.files.mockRejectedValueOnce(new Error("cleanup failure"));
  expect(await fixture.service.removeSelected(OWNER, [FIRST, SECOND])).toEqual({
    deleted: [SECOND],
    failed: [{ sessionId: FIRST, error: "general" }],
    cleanupFailed: [SECOND],
  });
  expect(fixture.stored.has(FIRST)).toBe(true);
  expect(fixture.stored.has(SECOND)).toBe(false);
});

it.each([undefined, "", "DELETE", true, " LÖSCHEN "])(
  "MCP refuses confirmation %j even though UI deletion needs no word",
  async (confirmation) => {
    const { mcp, remove } = mcpFixture();
    await expect(
      mcp.handle(IDENTITY, "chat.sessions.delete", {
        sessionIds: [FIRST, SECOND],
        expectedCount: 2,
        confirmation,
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(remove).not.toHaveBeenCalled();
  },
);

it("MCP lists the owner's full scope, checks its exact count and requires LÖSCHEN for all selected sessions", async () => {
  const { mcp, remove, stored } = mcpFixture();
  expect(await mcp.handle(IDENTITY, "chat.sessions.list", {})).toMatchObject({
    result: { total: 2, sessions: [{ id: FIRST }, { id: SECOND }] },
  });
  await expect(
    mcp.handle(IDENTITY, "chat.sessions.delete", {
      sessionIds: [FIRST, SECOND],
      expectedCount: 1,
      confirmation: "LÖSCHEN",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(remove).not.toHaveBeenCalled();
  expect(
    await mcp.handle(IDENTITY, "chat.sessions.delete", {
      sessionIds: [FIRST, SECOND],
      expectedCount: 2,
      confirmation: "LÖSCHEN",
    }),
  ).toMatchObject({ result: { deleted: [FIRST, SECOND], failed: [] } });
  expect([...stored.keys()]).toEqual([FOREIGN]);
});

it("MCP rejects foreign sessions, forged button flags and unavailable actors", async () => {
  const { mcp, remove } = mcpFixture();
  await expect(
    mcp.handle({ ...IDENTITY, isAdmin: true }, "chat.sessions.delete", {
      sessionIds: [FIRST, FOREIGN],
      expectedCount: 2,
      confirmation: "LÖSCHEN",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    mcp.handle(IDENTITY, "chat.sessions.delete", {
      sessionIds: [FIRST],
      expectedCount: 1,
      confirmed: true,
      confirmation: "LÖSCHEN",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    mcp.handle({ ...IDENTITY, userId: "unknown" }, "chat.sessions.list", {}),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(remove).not.toHaveBeenCalled();
  expect(await mcp.handle(IDENTITY, "ticket.read", {})).toBeNull();
});

it("offers session reads to read-only credentials and session deletion only to full credentials", () => {
  expect(ownerOperations(false)).toContain("chat.sessions.delete");
  expect(readingOperations(false)).toContain("chat.sessions.list");
  expect(readingOperations(false)).not.toContain("chat.sessions.delete");
  expect(
    sessionOperations(
      {
        runId: "run",
        stepId: "step",
        reach: "read",
        tickets: [],
        operations: [],
      },
      false,
    ),
  ).not.toContain("chat.sessions.delete");
});

it("does not truncate own sessions at the old 200-session limit", async () => {
  const fixture = deletionFixture();
  for (let index = 0; index < 201; index += 1)
    fixture.stored.set(`session-${index}`, OWNER.id);
  expect(await fixture.service.list(OWNER)).toHaveLength(203);
});

it("never exposes button-confirmed session deletion to the model action executor", async () => {
  const router = { handle: vi.fn() };
  const tools = new ChatToolExecutor({
    router,
    identities: { verify: async () => IDENTITY },
  });
  expect(
    await tools.run(
      OWNER.id,
      {
        operation: "chat.sessions.delete",
        parameters: {
          sessionIds: [FIRST],
          confirmed: true,
          confirmation: "LÖSCHEN",
        },
      },
      "LÖSCHEN",
    ),
  ).toEqual({ ok: false, error: "UNKNOWN_OPERATION" });
  expect(router.handle).not.toHaveBeenCalled();
});

it.each([null, [], "invalid", 1])(
  "rejects malformed MCP parameter objects: %j",
  async (input) => {
    const { mcp, remove } = mcpFixture();
    await expect(
      mcp.handle(IDENTITY, "chat.sessions.list", input),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(remove).not.toHaveBeenCalled();
  },
);

it("never offers own-session deletion to a ticket-scoped credential", () => {
  expect(
    sessionOperations(
      {
        runId: "run",
        stepId: "step",
        reach: "tickets",
        tickets: [],
        operations: ["chat.sessions.delete"],
      },
      false,
    ),
  ).not.toContain("chat.sessions.delete");
});
