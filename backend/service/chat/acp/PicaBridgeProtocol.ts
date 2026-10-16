import { randomUUID } from "node:crypto";

import type { RuntimeToolDescription } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { PicaToolOutcome } from "../PicaToolSchemas";

/** MCP revisions the bridge answers in; the client's choice wins when Pages knows it. */
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** What the bridge answers over HTTP; `body` `null` sends no content. */
export interface PicaBridgeResponse {
  readonly status: number;
  readonly body: unknown;
  /** Set on `initialize`; later requests may echo it, the token alone binds them. */
  readonly sessionId?: string;
}

/** The tools of the current job and how one call runs. */
export interface PicaBridgeHandlers {
  readonly catalog: readonly RuntimeToolDescription[];
  readonly call: (name: string, input: unknown) => Promise<PicaToolOutcome>;
}

type JsonRpcId = string | number;

function reply(id: JsonRpcId, result: unknown): PicaBridgeResponse {
  return { status: 200, body: { jsonrpc: "2.0", id, result } };
}

function failure(
  id: JsonRpcId | null,
  code: number,
  message: string,
): PicaBridgeResponse {
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

function initialize(id: JsonRpcId, params: unknown): PicaBridgeResponse {
  const requested = readFields(params)?.protocolVersion;
  const version =
    PROTOCOL_VERSIONS.find((entry) => entry === requested) ??
    PROTOCOL_VERSIONS[0];
  return {
    ...reply(id, {
      protocolVersion: version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "pages-pica", version: "1.0.0" },
    }),
    sessionId: randomUUID(),
  };
}

async function callTool(
  id: JsonRpcId,
  params: unknown,
  handlers: PicaBridgeHandlers,
): Promise<PicaBridgeResponse> {
  const fields = readFields(params);
  if (fields === null || typeof fields.name !== "string")
    return failure(id, -32602, "Invalid params");
  const outcome = await handlers.call(fields.name, fields.arguments ?? {});
  return reply(id, {
    content: [{ type: "text", text: JSON.stringify(outcome) }],
    isError: !outcome.ok,
  });
}

/**
 * Answers one MCP message of the Pica bridge (Streamable HTTP, JSON only).
 *
 * @param body - The request body; one JSON-RPC message.
 * @param handlers - The tools of the job the token belongs to.
 * @returns The HTTP answer; notifications and client responses get `202`.
 *
 * @remarks
 * The bridge offers no server stream and no batch. Errors carry only the
 * JSON-RPC code, never input or output of a tool.
 */
export async function answerPicaBridgeMessage(
  body: string,
  handlers: PicaBridgeHandlers,
): Promise<PicaBridgeResponse> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return failure(null, -32700, "Parse error");
  }
  const message = readFields(parsed);
  if (message === null || message.jsonrpc !== "2.0")
    return failure(null, -32600, "Invalid Request");
  const id = readId(message.id);
  if (id === null || typeof message.method !== "string")
    return { status: 202, body: null };
  switch (message.method) {
    case "initialize":
      return initialize(id, message.params);
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, {
        tools: handlers.catalog.map((tool) => ({
          name: tool.id,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    case "tools/call":
      return callTool(id, message.params, handlers);
    default:
      return failure(id, -32601, "Method not found");
  }
}
