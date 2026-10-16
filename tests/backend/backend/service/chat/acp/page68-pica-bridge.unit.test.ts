import { expect, it, vi } from "vitest";
import { z } from "zod";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { ChatToolExecutor } from "@/backend/service/chat/ChatToolExecutor";
import { PICA_TOOL_OUTCOME } from "@/backend/service/chat/PicaToolSchemas";
import { createPicaTools } from "@/backend/service/chat/PicaTools";
import { PicaBridge } from "@/backend/service/chat/acp/PicaBridge";

import { FIRST, OWNER } from "../page48-chat-fixture";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import type { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import type { PicaToolOutcome } from "@/backend/service/chat/PicaToolSchemas";
import type { PicaBridgeLease } from "@/backend/service/chat/acp/PicaBridge";
import type { PicaBridgeResponse } from "@/backend/service/chat/acp/PicaBridgeProtocol";

const BRIDGE_URL = "http://127.0.0.1:3100/api/v1/pica-bridge";

const READ_TOOLS = [
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
];

const WRITE_TOOLS = [
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
];

/** Names of administration: accounts, agents, connections, instance settings and the tag catalog. */
const ADMINISTRATION =
  /^(?:admin|users?|accounts?|agents?|connections?|settings|instance|groups?|departments?_(?:create|set|delete)|tags?_(?:create|set|delete))/u;

const WRITES = [
  [
    "tickets_create",
    "ticket.create",
    {
      projectId: "project",
      type: "task",
      title: "Neu",
      description: "Erste Zeile\nZweite Zeile",
      statusId: null,
      parentId: null,
    },
  ],
  [
    "tickets_set_title",
    "ticket.setTitle",
    { ticketId: "PAGE-1", expectedTitle: "Alt", title: "Neu" },
  ],
  [
    "tickets_set_status",
    "ticket.setStatus",
    { ticketId: "PAGE-1", expectedStatusId: "todo", statusId: "done" },
  ],
  [
    "tickets_set_description",
    "ticket.setDescription",
    { ticketId: "PAGE-1", expectedDescription: "Alt", description: "Neu" },
  ],
  [
    "tickets_set_assignee",
    "ticket.setAssignee",
    {
      ticketId: "PAGE-1",
      targetType: "person",
      targetId: "person-2",
      expectedAssigneeId: null,
      expectedAssigneeGroupId: null,
    },
  ],
  [
    "tickets_set_tags",
    "ticket.setTags",
    { ticketId: "PAGE-1", tagIds: ["tag-1", "tag-2"], expectedTagIds: [] },
  ],
  [
    "wiki_comment_add",
    "wiki.comment.add",
    { pageId: "page-1", body: "Kommentar", parentId: null, quote: null },
  ],
] as const;

const TOOL_ANSWER = z.object({
  result: z.object({
    content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
    isError: z.boolean(),
  }),
});

const TOOL_LIST = z.object({
  result: z.object({
    tools: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        inputSchema: z.object({ additionalProperties: z.literal(false) }),
      }),
    ),
  }),
});

function authorizationOf(lease: PicaBridgeLease): string {
  const { server } = lease;
  if (!("type" in server) || server.type !== "http")
    throw new Error("The bridge offers an HTTP server.");
  const header = server.headers.find(({ name }) => name === "Authorization");
  if (!header) throw new Error("The bridge server carries its token.");
  return header.value;
}

function outcomeOf(answer: PicaBridgeResponse): PicaToolOutcome {
  const { result } = TOOL_ANSWER.parse(answer.body);
  const outcome = PICA_TOOL_OUTCOME.parse(
    JSON.parse(result.content.at(0)?.text ?? "null"),
  );
  expect(result.isError).toBe(!outcome.ok);
  return outcome;
}

