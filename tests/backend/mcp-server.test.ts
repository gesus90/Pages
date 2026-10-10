import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../mcp/src/verification", () => ({ verifyPages: vi.fn() }));
vi.mock("../../mcp/src/project-names", () => ({ listProjectNames: vi.fn() }));
vi.mock("../../mcp/src/tools/read-operation", () => ({
  readOperation: vi.fn(),
}));

import { readOperation } from "../../mcp/src/tools/read-operation";
import { PagesOperationFailure } from "../../mcp/src/tools/operation-failure";
import { PAGES_AGENT_READ_OPERATIONS } from "@/definition/PagesAgentOperations";
import { listProjectNames } from "../../mcp/src/project-names";
import { createServer } from "../../mcp/src/server";
import { verifyPages } from "../../mcp/src/verification";

const identity = { userId: "test", isAdmin: false, permissions: [] };
const configuration = {
  agentsUrl: new URL("https://pages.invalid/api/v1/agents"),
  token: "sentinel-secret",
};

async function connect(resolve = () => configuration) {
  const server = createServer(resolve);
  const messages: Record<string, unknown>[] = [];
  const transport: Parameters<typeof server.connect>[0] = {
    start: async () => {},
    send: async (message) => {
      messages.push(message as Record<string, unknown>);
    },
    close: async () => {},
  };
  await server.connect(transport);
  let nextId = 0;
  transport.onmessage?.({
    jsonrpc: "2.0",
    id: nextId,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    },
  });
  transport.onmessage?.({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  return {
    server,
    messages,
    async request(method: string, params: Record<string, unknown> = {}) {
      const id = ++nextId;
      transport.onmessage?.({ jsonrpc: "2.0", id, method, params });
      await vi.waitFor(() =>
        expect(messages.some((message) => message.id === id)).toBe(true),
      );
      return messages.find((message) => message.id === id);
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(verifyPages).mockResolvedValue({
    identity,
    tools: ["projects.names.list"],
  });
  vi.mocked(listProjectNames).mockResolvedValue(["Alpha", "Beta"]);
});

describe("MCP project-name tool", () => {
  it("advertises its version and exactly one read-only tool when Pages allows it", async () => {
    const { server, messages, request } = await connect();
    await vi.waitFor(() =>
      expect(messages[0]).toMatchObject({
        id: 0,
        result: {
          serverInfo: { name: "pages-mcp", version: "0.1.0" },
          capabilities: { tools: { listChanged: true } },
        },
      }),
    );
    const response = await request("tools/list");
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          {
            name: "list_project_names",
            title: "List project names",
            description: expect.stringContaining("names"),
            inputSchema: { type: "object", additionalProperties: false },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
          },
        ],
      },
    });
    expect(verifyPages).toHaveBeenCalledWith(configuration);
    await server.close();
  });

  it("keeps the list empty when Pages does not allow the function", async () => {
    vi.mocked(verifyPages).mockResolvedValue({ identity, tools: [] });
    const { server, request } = await connect();
    expect(await request("tools/list")).toMatchObject({
      result: { tools: [] },
    });
    await server.close();
  });

  it("returns only the project names Pages supplies", async () => {
    const { server, request } = await connect();
    expect(
      await request("tools/call", { name: "list_project_names" }),
    ).toMatchObject({
      result: { content: [{ type: "text", text: '["Alpha","Beta"]' }] },
    });
    expect(
      await request("tools/call", {
        name: "list_project_names",
        arguments: {},
      }),
    ).toMatchObject({ result: { content: [{ text: '["Alpha","Beta"]' }] } });
    expect(listProjectNames).toHaveBeenCalledTimes(2);
    expect(listProjectNames).toHaveBeenCalledWith(configuration);
    await server.close();
  });

  it("rejects arguments and unknown tools without reading any project", async () => {
    const { server, request } = await connect();
    expect(
      await request("tools/call", {
        name: "list_project_names",
        arguments: { projectId: "1" },
      }),
    ).toMatchObject({
      error: { code: -32602, message: "This tool takes no arguments." },
    });
    expect(
      await request("tools/call", { name: "create_project" }),
    ).toMatchObject({ error: { code: -32602, message: "Unknown tool." } });
    expect(verifyPages).toHaveBeenCalledOnce();
    expect(listProjectNames).not.toHaveBeenCalled();
    await server.close();
  });

  it("fails every list and call with a fixed message when Pages or the credential fails", async () => {
    const failures = [
      () =>
        vi.mocked(verifyPages).mockRejectedValue(new Error("sentinel-secret")),
      () =>
        vi
          .mocked(listProjectNames)
          .mockRejectedValue(new Error("sentinel-secret")),
    ];
    for (const fail of failures) fail();
    const { server, messages, request } = await connect();
    for (const [method, params] of [
      ["tools/list", {}],
      ["tools/call", { name: "list_project_names" }],
      ["tools/call", { name: "unknown" }],
    ] as const)
      expect(await request(method, params)).toMatchObject({
        error: { message: "Pages authorization failed." },
      });
    expect(JSON.stringify(messages)).not.toContain("sentinel-secret");
    await server.close();
  });

  it("fails closed when no credential is available for the request", async () => {
    const { server, request } = await connect(() => {
      throw new Error("sentinel-secret");
    });
    expect(await request("tools/list")).toMatchObject({
      error: { message: "Pages authorization failed." },
    });
    expect(verifyPages).not.toHaveBeenCalled();
    await server.close();
  });
});

