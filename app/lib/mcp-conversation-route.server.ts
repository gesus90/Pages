import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
} from "@/app/lib/mcp-device-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { ConversationError } from "@/backend/error/ConversationError";
import { McpConversationApi } from "@/backend/service/mcp/conversation/McpConversationApi";

import type { ConversationErrorCode } from "@/definition/Conversation";
import type { User } from "@/definition/User";

/** Longest body of the conversation API in characters; a setting holds a few. */
const MAXIMUM_BODY_CHARACTERS = 2_000;

const STATUS_OF_CODE: Readonly<Record<ConversationErrorCode, number>> = {
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  too_large: 413,
  too_long: 400,
  unsupported_format: 415,
};

/** The methods the conversation API serves. */
type McpConversationMethod = "GET" | "PUT";

/** Everything a handler of the conversation API works with. */
export interface McpConversationCall {
  readonly api: McpConversationApi;
  readonly account: User;
  readonly request: Request;
}

/** The handlers of one conversation resource by method. */
export type McpConversationHandlers = Readonly<
  Partial<
    Record<
      McpConversationMethod,
      (call: McpConversationCall) => Promise<Response>
    >
  >
>;

/**
 * Answers a conversation request with JSON that no cache keeps.
 *
 * @param body - The answer of the interface.
 * @param status - The HTTP status.
 */
export function mcpConversationResponse(body: unknown, status = 200): Response {
  return mcpDeviceResponse(body, status);
}

/** Answers a failure with its code only, never a message of a service or a part of the request. */
function mcpConversationFailure(error: unknown): Response {
  if (error instanceof ConversationError)
    return mcpConversationResponse(
      { error: error.code },
      STATUS_OF_CODE[error.code],
    );
  return mcpDeviceFailure(error);
}

/**
 * Reads the JSON object of a request.
 *
 * @param request - The request with `Content-Type: application/json`.
 * @returns The object, its fields still untrusted; an empty body counts as `{}`.
 * @throws {ConversationError} `invalid` for another content type, a body
 * above the limit, malformed JSON or anything but an object.
 */
export async function readMcpConversationBody(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  const text = await request.text();
  if (text.trim() === "") return {};
  if (
    text.length > MAXIMUM_BODY_CHARACTERS ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    throw new ConversationError("invalid");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // The parser's message could quote the input.
    throw new ConversationError("invalid");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new ConversationError("invalid");
  return Object.fromEntries(Object.entries(body));
}

function handlerOf(
  handlers: McpConversationHandlers,
  method: string,
): McpConversationHandlers[McpConversationMethod] {
  if (method === "GET") return handlers.GET;
  return method === "PUT" ? handlers.PUT : undefined;
}

/**
 * Runs one request of the conversation API (PAGE-317).
 *
 * @param request - The request of the machine.
 * @param handlers - The methods the resource serves.
 * @returns The answer; a failure answers `{ "error": "<code>" }`.
 *
 * @remarks
 * Only the bearer token of a paired machine admits a request; browser
 * cookies play no part. The account's rights are those of the chat page.
 */
export async function runMcpConversationRoute(
  request: Request,
  handlers: McpConversationHandlers,
): Promise<Response> {
  const handler = handlerOf(handlers, request.method.toUpperCase());
  if (handler === undefined)
    return mcpDeviceMethodNotAllowed(Object.keys(handlers).join(", "));
  try {
    const services = await getApplicationServices();
    const api = new McpConversationApi(
      services.conversationReplySettingsService,
      { devices: services.mcpDeviceService, accounts: services.userService },
    );
    const account = await api.authenticate(
      request.headers.get("Authorization"),
    );
    return await handler({ api, account, request });
  } catch (error: unknown) {
    return mcpConversationFailure(error);
  }
}
