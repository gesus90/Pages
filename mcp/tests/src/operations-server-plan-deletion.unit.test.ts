import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
} from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOperationsServer } from "../../src/operations-server.ts";
import { PagesOperationError } from "../../src/tools/operation-failure.ts";

import type {
  ClientCapabilities,
  ElicitResult,
  JSONRPCMessage,
  JSONRPCRequest,
} from "@modelcontextprotocol/server";
import type { McpOperations } from "../../src/operations-server.ts";

const PARAMETERS = {
  operationId: "delete-plan-1",
  planId: "plan-1",
  expectedRevision: 7,
  confirmation: "model-supplied word",
};
const CONTROL = { control: { revision: 7, canDelete: true } };
const DELETED = { planId: "plan-1", revision: 7, deleted: true };
const CONFIRMATION_REQUIRED = {
  result: {
    isError: true,
    content: [{ type: "text", text: '{"code":"CONFIRMATION_REQUIRED"}' }],
  },
};
const OPERATIONS = {
  verify: vi.fn<McpOperations["verify"]>(),
  names: vi.fn<McpOperations["names"]>(),
  read: vi.fn<McpOperations["read"]>(),
};
const REFUSED_RESPONSES: readonly ElicitResult[] = [
  { action: "decline" },
  { action: "cancel" },
  { action: "accept", content: { confirmation: "yes" } },
];

