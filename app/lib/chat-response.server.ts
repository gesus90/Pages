import { readAgentObject } from "@/backend/agents/AgentPayload";
import { ChatError } from "@/backend/error/ChatErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import { assessRequestOrigin, logOriginRefusal } from "./request-origin.server";

import type { ChatErrorCode } from "@/backend/error/ChatErrors";
import type { AgentExecutionErrorCode } from "@/backend/error/AgentExecutionErrors";
import type { RequestEntry } from "@/definition/RequestEntry";
import type { OriginRefusal } from "./request-origin.server";

/** Chat answers never land in a cache. */
export const CHAT_NO_STORE = { "Cache-Control": "no-store" } as const;

/** Largest JSON request of the chat; a message holds at most 20,000 characters. */
const MAXIMUM_REQUEST_CHARACTERS = 100_000;

const STATUSES: Readonly<
  Partial<Record<ChatErrorCode | AgentExecutionErrorCode, number>>
> = {
  disabled: 409,
  accessDenied: 403,
  originRejected: 403,
  sessionMissing: 404,
  attachmentMissing: 404,
  fileTooLarge: 413,
  requestBusy: 409,
  messageAlreadySent: 409,
  timeout: 504,
  providerFailed: 502,
  instructionsUnavailable: 503,
  nativeContextManaged: 400,
};

/** Routes of the chat that guard their origin, as the labels the log may carry. */
const GUARDED_ROUTES: ReadonlySet<string> = new Set([
  "/chat-api",
  "/chat-api/attachments",
]);

/** A refused origin, with the facts of the refusal for the log of {@link chatFailure}. */
class OriginRefusedError extends ChatError {
  public readonly refusal: OriginRefusal;
  public readonly route: string;

  public constructor(refusal: OriginRefusal, route: string) {
    super(refusal.code);
    this.refusal = refusal;
    this.route = route;
  }
}

/**
 * Accepts only the expected method from the own origin.
 *
 * @param request - The request as the entrance of the server built it.
 * @param method - The only method the route accepts.
 * @param entry - How the request arrived (`requestEntryContext`); without it
 * a refused origin cannot be told from a forwarding problem.
 * @throws {ChatError} `invalidInput` for another method. For an origin that is
 * not the public origin of the request: `originRejected` when a hop in front
 * of Pages may be the cause, `accessDenied` for an origin that is foreign
 * with no hop to blame.
 *
 * @remarks
 * The public origin is the one the request URL has: the `Host` header and the
 * protocol of the connection, `https` only when a trusted proxy forwarded it
 * from HTTPS. The browser's `Origin` is compared with it and never taken as
 * it. A refusal is written to the log by {@link chatFailure}, with the route,
 * its category and the normalized scheme, host and port of both origins.
 */
export function requireChatRequest(
  request: Request,
  method: string,
  entry: RequestEntry | null = null,
): void {
  if (request.method !== method) throw new ChatError("invalidInput");
  const refusal = assessRequestOrigin(request, entry);
  if (refusal === null) return;
  const { pathname } = new URL(request.url);
  throw new OriginRefusedError(
    refusal,
    GUARDED_ROUTES.has(pathname) ? pathname : "/chat-api/:other",
  );
}

/** Reads the bounded JSON body of a chat request. */
export async function readChatJson(
  request: Request,
): Promise<Record<string, unknown>> {
  const content = await request.text();
  if (content.length > MAXIMUM_REQUEST_CHARACTERS)
    throw new ChatError("invalidInput");
  try {
    const parsed: unknown = JSON.parse(content);
    return readAgentObject(parsed);
  } catch (caughtError: unknown) {
    logCaughtError("chat_response", caughtError);

    throw new ChatError("invalidInput");
  }
}

function failureResponse(code: string, status: number): Response {
  return Response.json(
    { ok: false, error: code },
    { status, headers: CHAT_NO_STORE },
  );
}

/**
 * Maps a failure to a stable code; messages, prompts and provider output never
 * reach the answer or the log.
 */
export function chatFailure(error: unknown): Response {
  if (error instanceof OriginRefusedError)
    logOriginRefusal(error.refusal, error.route);
  if (error instanceof ChatError || error instanceof AgentExecutionError)
    return failureResponse(error.code, STATUSES[error.code] ?? 400);
  logDiagnostic(
    "chat_response",
    "error",
    "[pages] A chat request failed.",
    error,
  );
  return failureResponse("general", 500);
}
