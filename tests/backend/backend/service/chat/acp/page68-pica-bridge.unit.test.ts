import { expect, it, vi } from "vitest";
import { z } from "zod";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { ChatToolExecutor } from "@/backend/service/chat/ChatToolExecutor";
import { PICA_TOOL_OUTCOME } from "@/backend/service/chat/PicaToolSchemas";
import { createPicaTools } from "@/backend/service/chat/PicaTools";
import { PicaBridge } from "@/backend/service/chat/acp/PicaBridge";

import { FIRST, OWNER } from "../page48-chat-fixture";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import type { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import type { PicaToolOutcome } from "@/backend/service/chat/PicaToolSchemas";
import type {
  PicaBridgeLease,
  PicaBridgeResponse,
} from "@/backend/service/chat/acp/PicaBridge";

// Keep the independent MCP catalog outside Pages unit execution.
vi.mock("@/backend/service/chat/PicaPlanTools", () => ({
  registerPicaPlanTools: vi.fn(),
}));

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
  "tickets_set_departments",
  "tickets_set_parent",
  "tickets_set_milestone",
  "tickets_delete",
  "tickets_archive",
  "tickets_restore",
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
  "read_automation_options",
  "list_automations",
  "read_automation",
  "list_automation_runs",
  "read_automation_run",
  "create_automation",
  "update_automation",
  "set_automation_active",
  "run_automation",
  "delete_automation",
];

/** Names of administration: accounts, agents, connections, instance settings and the tag catalog. */
const ADMINISTRATION =
  /^(?:admin|users?|accounts?|agents?|connections?|settings|instance|groups?|departments?_(?:create|set|delete)|tags?_(?:create|set|delete))/u;

const WRITES = [
  [
    "tickets_archive",
    "ticket.archive",
    { ticketId: "PAGE-1", children: "include", confirmed: true },
  ],
  ["tickets_restore", "ticket.restore", { ticketId: "PAGE-1" }],
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

const TOOL_LIST = z.object({
  tools: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      access: z.string(),
      inputSchema: z.object({ additionalProperties: z.literal(false) }),
    }),
  ),
});

async function refuseImages(): Promise<never> {
  throw new Error("The bridge tools return no images");
}

function outcomeOf(answer: PicaBridgeResponse): PicaToolOutcome {
  expect(answer.status).toBe(200);
  return PICA_TOOL_OUTCOME.parse(answer.body);
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
  readonly turn: (message?: string) => void;
  readonly authorization: () => string | null;
  readonly send: (
    body: unknown,
    authorization?: string | null,
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
    userId: OWNER.id,
    sessionId: FIRST,
    catalog: createPicaTools({
      tools,
      sessions,
      authorize: () => Promise.resolve(),
    }).describe(),
    onTool: (event) => events.push(event),
    onImages: refuseImages,
  });
  let answerTurn = 0;
  let current: string | null = null;
  const turn = (message?: string): void => {
    answerTurn += 1;
    current =
      opened.setTurn({
        id: `message-${answerTurn}`,
        answerTurn,
        tools: createPicaTools({ tools, sessions, authorize, message }),
        context,
      })?.authorization ?? null;
  };
  const send = (
    body: unknown,
    authorization: string | null = current,
  ): Promise<PicaBridgeResponse> =>
    bridge.handle({
      method: "POST",
      authorization,
      readBody: async () => JSON.stringify(body),
    });
  const call = async (name: string, input: unknown): Promise<PicaToolOutcome> =>
    outcomeOf(await send({ action: "call", name, arguments: input }));
  return {
    lease: opened,
    router,
    verify,
    authorize,
    confirmationWord,
    events,
    turn,
    authorization: () => current,
    send,
    call,
  };
}

