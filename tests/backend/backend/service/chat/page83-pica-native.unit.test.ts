import { expect, it, vi } from "vitest";

import { ChatError } from "@/backend/error/ChatErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import { responseChunks } from "../../agents/runtime/runtime-fixture";
import { picaToolCalls, picaWorld } from "./page83-pica-fixture";
import { SECOND, SESSION } from "./page48-chat-fixture";
import {
  nativeSession,
  owner,
  resourceWorld,
} from "../agents/page81-resource-fixture";

const TITLE = { ticketId: "PAGE-1", expectedTitle: "Alt", title: "Neu" };
const STATUS = {
  ticketId: "PAGE-1",
  expectedStatusId: "todo",
  statusId: "done",
};

it("advertises the fixed strict native schemas and routes reads through existing Pages services", async () => {
  const calls = [
    {
      tool: "tickets_search",
      input: { projectId: "project", text: "PAGE-1", limit: 5 },
    },
    { tool: "tickets_read", input: { ticketId: "PAGE-1" } },
    { tool: "projects_read", input: { projectId: "project" } },
  ];
  const world = picaWorld((_, step) =>
    step < calls.length
      ? picaToolCalls([calls[step]])
      : responseChunks("Gelesen"),
  );
  expect(await world.service.run(world.input, world.controller.signal)).toBe(
    "Gelesen",
  );
  const schemas = world.provider.calls.mock.calls[0]?.[0].tools;
  expect(
    schemas?.map((tool) => (tool.type === "function" ? tool.name : "")),
  ).toEqual([
    "projects_list",
    "projects_read",
    "departments_list",
    "tickets_search",
    "tickets_read",
    "assignment_targets_search",
    "tags_list",
    "milestones_read",
    "wiki_search",
    "wiki_tree_read",
    "wiki_page_read",
    "wiki_comments_read",
    "tickets_create",
    "tickets_set_title",
    "tickets_set_status",
    "tickets_set_description",
    "tickets_set_assignee",
    "tickets_set_tags",
    "tickets_set_parent",
    "tickets_set_milestone",
    "tickets_delete",
    "projects_create",
    "projects_set_name",
    "projects_set_description",
    "projects_set_status",
    "projects_set_dates",
    "milestones_create",
    "milestones_set_name",
    "milestones_set_description",
    "milestones_set_status",
    "milestones_set_start_at",
    "milestones_set_due_at",
    "milestones_delete",
    "wiki_page_create",
    "wiki_page_set_title",
    "wiki_page_set_content",
    "wiki_page_move",
    "wiki_page_delete",
    "wiki_comment_add",
    "wiki_comment_edit",
    "wiki_comment_resolve",
    "wiki_comment_delete",
  ]);
  for (const schema of schemas ?? [])
    if (schema.type === "function")
      expect(schema.inputSchema.additionalProperties).toBe(false);
  expect(
    world.router.mock.calls.map(([identity, request]) => [
      identity.userId,
      request.operation,
    ]),
  ).toEqual([
    [world.input.userId, "tickets.search"],
    [world.input.userId, "ticket.read"],
    [world.input.userId, "projects.read"],
  ]);
  expect(world.verify).toHaveBeenCalledTimes(3);
  expect(world.authorize.mock.calls.length).toBeGreaterThan(3);
});

it.each([
  ["tickets_set_title", "ticket.setTitle", TITLE],
  ["tickets_set_status", "ticket.setStatus", STATUS],
] as const)(
  "executes %s on request without a confirmation line, with server operation IDs",
  async (tool, operation, parameters) => {
    const world = picaWorld((_, step) =>
      step === 0
        ? picaToolCalls([{ tool, input: parameters }])
        : responseChunks("Erledigt"),
    );
    await world.service.run(world.input, world.controller.signal);
    expect(world.router).toHaveBeenCalledOnce();
    expect(world.router.mock.calls[0]?.[1].operation).toBe(operation);
    expect(world.router.mock.calls[0]?.[1].parameters).toMatchObject(
      parameters,
    );
    expect(world.router.mock.calls[0]?.[1].parameters).toHaveProperty(
      "operationId",
    );
    expect(world.router.mock.calls[0]?.[1].parameters).not.toHaveProperty(
      "confirmation",
    );
    expect(world.sessions.confirmationWord).not.toHaveBeenCalled();
  },
);