/** The bridge of one job with the real tools and executor; only the operation router is replaced. */
function bridgeWorld(): {
  readonly lease: PicaBridgeLease;
  readonly router: ReturnType<typeof vi.fn<AgentOperationRouter["handle"]>>;
  readonly verify: ReturnType<
    typeof vi.fn<
      (userId: string) => Promise<{
        userId: string;
        isAdmin: boolean;
        permissions: readonly [];
      }>
    >
  >;
  readonly authorize: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly confirmationWord: ReturnType<
    typeof vi.fn<ChatSessionService["confirmationWord"]>
  >;
  readonly events: unknown[];
  readonly turn: () => void;
  readonly send: (
    body: unknown,
    authorization?: string,
  ) => Promise<PicaBridgeResponse>;
  readonly call: (name: string, input: unknown) => Promise<PicaToolOutcome>;
} {
  const router = vi.fn<AgentOperationRouter["handle"]>(async (_, request) => ({
    apiVersion: "1",
    result: { id: "synthetic", name: String(request.operation) },
  }));
  const verify = vi.fn(async (userId: string) => ({
    userId,
    isAdmin: false,
    permissions: [] as const,
  }));
  const tools = new ChatToolExecutor({
    identities: { verify },
    router: { handle: router },
  });
  const authorize = vi.fn(async () => undefined);
  const confirmationWord = vi.fn<ChatSessionService["confirmationWord"]>(
    async () => "LÖSCHEN",
  );
  const sessions = { confirmationWord };
  const events: unknown[] = [];
  const context: RuntimeExecutionContext = Object.freeze({
    userId: OWNER.id,
    sessionId: FIRST,
    runId: "job",
    signal: new AbortController().signal,
    authorize,
  });
  const bridge = new PicaBridge(BRIDGE_URL);
  const opened = bridge.open({
    jobId: "job",
    catalog: createPicaTools({
      tools,
      sessions,
      authorize: () => Promise.resolve(),
    }).describe(),
    onTool: (event) => events.push(event),
  });
  const turn = (): void => {
    opened.setTurn({
      tools: createPicaTools({ tools, sessions, authorize }),
      context,
    });
  };
  const send = (
    body: unknown,
    authorization = authorizationOf(opened),
  ): Promise<PicaBridgeResponse> =>
    bridge.handle({
      method: "POST",
      authorization,
      readBody: async () => JSON.stringify(body),
    });
  const call = async (name: string, input: unknown): Promise<PicaToolOutcome> =>
    outcomeOf(
      await send({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name, arguments: input },
      }),
    );
  return {
    lease: opened,
    router,
    verify,
    authorize,
    confirmationWord,
    events,
    turn,
    send,
    call,
  };
}

it("lets an MCP client initialize and list every native tool with strict schemas and no administration", async () => {
  const world = bridgeWorld();
  const initialized = await world.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  });
  expect(initialized.status).toBe(200);
  expect(initialized.sessionId).toEqual(expect.any(String));
  expect(
    (
      await world.send({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      })
    ).status,
  ).toBe(202);
  const listed = TOOL_LIST.parse(
    (await world.send({ jsonrpc: "2.0", id: 2, method: "tools/list" })).body,
  );
  const names = listed.result.tools.map(({ name }) => name);
  expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS]);
  expect(names.filter((name) => ADMINISTRATION.test(name))).toEqual([]);
  for (const tool of listed.result.tools)
    expect(tool.description).not.toMatch(/BESTÄTIGEN|CONFIRM|LÖSCHEN/u);
});

it("reads projects, the person's own tickets and the wiki with fresh rights on every call", async () => {
  const world = bridgeWorld();
  world.turn();
  const outcomes = [
    await world.call("projects_list", {}),
    await world.call("tickets_search", {
      projectId: "project",
      assignedToMe: true,
    }),
    await world.call("wiki_search", { text: "Handbuch" }),
    await world.call("wiki_page_read", { pageId: "page-1" }),
    await world.call("wiki_comments_read", { pageId: "page-1" }),
  ];
  expect(outcomes.every(({ ok }) => ok)).toBe(true);
  expect(outcomes[0]?.result).toContain("projects.list");
  expect(
    world.router.mock.calls.map(([identity, request]) => [
      identity.userId,
      request.operation,
      request.parameters,
    ]),
  ).toEqual([
    [OWNER.id, "projects.list", {}],
    [
      OWNER.id,
      "tickets.search",
      { projectId: "project", limit: 20, assigneeId: OWNER.id },
    ],
    [OWNER.id, "wiki.search", { text: "Handbuch" }],
    [OWNER.id, "wiki.page.read", { pageId: "page-1" }],
    [OWNER.id, "wiki.comments.read", { pageId: "page-1" }],
  ]);
  expect(world.verify).toHaveBeenCalledTimes(5);
  expect(world.authorize.mock.calls.length).toBeGreaterThanOrEqual(10);
  expect(world.events).toHaveLength(10);
});

it.each([
  ["tickets_search", { projectId: "project", assigneeId: "foreign" }],
  ["tickets_search", { projectId: "project", userId: "foreign" }],
  ["projects_list", { includeHidden: true }],
  ["wiki_page_read", { pageId: "../server" }],
  ["tickets_set_title", { ticketId: "PAGE-1", title: "Neu" }],
])(
  "refuses arguments outside the strict schema of %s before any dispatch",
  async (tool, input) => {
    const world = bridgeWorld();
    world.turn();
    expect(await world.call(tool, input)).toEqual({
      ok: false,
      result: null,
      error: "INVALID_ARGUMENTS",
    });
    expect(world.router).not.toHaveBeenCalled();
  },
);

