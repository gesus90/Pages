import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
  ProtocolErrorCode,
} from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createServer } from "../../../src/server.ts";
import { PagesOperationFailure } from "../../../src/tools/operation-failure.ts";
import {
  PROJECT_DELETE_TOOL,
  PROJECT_DELETION_SCOPE_TOOL,
} from "../../../src/tools/project-deletion.ts";
import { readOperation } from "../../../src/tools/read-operation.ts";
import { READ_TOOLS } from "../../../src/tools/registry.ts";
import { WRITE_TOOLS } from "../../../src/tools/write-registry.ts";
import { verifyPages } from "../../../src/verification.ts";

import type { JSONRPCMessage } from "@modelcontextprotocol/server";
import type { PagesAgentApiBusinessOperation } from "../../../../definition/PagesAgentApi.ts";
import type { PagesConfiguration } from "../../../src/configuration.ts";

vi.mock("../../../src/verification.ts", () => ({ verifyPages: vi.fn() }));
vi.mock("../../../src/project-names.ts", () => ({ listProjectNames: vi.fn() }));
vi.mock("../../../src/tools/read-operation.ts", () => ({
  readOperation: vi.fn(),
}));

const CONFIGURATION: PagesConfiguration = {
  agentsUrl: new URL("https://pages.example/api/v1/agents"),
  token: "token",
};
const ADMIN = { userId: "admin", isAdmin: true, permissions: [] };
const PERSON = { userId: "person", isAdmin: false, permissions: [] };
const DELETION = {
  operationId: "op-1",
  projectId: "project-1",
  confirmation: "LÖSCHEN",
};