interface Session {
  readonly request: (
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<JSONRPCMessage>;
  readonly respond: (result: ElicitResult) => Promise<void>;
  readonly elicitations: readonly JSONRPCRequest[];
  readonly close: () => Promise<void>;
}

let session: Session | undefined;

async function connect(
  options?: Parameters<typeof createOperationsServer>[1],
  capabilities: ClientCapabilities = { elicitation: { form: {} } },
): Promise<Session> {
  const [client, transport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<string | number, (message: JSONRPCMessage) => void>();
  const elicitations: JSONRPCRequest[] = [];
  let receiveElicitation: (message: JSONRPCRequest) => void = () => {
    throw new Error("Elicitation receiver is not initialized.");
  };
  const elicitation = new Promise<JSONRPCRequest>((resolve) => {
    receiveElicitation = resolve;
  });
  client.onmessage = (message) => {
    if (
      "method" in message &&
      message.method === "elicitation/create" &&
      "id" in message
    ) {
      elicitations.push(message);
      receiveElicitation(message);
      return;
    }
    if ("id" in message && message.id !== undefined)
      pending.get(message.id)?.(message);
  };
  await createOperationsServer(OPERATIONS, options).connect(transport);
  await client.start();
  let nextId = 0;
  const request = async (
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<JSONRPCMessage> => {
    nextId += 1;
    const id = nextId;
    const response = new Promise<JSONRPCMessage>((resolve) => {
      pending.set(id, resolve);
    });
    await client.send({ jsonrpc: "2.0", id, method, params });
    return response;
  };
  session = {
    request,
    respond: async (result) => {
      const { id } = await elicitation;
      await client.send({ jsonrpc: "2.0", id, result });
    },
    elicitations,
    close: async () => client.close(),
  };
  await session.request("initialize", {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities,
    clientInfo: { name: "unit-test", version: "1.0.0" },
  });
  return session;
}

beforeEach(() => {
  OPERATIONS.verify.mockReset().mockResolvedValue({ tools: ["plans.delete"] });
  OPERATIONS.names.mockReset();
  OPERATIONS.read.mockReset().mockResolvedValueOnce(CONTROL);
});

afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe("createOperationsServer plan deletion consent", () => {
  it.each([undefined, "client_form"] as const)(
    "obtains client consent with the %s option before dispatching deletion",
    async (planDeletionConsent) => {
      OPERATIONS.read.mockResolvedValueOnce(DELETED);
      const current = await connect({ planDeletionConsent });
      const response = current.request("tools/call", {
        name: "delete_plan",
        arguments: PARAMETERS,
      });
      await current.respond({
        action: "accept",
        content: { confirmation: "LÖSCHEN" },
      });

      expect(await response).toMatchObject({
        result: { content: [{ type: "text", text: JSON.stringify(DELETED) }] },
      });
      expect(OPERATIONS.verify).toHaveBeenCalledOnce();
      expect(OPERATIONS.read.mock.calls).toEqual([
        ["plans.control.read", { planId: "plan-1" }],
        ["plans.delete", { ...PARAMETERS, confirmation: "LÖSCHEN" }],
      ]);
      expect(current.elicitations).toHaveLength(1);
      expect(current.elicitations[0]).toMatchObject({
        method: "elicitation/create",
        params: { mode: "form" },
      });
      expect(current.elicitations[0]?.params?.message).toContain(
        "plan-1, revision 7?",
      );
    },
  );

  it.each(REFUSED_RESPONSES)(
    "does not delete after the form response %j",
    async (consent) => {
      const current = await connect();
      const response = current.request("tools/call", {
        name: "delete_plan",
        arguments: PARAMETERS,
      });
      await current.respond(consent);
      expect(await response).toMatchObject(CONFIRMATION_REQUIRED);
      expect(OPERATIONS.read.mock.calls).toEqual([
        ["plans.control.read", { planId: "plan-1" }],
      ]);
    },
  );

  it("refuses an unavailable consent surface despite a model confirmation", async () => {
    const current = await connect({ planDeletionConsent: "unavailable" });
    const response = await current.request("tools/call", {
      name: "delete_plan",
      arguments: PARAMETERS,
    });
    expect(response).toMatchObject(CONFIRMATION_REQUIRED);
    expect(OPERATIONS.read).not.toHaveBeenCalled();
    expect(current.elicitations).toHaveLength(0);
  });

  it("refuses a client without form capability despite a model confirmation", async () => {
    const current = await connect(undefined, {});
    const response = await current.request("tools/call", {
      name: "delete_plan",
      arguments: PARAMETERS,
    });
    expect(response).toMatchObject(CONFIRMATION_REQUIRED);
    expect(OPERATIONS.read.mock.calls).toEqual([
      ["plans.control.read", { planId: "plan-1" }],
    ]);
    expect(current.elicitations).toHaveLength(0);
  });
});

describe("createOperationsServer plan deletion validation", () => {
  it("refuses deletion when the operation is no longer offered", async () => {
    OPERATIONS.verify.mockResolvedValue({ tools: [] });
    const current = await connect();
    const response = await current.request("tools/call", {
      name: "delete_plan",
      arguments: PARAMETERS,
    });
    expect(response).toMatchObject({
      error: { message: "Pages authorization failed." },
    });
    expect(OPERATIONS.read).not.toHaveBeenCalled();
    expect(current.elicitations).toHaveLength(0);
  });

  it("returns a revision conflict before opening a form", async () => {
    OPERATIONS.read
      .mockReset()
      .mockResolvedValue({ control: { revision: 8, canDelete: true } });
    const current = await connect();
    const response = await current.request("tools/call", {
      name: "delete_plan",
      arguments: PARAMETERS,
    });
    expect(response).toMatchObject({
      result: {
        isError: true,
        content: [{ type: "text", text: '{"code":"CONFLICT"}' }],
      },
    });
    expect(OPERATIONS.read).toHaveBeenCalledOnce();
    expect(current.elicitations).toHaveLength(0);
  });

  it("returns a fresh backend refusal after consent", async () => {
    OPERATIONS.read.mockRejectedValueOnce(new PagesOperationError("FORBIDDEN"));
    const current = await connect();
    const response = current.request("tools/call", {
      name: "delete_plan",
      arguments: PARAMETERS,
    });
    await current.respond({
      action: "accept",
      content: { confirmation: "DELETE" },
    });
    expect(await response).toMatchObject({
      result: {
        isError: true,
        content: [{ type: "text", text: '{"code":"FORBIDDEN"}' }],
      },
    });
    expect(OPERATIONS.read).toHaveBeenLastCalledWith("plans.delete", {
      ...PARAMETERS,
      confirmation: "DELETE",
    });
  });

  it("lets the backend resolve a deleted target replay only after fresh consent", async () => {
    OPERATIONS.read
      .mockReset()
      .mockRejectedValueOnce(new PagesOperationError("NOT_FOUND"))
      .mockResolvedValueOnce(DELETED);
    const current = await connect();
    const response = current.request("tools/call", {
      name: "delete_plan",
      arguments: PARAMETERS,
    });
    await current.respond({
      action: "accept",
      content: { confirmation: "DELETE" },
    });
    expect(await response).toMatchObject({
      result: { content: [{ type: "text", text: JSON.stringify(DELETED) }] },
    });
    expect(OPERATIONS.read).toHaveBeenLastCalledWith("plans.delete", {
      ...PARAMETERS,
      confirmation: "DELETE",
    });
  });
});
