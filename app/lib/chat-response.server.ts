import { readAgentObject } from "@/backend/agents/AgentPayload";
import { ChatError } from "@/backend/error/ChatErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import type { ChatErrorCode } from "@/backend/error/ChatErrors";
import type { TextAssistantErrorCode } from "@/backend/error/TextAssistantErrors";

/** Chat answers never land in a cache. */
export const CHAT_NO_STORE = { "Cache-Control": "no-store" } as const;

/** Largest JSON request of the chat; a message holds at most 20,000 characters. */
const MAXIMUM_REQUEST_CHARACTERS = 100_000;

const STATUSES: Readonly<
  Partial<Record<ChatErrorCode | TextAssistantErrorCode, number>>
> = {
  accessDenied: 403,
  sessionMissing: 404,
  attachmentMissing: 404,
  fileTooLarge: 413,
  requestBusy: 409,
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
  } catch {
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
  if (error instanceof ChatError || error instanceof TextAssistantError)
    return failureResponse(error.code, STATUSES[error.code] ?? 400);
  console.error(
    "[pages] A chat request failed.",
    error instanceof Error ? error.name : typeof error,
  );
  return failureResponse("general", 500);
}
