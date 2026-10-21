import { readAgentObject } from "@/backend/agents/AgentPayload";
import { ChatError } from "@/backend/error/ChatErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import type { ChatErrorCode } from "@/backend/error/ChatErrors";
import type { AgentExecutionErrorCode } from "@/backend/error/AgentExecutionErrors";

/** Chat answers never land in a cache. */
export const CHAT_NO_STORE = { "Cache-Control": "no-store" } as const;

/** Largest JSON request of the chat; a message holds at most 20,000 characters. */
const MAXIMUM_REQUEST_CHARACTERS = 100_000;

const STATUSES: Readonly<
  Partial<Record<ChatErrorCode | AgentExecutionErrorCode, number>>
> = {
  disabled: 409,
  accessDenied: 403,
  sessionMissing: 404,
  attachmentMissing: 404,
  fileTooLarge: 413,
  requestBusy: 409,
  messageAlreadySent: 409,
  timeout: 504,
  providerFailed: 502,
  instructionsUnavailable: 503,
  apiModeRequired: 400,
};

/**
 * Accepts only the expected method from the own origin.
 *
 * @throws {ChatError} `invalidInput` for another method, `accessDenied` for a foreign origin.
 */
export function requireChatRequest(request: Request, method: string): void {
  if (request.method !== method) throw new ChatError("invalidInput");
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== new URL(request.url).origin)
    throw new ChatError("accessDenied");
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