it("lists every native tool of a turn with strict schemas and no administration", async () => {
  const world = bridgeWorld();
  world.turn();
  const listed = TOOL_LIST.parse(
    (await world.send({ action: "catalog" })).body,
  );
  const names = listed.tools.map(({ id }) => id);
  expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS]);
  expect(names.filter((name) => ADMINISTRATION.test(name))).toEqual([]);
  for (const tool of listed.tools)
    expect(tool.description).not.toMatch(/BESTÄTIGEN|CONFIRM|LÖSCHEN/u);
  expect(
    listed.tools.find(({ id }) => id === "tickets_archive")?.description,
  ).toMatch(/without confirmed.*confirm.*confirmed: true/u);
  expect(world.router).not.toHaveBeenCalled();
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
  ["tickets_search", { projectId: "project", archived: "true" }],
  ["tickets_archive", { ticketId: "PAGE-1", children: "omit" }],
  ["tickets_archive", { ticketId: "PAGE-1", confirmed: "true" }],
  ["tickets_archive", { ticketId: "PAGE-1", userId: "foreign" }],
  ["tickets_restore", { ticketId: "PAGE-1", children: "include" }],
  ["tickets_restore", { ticketId: "PAGE-1", operationId: "forged" }],
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

it("deletes on the person's explicit request without any confirmation word, and refuses one supplied by the model", async () => {
  const world = bridgeWorld();
  world.turn("Bitte PAGE-1 entfernen");
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
  expect(
    await world.call("tickets_delete", { ticketId: "PAGE-1" }),
  ).toMatchObject({ ok: true });
  world.turn("Lösche auch den Kommentar");
  expect(
    await world.call("wiki_comment_delete", { commentId: "comment-1" }),
  ).toMatchObject({ ok: true });
  expect(world.confirmationWord).not.toHaveBeenCalled();
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
  });
  expect(world.router.mock.calls[0]?.[1].parameters).not.toHaveProperty(
    "confirmation",
  );
  expect(world.router.mock.calls[1]?.[1].parameters).toMatchObject({
    commentId: "comment-1",
  });
  expect(world.router.mock.calls[1]?.[1].parameters).not.toHaveProperty(
    "confirmation",
  );
});

it("refuses calls between turns, with a foreign or rotated token and after revoked access", async () => {
  const world = bridgeWorld();
  expect(world.authorization()).toBeNull();
  expect((await world.send({ action: "catalog" }, null)).status).toBe(401);
  world.turn();
  const first = world.authorization();
  expect(
    (await world.send({ action: "catalog" }, `Bearer ${"a".repeat(43)}`))
      .status,
  ).toBe(401);
  world.turn();
  expect(world.authorization()).not.toBe(first);
  expect((await world.send({ action: "catalog" }, first)).status).toBe(401);
  world.authorize.mockRejectedValue(new AgentExecutionError("accessDenied"));
  expect(await world.call("projects_list", {})).toMatchObject({
    error: "FORBIDDEN",
  });
  world.lease.close();
  expect((await world.send({ action: "catalog" })).status).toBe(401);
  expect(world.router).not.toHaveBeenCalled();
});

it("enforces 256 actual tool executions across concurrent calls and renews only for a new turn", async () => {
  const world = bridgeWorld();
  world.turn();
  // Malformed or unknown calls never dispatch a service or consume an execution.
  expect((await world.call("projects_list", { forged: true })).error).toBe(
    "INVALID_ARGUMENTS",
  );
  expect((await world.call("unknown", {})).error).toBe("UNKNOWN_TOOL");
  const outcomes = await Promise.all(
    Array.from({ length: 257 }, () => world.call("projects_list", {})),
  );
  expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(256);
  expect(
    outcomes.filter((outcome) => outcome.error === "STEP_LIMIT"),
  ).toHaveLength(1);
  expect(world.router).toHaveBeenCalledTimes(256);
  world.turn();
  expect((await world.call("projects_list", {})).ok).toBe(true);
  expect(world.router).toHaveBeenCalledTimes(257);
  world.lease.close();
});
