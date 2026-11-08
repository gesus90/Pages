import { randomUUID } from "node:crypto";

import { logCaughtError } from "@/backend/logging/Logger";

import type { Tool } from "@modelcontextprotocol/server";

/** MCP revisions the bridge answers in; the client's choice wins when Pages knows it. */
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** What the bridge answers over HTTP; `body` `null` sends no content. */
export interface PlanBridgeResponse {
  readonly status: number;
  readonly body: unknown;
  /** Set on `initialize`; later requests may echo it, the token alone binds them. */
  readonly sessionId?: string;
}

/** The text a tool call returns; a refused operation sets `isError`. */
export interface PlanBridgeToolResult {
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  readonly isError?: true;
}

/** The tools of the step a token belongs to and how one call runs. */
export interface PlanBridgeHandlers {
  /** The server name `initialize` reports; the plan bridge's by default. */
  readonly serverName?: string;
  readonly list: () => Promise<readonly Tool[]>;
  readonly call: (
    name: string,
    input: Readonly<Record<string, unknown>>,
  ) => Promise<PlanBridgeToolResult>;
}

/** A failure the client sees as a JSON-RPC error with a fixed message. */
export class PlanBridgeRpcError extends Error {
  public readonly code: number;

  public constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

type JsonRpcId = string | number;

function reply(id: JsonRpcId, result: unknown): PlanBridgeResponse {
  return { status: 200, body: { jsonrpc: "2.0", id, result } };
}

function failure(
  id: JsonRpcId | null,
  code: number,
  message: string,
): PlanBridgeResponse {
  return {
    status: id === null ? 400 : 200,
    body: { jsonrpc: "2.0", id, error: { code, message } },
  };
}

function readFields(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function readId(value: unknown): JsonRpcId | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function initialize(
  id: JsonRpcId,
  params: unknown,
  serverName: string,
): PlanBridgeResponse {
  const requested = readFields(params)?.protocolVersion;
  const version =
    PROTOCOL_VERSIONS.find((entry) => entry === requested) ??
    PROTOCOL_VERSIONS[0];
  return {
    ...reply(id, {
      protocolVersion: version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: serverName, version: "1.0.0" },
    }),
    sessionId: randomUUID(),
  };
}

async function callTool(
  id: JsonRpcId,
  params: unknown,
  handlers: PlanBridgeHandlers,
): Promise<PlanBridgeResponse> {
  const fields = readFields(params);
  if (fields === null || typeof fields.name !== "string")
    return failure(id, -32602, "Invalid params");
  const input = fields.arguments === undefined ? {} : fields.arguments;
  const parameters = readFields(input);
  if (parameters === null) return failure(id, -32602, "Invalid params");
  return reply(id, await handlers.call(fields.name, parameters));
}

async function answerRequest(
  id: JsonRpcId,
  method: string,
  message: Readonly<Record<string, unknown>>,
  handlers: PlanBridgeHandlers,
): Promise<PlanBridgeResponse> {
  switch (method) {
    case "initialize":
      return initialize(
        id,
        message.params,
        handlers.serverName ?? "pages-plan",
      );
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: await handlers.list() });
    case "tools/call":
      return callTool(id, message.params, handlers);
    default:
      return failure(id, -32601, "Method not found");
  }
}

/**
 * Answers one MCP message of the plan bridge (Streamable HTTP, JSON only).
 *
 * @param body - The request body; one JSON-RPC message.
 * @param handlers - The tools of the step the token belongs to.
 * @returns The HTTP answer; notifications and client responses get `202`.
 *
 * @remarks
 * The bridge offers no server stream and no batch. Errors carry only the
 * JSON-RPC code and a fixed message, never input or output of a tool.
 */
export async function answerPlanBridgeMessage(
  body: string,
  handlers: PlanBridgeHandlers,
): Promise<PlanBridgeResponse> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (caughtError: unknown) {
    logCaughtError("PlanBridgeProtocol", caughtError);

    return failure(null, -32700, "Parse error");
  }
  const message = readFields(parsed);
  if (message === null || message.jsonrpc !== "2.0")
    return failure(null, -32600, "Invalid Request");
  const id = readId(message.id);
  if (id === null || typeof message.method !== "string")
    return { status: 202, body: null };
  try {
    return await answerRequest(id, message.method, message, handlers);
  } catch (caughtError: unknown) {
    if (caughtError instanceof PlanBridgeRpcError)
      return failure(id, caughtError.code, caughtError.message);
    logCaughtError("PlanBridgeProtocol", caughtError);

    return failure(id, -32603, "Internal error");
  }
}