it.each(WRITES)(
  "runs %s for the person on request, without a confirmation line",
  async (tool, operation, parameters) => {
    const world = bridgeWorld();
    world.turn();
    expect(await world.call(tool, parameters)).toMatchObject({ ok: true });
    expect(world.router).toHaveBeenCalledOnce();
    const [identity, request] = world.router.mock.calls[0] ?? [];
    expect(identity?.userId).toBe(OWNER.id);
    expect(request?.operation).toBe(operation);
    expect(request?.parameters).toMatchObject(parameters);
    expect(request?.parameters).toHaveProperty("operationId");
    expect(request?.parameters).not.toHaveProperty("confirmation");
  },
);

it.each(WRITES)(
  "does not send %s again unchanged after it failed in the same turn",
  async (tool, _, parameters) => {
    const world = bridgeWorld();
    const changed = Object.fromEntries(
      Object.entries(parameters).map(([key, value]) => [
        key,
        key === "ticketId" || key === "pageId" || key === "projectId"
          ? "other"
          : value,
      ]),
    );
    world.turn();
    world.router.mockRejectedValue(new AgentOperationError("CONFLICT"));
    expect(await world.call(tool, parameters)).toEqual({
      ok: false,
      result: null,
      error: "CONFLICT",
    });
    expect(await world.call(tool, parameters)).toEqual({
      ok: false,
      result: null,
      error: "RETRY_REFUSED",
    });
    expect(world.router).toHaveBeenCalledOnce();
    expect(await world.call(tool, changed)).toMatchObject({
      error: "CONFLICT",
    });
    expect(world.router).toHaveBeenCalledTimes(2);
  },
);

it("recognizes a failed write regardless of key order and refuses it until the next turn", async () => {
  const world = bridgeWorld();
  const tags = {
    ticketId: "PAGE-1",
    tagIds: ["tag-1"],
    expectedTagIds: [],
  };
  world.turn();
  world.router.mockRejectedValueOnce(new AgentOperationError("CONFLICT"));
  expect(await world.call("tickets_set_tags", tags)).toMatchObject({
    ok: false,
    error: "CONFLICT",
  });
  expect(
    await world.call("tickets_set_tags", {
      expectedTagIds: [],
      tagIds: ["tag-1"],
      ticketId: "PAGE-1",
    }),
  ).toMatchObject({ ok: false, error: "RETRY_REFUSED" });
  world.turn();
  expect(await world.call("tickets_set_tags", tags)).toMatchObject({
    ok: true,
  });
  expect(world.router).toHaveBeenCalledTimes(2);
});

it("deletes with the confirmation word Pages reads for the person, never with one of the model", async () => {
  const world = bridgeWorld();
  world.turn();
  expect(
    await world.call("tickets_delete", {
      ticketId: "PAGE-1",
      confirmation: "LÖSCHEN",
    }),
  ).toMatchObject({ ok: false, error: "INVALID_ARGUMENTS" });
  for (const tool of ["pages_operation", "users_delete", "agents_delete"])
    expect(await world.call(tool, { ticketId: "PAGE-1" })).toEqual({
      ok: false,
      result: null,
      error: "UNKNOWN_TOOL",
    });
  expect(world.router).not.toHaveBeenCalled();
  world.confirmationWord.mockResolvedValueOnce("DELETE");
  expect(
    await world.call("tickets_delete", { ticketId: "PAGE-1" }),
  ).toMatchObject({ ok: true });
  expect(
    await world.call("wiki_comment_delete", { commentId: "comment-1" }),
  ).toMatchObject({ ok: true });
  expect(world.confirmationWord.mock.calls).toEqual([[OWNER.id], [OWNER.id]]);
  expect(
    world.router.mock.calls.map(([identity, request]) => [
      identity.userId,
      request.operation,
    ]),
  ).toEqual([
    [OWNER.id, "ticket.delete"],
    [OWNER.id, "wiki.comment.delete"],
  ]);
  expect(world.router.mock.calls[0]?.[1].parameters).toMatchObject({
    ticketId: "PAGE-1",
    confirmation: "DELETE",
  });
  expect(world.router.mock.calls[1]?.[1].parameters).toMatchObject({
    commentId: "comment-1",
    confirmation: "LÖSCHEN",
  });
});

it("refuses calls between turns, with a foreign token and after revoked access", async () => {
  const world = bridgeWorld();
  expect(await world.call("projects_list", {})).toMatchObject({
    error: "TURN_INACTIVE",
  });
  world.turn();
  expect(
    (
      await world.send(
        { jsonrpc: "2.0", id: 3, method: "tools/list" },
        `Bearer ${"a".repeat(43)}`,
      )
    ).status,
  ).toBe(401);
  world.authorize.mockRejectedValue(new TextAssistantError("accessDenied"));
  expect(await world.call("projects_list", {})).toMatchObject({
    error: "FORBIDDEN",
  });
  world.lease.close();
  expect(
    (await world.send({ jsonrpc: "2.0", id: 4, method: "tools/list" })).status,
  ).toBe(401);
  expect(world.router).not.toHaveBeenCalled();
});