it.each([
  ["tickets_read", { ticketId: "PAGE-1", userId: "foreign", runId: "forged" }],
  ["tickets_read", { ticketId: 3 }],
  ["tickets_search", { projectId: "project", limit: 21 }],
  ["tickets_set_title", { ...TITLE, confirmation: true }],
  ["tickets_set_title", { ...TITLE, operationId: "replayed" }],
  ["pages_operation", { operation: "ticket.setTitle", parameters: TITLE }],
  ["agents_delete", { agentId: "agent" }],
] as const)(
  "rejects unknown tools and untrusted arguments before dispatch: %s",
  async (tool, input) => {
    const world = picaWorld((_, step) =>
      step === 0
        ? picaToolCalls([{ tool, input }])
        : responseChunks("Abgewiesen"),
    );
    await world.service.run(world.input, world.controller.signal);
    expect(world.router).not.toHaveBeenCalled();
  },
);

it("keeps a failed write refused only within its own turn", async () => {
  const world = picaWorld((_, step) =>
    step % 2 === 0
      ? picaToolCalls([{ tool: "tickets_set_title", input: TITLE }])
      : responseChunks("Antwort"),
  );
  world.router.mockRejectedValue(new AgentOperationError("CONFLICT"));
  await world.service.run(world.input, world.controller.signal);
  await world.service.run(
    { ...world.input, prompt: "Versuch es noch einmal" },
    world.controller.signal,
  );
  expect(world.router).toHaveBeenCalledTimes(2);
});

it("rechecks current identity on each tool and prevents writes after account revocation", async () => {
  const requested = [
    { tool: "tickets_read", input: { ticketId: "PAGE-1" } },
    { tool: "tickets_set_title", input: TITLE },
  ];
  const world = picaWorld((_, step) =>
    step < 2 ? picaToolCalls([requested[step]]) : responseChunks("Antwort"),
  );
  world.verify
    .mockResolvedValueOnce({
      userId: world.input.userId,
      isAdmin: false,
      permissions: [],
    })
    .mockRejectedValue(new McpAuthorizationError("invalid_token", 401));
  await world.service.run(world.input, world.controller.signal);
  expect(world.verify).toHaveBeenCalledTimes(2);
  expect(world.router).toHaveBeenCalledOnce();
  expect(world.router.mock.calls[0]?.[1].operation).toBe("ticket.read");
});

it("fails closed when connection access is revoked between two native calls", async () => {
  const world = picaWorld((_, step) =>
    step < 2
      ? picaToolCalls([{ tool: "tickets_read", input: { ticketId: "PAGE-1" } }])
      : responseChunks("Antwort"),
  );
  world.router.mockImplementation(async () => {
    world.authorize.mockRejectedValue(new TextAssistantError("accessDenied"));
    return { apiVersion: "1", result: { id: "project", name: "Project" } };
  });
  await expect(
    world.service.run(world.input, world.controller.signal),
  ).rejects.toMatchObject({ code: "accessDenied" });
  expect(world.router).toHaveBeenCalledOnce();
});

it("preserves conflicts and refuses to send a failed write again unchanged", async () => {
  const world = picaWorld((_, step) =>
    step < 2
      ? picaToolCalls([{ tool: "tickets_set_title", input: TITLE }])
      : responseChunks("Konflikt"),
  );
  world.router.mockRejectedValue(new AgentOperationError("CONFLICT"));
  await world.service.run(world.input, world.controller.signal);
  expect(world.router).toHaveBeenCalledOnce();
  expect(
    JSON.stringify(world.provider.calls.mock.calls[1]?.[0].prompt),
  ).toContain("CONFLICT");
  expect(
    JSON.stringify(world.provider.calls.mock.calls[2]?.[0].prompt),
  ).toContain("RETRY_REFUSED");
});

it("bounds service results before they enter the model context", async () => {
  const world = picaWorld((_, step) =>
    step === 0
      ? picaToolCalls([
          { tool: "projects_read", input: { projectId: "project" } },
        ])
      : responseChunks("Zu groß"),
  );
  world.router.mockResolvedValue({
    apiVersion: "1",
    result: { id: "project", name: "x".repeat(20_001) },
  });
  await world.service.run(world.input, world.controller.signal);
  const prompt = JSON.stringify(world.provider.calls.mock.calls[1]?.[0].prompt);
  expect(prompt).toContain("RESULT_TOO_LARGE");
  expect(prompt).not.toContain("x".repeat(20_001));
});

it("limits a native turn to 256 service calls even when a model requests more in one step", async () => {
  const world = picaWorld((_, step) =>
    step === 0
      ? picaToolCalls(
          Array.from({ length: 257 }, () => ({
            tool: "tickets_read",
            input: { ticketId: "PAGE-1" },
          })),
        )
      : responseChunks("Limit"),
  );
  await expect(
    world.service.run(world.input, world.controller.signal),
  ).rejects.toMatchObject({ code: "stepLimit" });
  expect(world.router).toHaveBeenCalledTimes(256);
  expect(
    JSON.stringify(world.provider.calls.mock.calls[1]?.[0].prompt),
  ).toContain("STEP_LIMIT");
});