interface Session {
  readonly request: (
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<JSONRPCMessage>;
  readonly close: () => Promise<void>;
}

let session: Session | undefined;

async function connect(): Promise<Session> {
  const [client, transport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<string | number, (message: JSONRPCMessage) => void>();
  client.onmessage = (message) => {
    if ("id" in message && message.id !== undefined)
      pending.get(message.id)?.(message);
  };
  await createServer(() => CONFIGURATION).connect(transport);
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

async function initialized(): Promise<Session> {
  session = await connect();
  await session.request("initialize", {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "unit-test", version: "1.0.0" },
  });
  return session;
}

function offer(
  identity: typeof ADMIN,
  ...tools: PagesAgentApiBusinessOperation[]
): void {
  vi.mocked(verifyPages).mockResolvedValue({ identity, tools });
}

beforeEach(() => {
  vi.mocked(verifyPages).mockReset();
  vi.mocked(readOperation).mockReset();
});

afterEach(async () => {
  await session?.close();
  session = undefined;
});

function textOf(response: JSONRPCMessage): string {
  return "result" in response ? JSON.stringify(response.result.content) : "";
}

describe("project deletion tool definitions", () => {
  it("registers exactly one read and one write tool for the two operations", () => {
    expect(
      READ_TOOLS.filter(
        ({ tool }) => tool === PROJECT_DELETION_SCOPE_TOOL.tool,
      ),
    ).toHaveLength(1);
    expect(
      WRITE_TOOLS.filter(({ tool }) => tool === PROJECT_DELETE_TOOL.tool),
    ).toHaveLength(1);
    expect(PROJECT_DELETION_SCOPE_TOOL.operation).toBe(
      "admin.projects.deletionScope",
    );
    expect(PROJECT_DELETE_TOOL.operation).toBe("admin.projects.delete");
  });

  it("reads the extent of one project without changing anything", () => {
    const { tool } = PROJECT_DELETION_SCOPE_TOOL;
    expect(tool.name).toBe("read_admin_project_deletion_scope");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {
        projectId: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["projectId"],
      additionalProperties: false,
    });
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tool.description).toMatch(/Changes nothing/);
    expect(tool.description).toMatch(/personal administrator eligibility/);
  });

  it("requires the project, an operation ID and one of the two confirmation words", () => {
    const { tool } = PROJECT_DELETE_TOOL;
    expect(tool.name).toBe("delete_admin_project");
    expect(tool.inputSchema.required).toEqual([
      "operationId",
      "projectId",
      "confirmation",
    ]);
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.inputSchema.properties?.confirmation).toEqual({
      type: "string",
      enum: ["LÖSCHEN", "DELETE"],
    });
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("states rights, confirmation, extent and failure behavior in its description", () => {
    const description = PROJECT_DELETE_TOOL.tool.description ?? "";
    expect(description).toMatch(
      /Permanently and irreversibly deletes ONE project/,
    );
    expect(description).toMatch(/no archive and no trash/);
    expect(description).toMatch(/tickets including all subtickets/);
    expect(description).toMatch(/wiki trash included/);
    expect(description).toMatch(/execution plans with their runs/);
    expect(description).toMatch(/Shared objects stay/);
    expect(description).toMatch(/LÖSCHEN or DELETE \(both words are valid/);
    expect(description).toMatch(/Never infer confirmation/);
    expect(description).toMatch(/CONFIRMATION_REQUIRED/);
    expect(description).toMatch(/personal administrator eligibility/);
    expect(description).toMatch(/FORBIDDEN/);
    expect(description).toMatch(/atomic/);
    expect(description).toMatch(
      /same operationId for another project returns CONFLICT/,
    );
    expect(description).toMatch(/NOT_FOUND/);
    expect(description).toMatch(/source=mcp/);
  });
});

describe("project deletion over tools/list", () => {
  it("lists both tools for a personal administrator", async () => {
    offer(ADMIN, "admin.projects.deletionScope", "admin.projects.delete");
    const response = await (await initialized()).request("tools/list");
    expect(response).toMatchObject({
      result: {
        tools: [
          { name: "read_admin_project_deletion_scope" },
          { name: "delete_admin_project" },
        ],
      },
    });
  });

  it("lists neither tool when Pages does not offer them to the account", async () => {
    offer(PERSON, "projects.resolve", "projects.setName");
    const response = await (await initialized()).request("tools/list");
    expect(response).toMatchObject({
      result: {
        tools: [{ name: "resolve_project" }, { name: "set_project_name" }],
      },
    });
  });
});

describe("project deletion over tools/call", () => {
  it("forwards the confirmed deletion to the Pages operation and returns its result", async () => {
    offer(ADMIN, "admin.projects.delete");
    const result = {
      id: "project-1",
      targetType: "project",
      changed: true,
      affectedUserIds: ["u1"],
    };
    vi.mocked(readOperation).mockResolvedValue(result);
    const response = await (
      await initialized()
    ).request("tools/call", {
      name: "delete_admin_project",
      arguments: DELETION,
    });
    expect(readOperation).toHaveBeenCalledWith(
      CONFIGURATION,
      "admin.projects.delete",
      DELETION,
    );
    expect(response).toMatchObject({
      result: { content: [{ type: "text", text: JSON.stringify(result) }] },
    });
  });

  it("accepts DELETE as well as LÖSCHEN and passes either word unchanged", async () => {
    offer(ADMIN, "admin.projects.delete");
    vi.mocked(readOperation).mockResolvedValue({ changed: true });
    const current = await initialized();
    for (const confirmation of ["LÖSCHEN", "DELETE"]) {
      await current.request("tools/call", {
        name: "delete_admin_project",
        arguments: { ...DELETION, confirmation },
      });
      expect(readOperation).toHaveBeenLastCalledWith(
        CONFIGURATION,
        "admin.projects.delete",
        { ...DELETION, confirmation },
      );
    }
  });

  it("reads the scope through the read operation", async () => {
    offer(ADMIN, "admin.projects.deletionScope");
    vi.mocked(readOperation).mockResolvedValue({ counts: { tickets: 3 } });
    const response = await (
      await initialized()
    ).request("tools/call", {
      name: "read_admin_project_deletion_scope",
      arguments: { projectId: "project-1" },
    });
    expect(readOperation).toHaveBeenCalledWith(
      CONFIGURATION,
      "admin.projects.deletionScope",
      { projectId: "project-1" },
    );
    expect(textOf(response)).toContain("tickets");
  });
});

describe("project deletion failures over tools/call", () => {
  it.each([
    ["CONFIRMATION_REQUIRED" as const],
    ["FORBIDDEN" as const],
    ["CONFLICT" as const],
  ])("reports %s as a tool error without data", async (code) => {
    offer(ADMIN, "admin.projects.delete");
    vi.mocked(readOperation).mockRejectedValue(new PagesOperationFailure(code));
    const response = await (
      await initialized()
    ).request("tools/call", {
      name: "delete_admin_project",
      arguments: DELETION,
    });
    expect(response).toMatchObject({ result: { isError: true } });
    expect(textOf(response)).toBe(
      JSON.stringify([{ type: "text", text: JSON.stringify({ code }) }]),
    );
  });

  it("reports an unknown project like any missing object", async () => {
    offer(ADMIN, "admin.projects.delete");
    vi.mocked(readOperation).mockRejectedValue(
      new PagesOperationFailure("NOT_FOUND"),
    );
    const response = await (
      await initialized()
    ).request("tools/call", {
      name: "delete_admin_project",
      arguments: DELETION,
    });
    expect(textOf(response)).toContain("NOT_FOUND");
  });

  it("refuses the call when Pages does not offer the deletion to the account", async () => {
    offer(PERSON, "projects.resolve");
    const response = await (
      await initialized()
    ).request("tools/call", {
      name: "delete_admin_project",
      arguments: DELETION,
    });
    expect(response).toMatchObject({
      error: {
        code: ProtocolErrorCode.InternalError,
        message: "Pages authorization failed.",
      },
    });
    expect(readOperation).not.toHaveBeenCalled();
  });
});
