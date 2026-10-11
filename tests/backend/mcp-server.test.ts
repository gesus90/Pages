import { beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_IMPORT_LIMITS } from "@/definition/AgentImportManifest";
import { PAGES_AGENT_READ_OPERATIONS } from "@/definition/PagesAgentOperations";

vi.mock("../../mcp/src/verification", () => ({ verifyPages: vi.fn() }));
vi.mock("../../mcp/src/project-names", () => ({ listProjectNames: vi.fn() }));
vi.mock("../../mcp/src/tools/read-operation", () => ({
  readOperation: vi.fn(),
}));

import { readOperation } from "../../mcp/src/tools/read-operation";
import { PagesOperationFailure } from "../../mcp/src/tools/operation-failure";
import { listProjectNames } from "../../mcp/src/project-names";
import { verifyPages } from "../../mcp/src/verification";
import { connectMcpServer } from "../helpers/mcp-server";

import type { McpTestConnection } from "../helpers/mcp-server";

const identity = { userId: "test", isAdmin: false, permissions: [] };
const configuration = {
  agentsUrl: new URL("https://pages.invalid/api/v1/agents"),
  token: "sentinel-secret",
};

function connect(resolve = () => configuration): Promise<McpTestConnection> {
  return connectMcpServer(resolve);
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
          { name: "plan_wiki_import" },
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
    new PagesOperationFailure("CONFLICT"),
    new PagesOperationFailure("FORBIDDEN"),
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
                ...(failure.code === "NOT_FOUND"
                  ? { message: "Not found or no access." }
                  : {}),
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

describe("MCP A9.7 import preview", () => {
  it("lists a read-only stateless index/package contract and authorizes every plan call anew", async () => {
    vi.mocked(verifyPages).mockResolvedValue({
      identity,
      tools: ["wiki.import.plan"],
    });
    const { server, request } = await connect();
    expect(await request("tools/list")).toMatchObject({
      result: {
        tools: [
          {
            name: "plan_wiki_import",
            annotations: {
              readOnlyHint: true,
              idempotentHint: true,
              openWorldHint: false,
            },
            inputSchema: {
              required: ["projectId", "parentId", "manifest"],
              additionalProperties: false,
              properties: {
                manifest: {
                  properties: {
                    index: { maxItems: AGENT_IMPORT_LIMITS.indexEntries },
                    files: { maxItems: AGENT_IMPORT_LIMITS.files },
                  },
                },
              },
            },
          },
        ],
      },
    });
    const parameters = {
      projectId: "alpha",
      parentId: null,
      manifest: {
        version: "1",
        index: [{ sourceKey: "a.md", title: "A", titleSource: "h1" }],
        files: [{ sourceKey: "a.md", content: "# A" }],
      },
    };
    vi.mocked(readOperation).mockResolvedValue({
      pages: [],
      edges: [],
      errors: [],
      conflicts: [],
      fingerprint: "f".repeat(64),
    });
    expect(
      await request("tools/call", {
        name: "plan_wiki_import",
        arguments: parameters,
      }),
    ).toMatchObject({
      result: { content: [{ text: expect.stringContaining("fingerprint") }] },
    });
    expect(readOperation).toHaveBeenCalledExactlyOnceWith(
      configuration,
      "wiki.import.plan",
      parameters,
    );
    vi.mocked(readOperation).mockRejectedValue(
      new PagesOperationFailure("PAYLOAD_TOO_LARGE", {
        constraint: "importFileBytes",
        limit: 16_384,
      }),
    );
    expect(
      await request("tools/call", {
        name: "plan_wiki_import",
        arguments: parameters,
      }),
    ).toMatchObject({
      result: {
        isError: true,
        content: [
          {
            text: '{"code":"PAYLOAD_TOO_LARGE","details":{"constraint":"importFileBytes","limit":16384}}',
          },
        ],
      },
    });
    vi.mocked(verifyPages).mockResolvedValue({ identity, tools: [] });
    expect(
      await request("tools/call", {
        name: "plan_wiki_import",
        arguments: parameters,
      }),
    ).toMatchObject({ error: { message: "Pages authorization failed." } });
    expect(readOperation).toHaveBeenCalledTimes(2);
    await server.close();
  });
});

describe("MCP A9.6 write contracts", () => {
  it("lists only allowed write tools and exposes metadata-only binary upload instructions", async () => {
    vi.mocked(verifyPages).mockResolvedValue({
      identity,
      tools: ["assets.upload.prepare", "wiki.page.create"],
    });
    const { server, request } = await connect();
    expect(await request("tools/list")).toMatchObject({
      result: {
        tools: [
          {
            name: "prepare_asset_upload",
            annotations: { readOnlyHint: false, idempotentHint: false },
            inputSchema: {
              additionalProperties: false,
              required: ["fileName"],
            },
          },
          {
            name: "create_wiki_page",
            annotations: { readOnlyHint: false, idempotentHint: true },
            inputSchema: {
              required: [
                "operationId",
                "projectId",
                "parentId",
                "title",
                "content",
                "icon",
                "assetIds",
              ],
            },
          },
        ],
      },
    });
    vi.mocked(readOperation).mockResolvedValue({
      header: "X-Pages-Upload-Ticket",
      uploadPath: "/api/v1/agent-assets",
      ticket: "synthetic-test-ticket",
    });
    expect(
      await request("tools/call", {
        name: "prepare_asset_upload",
        arguments: { fileName: "image.png" },
      }),
    ).toMatchObject({
      result: {
        content: [{ text: expect.stringContaining("X-Pages-Upload-Ticket") }],
      },
    });
    expect(readOperation).toHaveBeenCalledExactlyOnceWith(
      configuration,
      "assets.upload.prepare",
      { fileName: "image.png" },
    );
    vi.mocked(readOperation).mockResolvedValue({ pageId: "p1" });
    const parameters = {
      operationId: "operation",
      projectId: "project",
      parentId: null,
      title: "Page",
      content: "# Page",
      icon: null,
      assetIds: [],
    };
    expect(
      await request("tools/call", {
        name: "create_wiki_page",
        arguments: parameters,
      }),
    ).toMatchObject({ result: { content: [{ text: '{"pageId":"p1"}' }] } });
    expect(readOperation).toHaveBeenLastCalledWith(
      configuration,
      "wiki.page.create",
      parameters,
    );
    vi.mocked(verifyPages).mockResolvedValue({ identity, tools: [] });
    expect(
      await request("tools/call", {
        name: "create_wiki_page",
        arguments: parameters,
      }),
    ).toMatchObject({ error: { message: "Pages authorization failed." } });
    await server.close();
  });
});

describe("MCP A9.8 confirmed import contract", () => {
  it("exposes the bounded idempotent apply tool and rechecks authorization on every call", async () => {
    vi.mocked(verifyPages).mockResolvedValue({
      identity,
      tools: ["wiki.import.apply"],
    });
    const { server, request } = await connect();
    expect(await request("tools/list")).toMatchObject({
      result: {
        tools: [
          {
            name: "apply_wiki_import",
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
            inputSchema: {
              additionalProperties: false,
              required: [
                "operationId",
                "fingerprint",
                "projectId",
                "parentId",
                "manifest",
              ],
              properties: {
                operationId: { type: "string", minLength: 1, maxLength: 200 },
                fingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
                assets: {
                  maxItems: 32,
                  items: {
                    additionalProperties: false,
                    required: ["sourceKey", "assetIds"],
                    properties: {
                      assetIds: { maxItems: 100, uniqueItems: true },
                    },
                  },
                },
                manifest: {
                  properties: {
                    index: { maxItems: 128 },
                    files: { maxItems: 32 },
                  },
                },
              },
            },
          },
        ],
      },
    });
    const parameters = {
      operationId: "import",
      fingerprint: "a".repeat(64),
      projectId: "alpha",
      parentId: null,
      manifest: { version: "1", index: [], files: [] },
      assets: [],
    };
    const result = {
      runId: "run",
      status: "partial",
      counts: { created: 1, skipped: 0, conflict: 1, failed: 0 },
      items: [],
    };
    vi.mocked(readOperation).mockResolvedValue(result);
    for (let attempt = 0; attempt < 2; attempt++)
      expect(
        await request("tools/call", {
          name: "apply_wiki_import",
          arguments: parameters,
        }),
      ).toMatchObject({
        result: { content: [{ text: JSON.stringify(result) }] },
      });
    expect(readOperation).toHaveBeenCalledTimes(2);
    expect(readOperation).toHaveBeenLastCalledWith(
      configuration,
      "wiki.import.apply",
      parameters,
    );
    vi.mocked(readOperation).mockRejectedValueOnce(
      new PagesOperationFailure("CONFLICT"),
    );
    expect(
      await request("tools/call", {
        name: "apply_wiki_import",
        arguments: parameters,
      }),
    ).toMatchObject({
      result: { isError: true, content: [{ text: '{"code":"CONFLICT"}' }] },
    });
    vi.mocked(verifyPages).mockResolvedValue({ identity, tools: [] });
    expect(await request("tools/list")).toMatchObject({
      result: { tools: [] },
    });
    expect(
      await request("tools/call", {
        name: "apply_wiki_import",
        arguments: parameters,
      }),
    ).toMatchObject({ error: { message: "Pages authorization failed." } });
    expect(readOperation).toHaveBeenCalledTimes(3);
    await server.close();
  });
});