describe("MCP A9.5 read tools", () => {
  it("lists exactly the currently allowed read operations", async () => {
    vi.mocked(verifyPages).mockResolvedValue({
      identity,
      tools: ["projects.names.list", ...PAGES_AGENT_READ_OPERATIONS],
    });
    const { server, request } = await connect();
    expect(await request("tools/list")).toMatchObject({
      result: {
        tools: [
          { name: "list_project_names" },
          { name: "resolve_project" },
          { name: "read_project" },
          { name: "read_wiki_page" },
          { name: "read_wiki_tree" },
          { name: "search_wiki" },
        ],
      },
    });
    vi.mocked(verifyPages).mockResolvedValue({
      identity,
      tools: ["wiki.search"],
    });
    expect(await request("tools/list")).toMatchObject({
      result: { tools: [{ name: "search_wiki" }] },
    });
    await server.close();
  });

  it.each([
    ["resolve_project", "projects.resolve", { name: "Alpha" }],
    ["read_project", "projects.read", { projectId: "a" }],
    ["read_wiki_page", "wiki.page.read", { pageId: "p" }],
    ["read_wiki_tree", "wiki.tree.read", undefined],
    ["search_wiki", "wiki.search", { text: "needle" }],
  ] as const)(
    "calls %s with fresh authorization",
    async (name, operation, parameters) => {
      vi.mocked(verifyPages).mockResolvedValue({
        identity,
        tools: [operation],
      });
      vi.mocked(readOperation).mockResolvedValue({ id: "allowed" });
      const { server, request } = await connect();
      expect(
        await request("tools/call", { name, arguments: parameters }),
      ).toMatchObject({ result: { content: [{ text: '{"id":"allowed"}' }] } });
      expect(readOperation).toHaveBeenCalledExactlyOnceWith(
        configuration,
        operation,
        parameters ?? {},
      );
      await server.close();
    },
  );

  it("blocks a direct call after removal from the current tool list", async () => {
    const { server, request } = await connect();
    expect(
      await request("tools/call", {
        name: "read_wiki_page",
        arguments: { pageId: "p" },
      }),
    ).toMatchObject({ error: { message: "Pages authorization failed." } });
    expect(readOperation).not.toHaveBeenCalled();
    await server.close();
  });

  it.each([
    new PagesOperationFailure("NOT_FOUND"),
    new PagesOperationFailure("AMBIGUOUS", {
      candidates: [{ id: "a", name: "Alpha" }],
      truncated: false,
    }),
  ])(
    "returns a public business failure without raw diagnostics",
    async (failure) => {
      vi.mocked(verifyPages).mockResolvedValue({
        identity,
        tools: ["projects.resolve"],
      });
      vi.mocked(readOperation).mockRejectedValue(failure);
      const { server, request } = await connect();
      expect(
        await request("tools/call", {
          name: "resolve_project",
          arguments: { name: "Alpha" },
        }),
      ).toMatchObject({
        result: {
          isError: true,
          content: [
            {
              text: JSON.stringify({
                code: failure.code,
                ...(failure.details === undefined
                  ? {}
                  : { details: failure.details }),
              }),
            },
          ],
        },
      });
      await server.close();
    },
  );

  it("redacts persistence and configuration failures on reads", async () => {
    vi.mocked(verifyPages).mockResolvedValue({
      identity,
      tools: ["wiki.tree.read"],
    });
    vi.mocked(readOperation).mockRejectedValue(new Error("sentinel-secret"));
    const first = await connect();
    expect(
      await first.request("tools/call", { name: "read_wiki_tree" }),
    ).toMatchObject({ error: { message: "Pages authorization failed." } });
    await first.server.close();
    const second = await connect(() => {
      throw new Error("sentinel-secret");
    });
    expect(
      await second.request("tools/call", { name: "read_wiki_tree" }),
    ).toMatchObject({ error: { message: "Pages authorization failed." } });
    await second.server.close();
  });
});
