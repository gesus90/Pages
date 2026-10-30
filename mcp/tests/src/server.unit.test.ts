import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
  ProtocolErrorCode,
} from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import manifest from "../../package.json" with { type: "json" };
import { CredentialStoreError } from "../../src/credential-error.ts";
import { PagesTransportError } from "../../src/pages-transport-error.ts";
import { listProjectNames } from "../../src/project-names.ts";
import { createServer } from "../../src/server.ts";
import { PagesOperationError } from "../../src/tools/operation-failure.ts";
import { readOperation } from "../../src/tools/read-operation.ts";
import { verifyPages } from "../../src/verification.ts";

import type { JSONRPCMessage } from "@modelcontextprotocol/server";
import type { PagesAgentApiBusinessOperation } from "../../../definition/PagesAgentApi.ts";
import type { PagesConfiguration } from "../../src/configuration.ts";

vi.mock("../../src/verification.ts", () => ({ verifyPages: vi.fn() }));
vi.mock("../../src/project-names.ts", () => ({ listProjectNames: vi.fn() }));
vi.mock("../../src/tools/read-operation.ts", () => ({
  readOperation: vi.fn(),
}));

interface Session {
  readonly request: (
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<JSONRPCMessage>;
  readonly close: () => Promise<void>;
}

const CONFIGURATION: PagesConfiguration = {
  agentsUrl: new URL("https://pages.example/api/v1/agents"),
  token: "token",
};
const IDENTITY = { userId: "u1", isAdmin: false, permissions: [] };
const AUTHORIZATION_FAILED = {
  error: {
    code: ProtocolErrorCode.InternalError,
    message: "Pages authorization failed.",
  },
};

let session: Session | undefined;

async function connect(
  resolve: () => PagesConfiguration = () => CONFIGURATION,
): Promise<Session> {
  const [client, transport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<string | number, (message: JSONRPCMessage) => void>();
  client.onmessage = (message) => {
    if ("id" in message && message.id !== undefined)
      pending.get(message.id)?.(message);
  };
  await createServer(resolve).connect(transport);
  await client.start();
  let nextId = 0;
  const request = async (
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<JSONRPCMessage> => {
    nextId += 1;
    const id = nextId;
    const response = new Promise<JSONRPCMessage>((settle) => {
      pending.set(id, settle);
    });
    await client.send({ jsonrpc: "2.0", id, method, params });
    return response;
  };
  return { request, close: async () => client.close() };
}

async function initializedSession(
  resolve?: () => PagesConfiguration,
): Promise<Session> {
  session = await connect(resolve);
  await session.request("initialize", {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "unit-test", version: "1.0.0" },
  });
  return session;
}

function offer(...tools: PagesAgentApiBusinessOperation[]): void {
  vi.mocked(verifyPages).mockResolvedValue({ identity: IDENTITY, tools });
}

beforeEach(() => {
  vi.mocked(verifyPages).mockReset();
  vi.mocked(listProjectNames).mockReset();
  vi.mocked(readOperation).mockReset();
});

afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe("createServer initialization", () => {
  it("identifies itself with the package version and a tools capability", async () => {
    session = await connect();
    const response = await session.request("initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "unit-test", version: "1.0.0" },
    });
    expect(response).toMatchObject({
      result: {
        serverInfo: { name: "pages-mcp", version: manifest.version },
        capabilities: { tools: {} },
      },
    });
    expect(verifyPages).not.toHaveBeenCalled();
  });
});

describe("createServer tools/list", () => {
  it("lists only the tools Pages currently offers", async () => {
    offer("projects.names.list", "wiki.page.read");
    const response = await (await initializedSession()).request("tools/list");
    expect(response).toMatchObject({
      result: {
        tools: [{ name: "list_project_names" }, { name: "read_wiki_page" }],
      },
    });
    expect(verifyPages).toHaveBeenCalledWith(CONFIGURATION);
  });

  it("omits project names when they are not offered", async () => {
    offer("wiki.comments.read", "wiki.page.create");
    const response = await (await initializedSession()).request("tools/list");
    expect(response).toMatchObject({
      result: {
        tools: [{ name: "read_wiki_comments" }, { name: "create_wiki_page" }],
      },
    });
  });

  it("keeps verification failures fixed and distinguishes transport failures", async () => {
    vi.mocked(verifyPages).mockRejectedValue(new Error("token abc expired"));
    const response = await (await initializedSession()).request("tools/list");
    expect(response).toMatchObject(AUTHORIZATION_FAILED);
    expect(JSON.stringify(response)).not.toContain("abc");
    vi.mocked(verifyPages).mockRejectedValue(new PagesTransportError());
    expect(await session?.request("tools/list")).toMatchObject({
      error: { message: new PagesTransportError().message },
    });
  });

  it("passes local credential diagnostics through", async () => {
    vi.mocked(verifyPages).mockRejectedValue(
      new CredentialStoreError("Run pages-mcp pair again."),
    );
    const response = await (await initializedSession()).request("tools/list");
    expect(response).toMatchObject({
      error: { message: "Run pages-mcp pair again." },
    });
  });
});

describe("createServer business tool calls", () => {
  it("returns the operation result as JSON text", async () => {
    offer("wiki.page.read");
    vi.mocked(readOperation).mockResolvedValue({ pageId: "w1" });
    const response = await (
      await initializedSession()
    ).request("tools/call", {
      name: "read_wiki_page",
      arguments: { pageId: "w1" },
    });
    expect(response).toMatchObject({
      result: { content: [{ type: "text", text: '{"pageId":"w1"}' }] },
    });
    expect(readOperation).toHaveBeenCalledWith(
      CONFIGURATION,
      "wiki.page.read",
      { pageId: "w1" },
    );
  });

  it("sends empty parameters when the call has no arguments", async () => {
    offer("wiki.tree.read");
    vi.mocked(readOperation).mockResolvedValue({ nodes: [] });
    await (
      await initializedSession()
    ).request("tools/call", {
      name: "read_wiki_tree",
    });
    expect(readOperation).toHaveBeenCalledWith(
      CONFIGURATION,
      "wiki.tree.read",
      {},
    );
  });

  it("refuses a tool Pages no longer offers", async () => {
    offer("projects.names.list");
    const response = await (
      await initializedSession()
    ).request("tools/call", {
      name: "read_wiki_page",
      arguments: { pageId: "w1" },
    });
    expect(response).toMatchObject(AUTHORIZATION_FAILED);
    expect(readOperation).not.toHaveBeenCalled();
  });

  it("hides a failing configuration lookup", async () => {
    const resolve = vi.fn((): PagesConfiguration => CONFIGURATION);
    const current = await initializedSession(resolve);
    resolve.mockImplementation(() => {
      throw new Error("store unreadable");
    });
    const response = await current.request("tools/call", {
      name: "read_wiki_page",
      arguments: { pageId: "w1" },
    });
    expect(response).toMatchObject(AUTHORIZATION_FAILED);
    expect(verifyPages).not.toHaveBeenCalled();
  });

  it("hides unexpected operation failures", async () => {
    offer("wiki.page.read");
    vi.mocked(readOperation).mockRejectedValue(new Error("Pages read failed."));
    const response = await (
      await initializedSession()
    ).request("tools/call", {
      name: "read_wiki_page",
      arguments: { pageId: "w1" },
    });
    expect(response).toMatchObject(AUTHORIZATION_FAILED);
    vi.mocked(readOperation).mockRejectedValue(new PagesTransportError());
    expect(
      await session?.request("tools/call", {
        name: "read_wiki_page",
        arguments: { pageId: "w1" },
      }),
    ).toMatchObject({
      error: { message: new PagesTransportError().message },
    });
  });
});

describe("createServer business failures", () => {
  it.each([
    [
      new PagesOperationError("NOT_FOUND"),
      { code: "NOT_FOUND", message: "Not found or no access." },
    ],
    [
      new PagesOperationError("AMBIGUOUS", {
        candidates: [{ id: "p1", name: "Plan" }],
        truncated: false,
      }),
      {
        code: "AMBIGUOUS",
        details: { candidates: [{ id: "p1", name: "Plan" }], truncated: false },
      },
    ],
    [new PagesOperationError("FORBIDDEN"), { code: "FORBIDDEN" }],
  ])("returns %s as a tool error", async (failure, expected) => {
    offer("projects.resolve");
    vi.mocked(readOperation).mockRejectedValue(failure);
    const response = await (
      await initializedSession()
    ).request("tools/call", {
      name: "resolve_project",
      arguments: { name: "Plan" },
    });
    expect(response).toMatchObject({ result: { isError: true } });
    const text =
      "result" in response
        ? JSON.stringify(response.result.content)
        : "missing result";
    expect(text).toBe(
      JSON.stringify([{ type: "text", text: JSON.stringify(expected) }]),
    );
  });
});

describe("createServer project names and unknown tools", () => {
  it("returns the visible project names", async () => {
    vi.mocked(listProjectNames).mockResolvedValue(["Plan", "Shared"]);
    const response = await (
      await initializedSession()
    ).request("tools/call", {
      name: "list_project_names",
      arguments: {},
    });
    expect(response).toMatchObject({
      result: { content: [{ type: "text", text: '["Plan","Shared"]' }] },
    });
    expect(listProjectNames).toHaveBeenCalledWith(CONFIGURATION);
  });

  it("accepts a call without arguments", async () => {
    vi.mocked(listProjectNames).mockResolvedValue([]);
    const response = await (
      await initializedSession()
    ).request("tools/call", {
      name: "list_project_names",
    });
    expect(response).toMatchObject({
      result: { content: [{ type: "text", text: "[]" }] },
    });
  });

  it("rejects arguments before asking Pages", async () => {
    const response = await (
      await initializedSession()
    ).request("tools/call", {
      name: "list_project_names",
      arguments: { projectId: "p1" },
    });
    expect(response).toMatchObject({
      error: {
        code: ProtocolErrorCode.InvalidParams,
        message: "This tool takes no arguments.",
      },
    });
    expect(listProjectNames).not.toHaveBeenCalled();
  });

  it("hides a failed project listing", async () => {
    vi.mocked(listProjectNames).mockRejectedValue(new Error("HTTP 500"));
    const response = await (
      await initializedSession()
    ).request("tools/call", {
      name: "list_project_names",
    });
    expect(response).toMatchObject(AUTHORIZATION_FAILED);
  });

  it("verifies the credential before rejecting an unknown tool", async () => {
    offer();
    const response = await (
      await initializedSession()
    ).request("tools/call", {
      name: "drop_database",
    });
    expect(response).toMatchObject({
      error: {
        code: ProtocolErrorCode.InvalidParams,
        message: "Unknown tool.",
      },
    });
    expect(verifyPages).toHaveBeenCalledOnce();
  });

  it("reports a failed verification for an unknown tool", async () => {
    vi.mocked(verifyPages).mockRejectedValue(new Error("revoked"));
    const response = await (
      await initializedSession()
    ).request("tools/call", {
      name: "drop_database",
    });
    expect(response).toMatchObject(AUTHORIZATION_FAILED);
  });
});
