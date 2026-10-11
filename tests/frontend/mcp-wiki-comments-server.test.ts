import { RouterContextProvider } from "react-router";
import { expect, it, vi } from "vitest";

import { createMcpServices } from "@/app/lib/mcp-services.server";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { PAGES_AGENT_COMMENT_OPERATIONS } from "@/definition/PagesAgentOperations";

import { connectMcpServer } from "../helpers/mcp-server";
import { useAgentCommentHarness } from "../helpers/wiki-agent-comments";
import { wikiFieldState } from "../helpers/wiki-fields";

import type { McpApplicationServices } from "@/app/lib/mcp-services.server";
import type { AgentCommentHarness } from "../helpers/wiki-agent-comments";
import type { McpTestConnection } from "../helpers/mcp-server";

const runtime = vi.hoisted(() => ({
  services: undefined as McpApplicationServices | undefined,
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: () => {
    if (!runtime.services) throw new Error("Expected isolated application.");
    return runtime.services;
  },
}));

import { action } from "@/app/routes/api-v1-agents";

function application(harness: AgentCommentHarness): McpApplicationServices {
  const users = new UserRepository(harness.database);
  const authorization = new AuthorizationRepository(harness.database);
  return createMcpServices(
    harness.database,
    { getById: (id) => users.findById(id) },
    {
      getContext: async (id) => {
        const account = (await authorization.snapshot()).accounts.find(
          (entry) => entry.userId === id,
        );
        if (!account) throw new Error("Expected fixture account.");
        return account;
      },
    },
    { directory: harness.filesDirectory, wikiService: harness.service },
  );
}

async function call(
  connection: McpTestConnection,
  name: string,
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await connection.request("tools/call", {
    name,
    arguments: parameters,
  });
  const result = response?.result;
  if (
    typeof result !== "object" ||
    result === null ||
    !("content" in result) ||
    !Array.isArray(result.content)
  )
    throw new Error("Expected MCP content.");
  const content: unknown = result.content[0];
  if (
    typeof content !== "object" ||
    content === null ||
    !("text" in content) ||
    typeof content.text !== "string"
  )
    throw new Error("Expected MCP text.");
  const parsed: unknown = JSON.parse(content.text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("Expected MCP JSON result.");
  return parsed as Record<string, unknown>;
}

async function checkCommentLifecycle(
  connection: McpTestConnection,
  harness: AgentCommentHarness,
  root: Readonly<Record<string, unknown>>,
): Promise<void> {
  await call(connection, "add_wiki_comment", {
    pageId: harness.page.id,
    operationId: "reply",
    body: "Reply",
    parentId: root.commentId,
  });
  const reader = await call(connection, "read_wiki_comments", {
    pageId: harness.page.id,
  });
  expect(reader).toMatchObject({
    threads: [
      {
        comment: {
          body: "Root @writer",
          authorName: "Reader",
          canEdit: true,
        },
        replies: [{ body: "Reply" }],
      },
    ],
  });
  await call(connection, "edit_wiki_comment", {
    operationId: "edit",
    commentId: root.commentId,
    body: "Changed",
  });
  expect(
    await call(connection, "resolve_wiki_comment", {
      operationId: "resolve",
      commentId: root.commentId,
      resolved: true,
    }),
  ).toMatchObject({ action: "resolved", changed: true });
  expect(
    await call(connection, "delete_wiki_comment", {
      operationId: "delete",
      commentId: root.commentId,
    }),
  ).toMatchObject({ deletedComments: 2 });
  expect(
    await call(connection, "read_wiki_comments", { pageId: harness.page.id }),
  ).toMatchObject({ threads: [] });
}

async function checkReaderTools(
  services: McpApplicationServices,
  connection: McpTestConnection,
  token: string,
): Promise<void> {
  const verified = await services.pagesAgentApiService.handle(token, {
    operation: "verify",
  });
  expect(verified).toMatchObject({
    identity: { userId: "reader", permissions: [] },
    tools: expect.arrayContaining([...PAGES_AGENT_COMMENT_OPERATIONS]),
  });
  expect(await connection.request("tools/list")).toMatchObject({
    result: {
      tools: expect.arrayContaining([
        ...[
          "read_wiki_comments",
          "add_wiki_comment",
          "edit_wiki_comment",
          "resolve_wiki_comment",
          "delete_wiki_comment",
        ].map((name) => expect.objectContaining({ name })),
      ]),
    },
  });
}

const setup = useAgentCommentHarness();

it("runs all five tools through the real route, credential, policy and transaction, recovers response loss and blocks revoked retries", async () => {
  const harness = await setup();
  const services = application(harness);
  runtime.services = services;
  const credential = await services.personalAgentTokenService.create(
    "reader",
    "comments",
    null,
  );
  const events = vi.fn();
  services.pagesEventPublisher.subscribe(events);
  let shouldLoseResponse = true;
  const fetchRequest = vi.fn<typeof fetch>(async (input, options) => {
    const request = new Request(input, options);
    expect(request.url).toBe("https://pages.invalid/api/v1/agents");
    const body: unknown = await request.clone().json();
    const response = await action({
      request,
      context: new RouterContextProvider(),
      params: {},
      url: new URL(request.url),
      pattern: "/api/v1/agents",
    });
    if (
      shouldLoseResponse &&
      typeof body === "object" &&
      body !== null &&
      "operation" in body &&
      body.operation === "wiki.comment.add"
    ) {
      shouldLoseResponse = false;
      throw new Error("Synthetic response loss after commit");
    }
    return response;
  });
  vi.stubGlobal("fetch", fetchRequest);
  const configuration = {
    agentsUrl: new URL("https://pages.invalid/api/v1/agents"),
    token: credential.token,
  };
  const connection = await connectMcpServer(() => configuration);
  try {
    await checkReaderTools(services, connection, credential.token);
    const input = {
      operationId: "lost-response",
      pageId: `/wiki/${harness.page.id}`,
      body: "Root @writer",
    };
    expect(
      await connection.request("tools/call", {
        name: "add_wiki_comment",
        arguments: input,
      }),
    ).toMatchObject({ error: { message: "Pages authorization failed." } });
    const root = await call(connection, "add_wiki_comment", input);
    expect(root).toMatchObject({ pageId: harness.page.id, parentId: null });
    expect(
      await harness.database.query("SELECT COUNT(*) FROM wiki_comments;"),
    ).toEqual([[1]]);
    await checkCommentLifecycle(connection, harness, root);
    expect(events).toHaveBeenCalledTimes(5);
    expect(
      await harness.database.query("SELECT COUNT(*) FROM wiki_mentions;"),
    ).toEqual([[0]]);
    await services.personalAgentTokenService.revoke(
      "reader",
      credential.summary.id,
    );
    const before = await wikiFieldState(harness.database, {
      includeOperationKeys: true,
    });
    expect(await connection.request("tools/list")).toMatchObject({
      error: { message: "Pages authorization failed." },
    });
    expect(
      await connection.request("tools/call", {
        name: "add_wiki_comment",
        arguments: input,
      }),
    ).toMatchObject({ error: { message: "Pages authorization failed." } });
    expect(
      await wikiFieldState(harness.database, { includeOperationKeys: true }),
    ).toEqual(before);
    expect(events).toHaveBeenCalledTimes(5);
  } finally {
    await connection.server.close();
    runtime.services = undefined;
  }
});
