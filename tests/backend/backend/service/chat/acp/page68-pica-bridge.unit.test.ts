import { expect, it, vi } from "vitest";
import { z } from "zod";

import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { ChatToolExecutor } from "@/backend/service/chat/ChatToolExecutor";
import { PICA_TOOL_OUTCOME } from "@/backend/service/chat/PicaToolSchemas";
import { createPicaTools } from "@/backend/service/chat/PicaTools";
import { PicaWriteConfirmation } from "@/backend/service/chat/PicaWriteConfirmation";
import { PicaBridge } from "@/backend/service/chat/acp/PicaBridge";

import { FIRST, OWNER } from "../page48-chat-fixture";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import type { PicaToolOutcome } from "@/backend/service/chat/PicaToolSchemas";
import type { PicaBridgeLease } from "@/backend/service/chat/acp/PicaBridge";
import type { PicaBridgeResponse } from "@/backend/service/chat/acp/PicaBridgeProtocol";

const BRIDGE_URL = "http://127.0.0.1:3100/api/v1/pica-bridge";

const READ_TOOLS = [
  "projects_list",
  "projects_read",
  "tickets_search",
  "tickets_read",
  "assignment_targets_search",
  "tags_list",
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
  "wiki_comment_add",
];

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

function confirmation(tool: string, parameters: unknown): string {
  return `BESTÄTIGEN ${tool} ${JSON.stringify(parameters)}`;
}

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
  readonly events: unknown[];
  readonly turn: (message: string) => PicaWriteConfirmation;
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
      message: "",
      authorize: () => Promise.resolve(),
    }).describe(),
    onTool: (event) => events.push(event),
  });
  const turn = (message: string): PicaWriteConfirmation => {
    const confirmations = new PicaWriteConfirmation(message);
    opened.setTurn({
      tools: createPicaTools({ tools, message, authorize, confirmations }),
      context,
    });
    return confirmations;
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
    events,
    turn,
    send,
    call,
  };
}

it("lets an MCP client initialize and list every native tool with strict schemas and no deletion", async () => {
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
  expect(names.some((name) => name.includes("delete"))).toBe(false);
  for (const tool of listed.result.tools.filter(({ name }) =>
    WRITE_TOOLS.includes(name),
  ))
    expect(tool.description).toContain("BESTÄTIGEN/CONFIRM");
});

it("reads projects, the person's own tickets and the wiki with fresh rights on every call", async () => {
  const world = bridgeWorld();
  world.turn("Liste die Titel meiner offenen Tickets");
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
    world.turn(
      confirmation("tickets_set_title", {
        ticketId: "PAGE-1",
        expectedTitle: "Alt",
        title: "Neu",
      }),
    );
    expect(await world.call(tool, input)).toEqual({
      ok: false,
      result: null,
      error: "INVALID_ARGUMENTS",
    });
    expect(world.router).not.toHaveBeenCalled();
  },
);

it.each(WRITES)(
  "runs %s once for the exact confirmation line of the current message",
  async (tool, operation, parameters) => {
    const world = bridgeWorld();
    world.turn(`Bitte ausführen\n${confirmation(tool, parameters)}`);
    expect(await world.call(tool, parameters)).toMatchObject({ ok: true });
    expect(await world.call(tool, parameters)).toEqual({
      ok: false,
      result: null,
      error: "CONFIRMATION_REQUIRED",
    });
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
  "refuses %s without a confirmation line or with other arguments",
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
    world.turn(
      ["Ja, mach das", "LÖSCHEN", confirmation(tool, changed)].join("\n"),
    );
    expect(await world.call(tool, parameters)).toEqual({
      ok: false,
      result: null,
      error: "CONFIRMATION_REQUIRED",
    });
    expect(world.router).not.toHaveBeenCalled();
  },
);

it("matches a confirmation regardless of key order and accepts the line of a steer", async () => {
  const world = bridgeWorld();
  const tags = {
    ticketId: "PAGE-1",
    tagIds: ["tag-1"],
    expectedTagIds: [],
  };
  const confirmations = world.turn("Setze die Tags");
  expect(await world.call("tickets_set_tags", tags)).toMatchObject({
    ok: false,
    error: "CONFIRMATION_REQUIRED",
  });
  confirmations.add(
    'CONFIRM tickets_set_tags {"expectedTagIds":[],"tagIds":["tag-1"],"ticketId":"PAGE-1"}',
  );
  expect(await world.call("tickets_set_tags", tags)).toMatchObject({
    ok: true,
  });
  expect(world.router).toHaveBeenCalledOnce();
});

it("offers no deletion and never passes the confirmation word on to a deleting operation", async () => {
  const world = bridgeWorld();
  world.turn('LÖSCHEN\nBESTÄTIGEN tickets_delete {"ticketId":"PAGE-1"}');
  for (const tool of [
    "tickets_delete",
    "wiki_comment_delete",
    "pages_operation",
  ])
    expect(await world.call(tool, { ticketId: "PAGE-1" })).toEqual({
      ok: false,
      result: null,
      error: "UNKNOWN_TOOL",
    });
  expect(world.router).not.toHaveBeenCalled();
});

it("refuses calls between turns, with a foreign token and after revoked access", async () => {
  const world = bridgeWorld();
  expect(await world.call("projects_list", {})).toMatchObject({
    error: "TURN_INACTIVE",
  });
  world.turn("Lies die Projekte");
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
