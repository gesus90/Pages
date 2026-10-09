import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../mcp/src/verification", () => ({ verifyPages: vi.fn() }));
vi.mock("../../mcp/src/project-names", () => ({ listProjectNames: vi.fn() }));

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