it("stops a model that keeps calling tools at the shared runtime step limit", async () => {
  const world = picaWorld(() =>
    picaToolCalls([{ tool: "tickets_read", input: { ticketId: "PAGE-1" } }]),
  );
  await expect(
    world.service.run(world.input, world.controller.signal),
  ).rejects.toMatchObject({ code: "stepLimit" });
  expect(world.router).toHaveBeenCalledTimes(256);
  expect(world.provider.calls).toHaveBeenCalledTimes(258);
});

it("never starts a CLI model and rejects a foreign actor before model execution", async () => {
  const world = picaWorld();
  await expect(
    world.service.run(
      {
        ...world.input,
        agent: {
          ...world.input.agent,
          connection: {
            ...world.input.agent.connection,
            provider: "codex_cli",
          },
        },
      },
      world.controller.signal,
    ),
  ).rejects.toEqual(new ChatError("apiModeRequired"));
  await expect(
    world.service.run(
      { ...world.input, userId: "foreign" },
      world.controller.signal,
    ),
  ).rejects.toMatchObject({ code: "accessDenied" });
  expect(world.provider.calls).not.toHaveBeenCalled();
  expect(world.router).not.toHaveBeenCalled();
});

it("honors abort before a tool can dispatch and does not retry provider failures", async () => {
  const world = picaWorld(() => {
    world.controller.abort();
    return picaToolCalls([
      { tool: "tickets_read", input: { ticketId: "PAGE-1" } },
    ]);
  });
  await expect(
    world.service.run(world.input, world.controller.signal),
  ).rejects.toBeDefined();
  expect(world.router).not.toHaveBeenCalled();
  const failed = picaWorld(() => {
    throw new Error("synthetic-secret");
  });
  await expect(
    failed.service.run(failed.input, failed.controller.signal),
  ).rejects.toMatchObject({ code: "providerFailed" });
  expect(failed.provider.calls).toHaveBeenCalledOnce();
});

it("isolates service identities between simultaneous users and chats", async () => {
  // Every run writes once and answers after its own tool result, however the runs interleave.
  const world = picaWorld((request) =>
    request.prompt.some(({ role }) => role === "tool")
      ? responseChunks("Antwort")
      : picaToolCalls([{ tool: "tickets_set_title", input: TITLE }]),
  );
  const other = { ...world.input.actor, id: "second-user" };
  world.sessions.require.mockImplementation(async (actor, id) => {
    if (
      (actor.id === world.input.userId && id === world.input.sessionId) ||
      (actor.id === other.id && id === SECOND)
    )
      return { ...SESSION, id };
    throw new ChatError("sessionMissing");
  });
  await Promise.all([
    world.service.run(world.input, world.controller.signal),
    world.service.run(
      { ...world.input, actor: other, userId: other.id, sessionId: SECOND },
      world.controller.signal,
    ),
  ]);
  expect(
    world.router.mock.calls.map(([identity]) => identity.userId).sort(),
  ).toEqual([world.input.userId, other.id].sort());
  await expect(
    world.service.run(
      { ...world.input, sessionId: SECOND },
      world.controller.signal,
    ),
  ).rejects.toMatchObject({ code: "sessionMissing" });
});

it("does not log model errors, prompts or provider credentials", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const world = picaWorld(() => {
    throw new Error("synthetic-secret-in-error");
  });
  await expect(
    world.service.run(world.input, world.controller.signal),
  ).rejects.toMatchObject({ code: "providerFailed" });
  const output = JSON.stringify([logged.mock.calls, warned.mock.calls]);
  expect(output).not.toContain("synthetic-secret-in-error");
  expect(output).not.toContain("Synthetic prompt");
});

it("executes native Pica tools while the sole ACP slot is occupied without acquiring another lease", async () => {
  const resources = resourceWorld();
  await resources.scheduler.recover();
  const controller = new AbortController();
  const occupied = await resources.scheduler.open(
    owner("occupied"),
    controller.signal,
    async () => nativeSession(),
  );
  await occupied.turn;
  try {
    const saved = resources.store.save.mock.calls.length;
    const world = picaWorld((_, step) =>
      step === 0
        ? picaToolCalls([
            { tool: "tickets_read", input: { ticketId: "PAGE-1" } },
          ])
        : responseChunks("Gelesen"),
    );
    expect(await world.service.run(world.input, world.controller.signal)).toBe(
      "Gelesen",
    );
    expect(resources.store.save).toHaveBeenCalledTimes(saved);
    expect(resources.scheduler.snapshot().active).toHaveLength(1);
    expect(resources.scheduler.snapshot().waiting).toEqual([]);
  } finally {
    await occupied.close();
    await resources.scheduler.shutdown();
  }
});
