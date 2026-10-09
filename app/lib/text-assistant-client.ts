import { readAgentObject } from "@/backend/agents/AgentPayload";

import type {
  AssistantConversation,
  AssistantMessage,
  TextAssistantResult,
} from "@/definition/TextAssistant";

/** A fixed code from the server, never a native diagnostic or response body. */
export class AssistantClientError extends Error {
  public constructor(code: string) {
    super(code);
    this.name = "AssistantClientError";
  }
}

/** Sends only an explicit assistant action and validates the success envelope. */
export async function assistantApi(
  input: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetch("/assistant-api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const parsed: unknown = await response.json();
  const result = readAgentObject(parsed);
  if (!response.ok || result.ok !== true)
    throw new AssistantClientError(
      typeof result.error === "string" ? result.error : "providerFailed",
    );
  return result;
}

/** Reads only a completed typed suggestion from the success envelope. */
export function readAssistantResult(input: unknown): TextAssistantResult {
  const result = readAgentObject(input);
  const context = readAgentObject(result.context);
  if (
    typeof result.requestId !== "string" ||
    typeof result.conversationId !== "string" ||
    typeof result.text !== "string" ||
    (result.change !== "answer" &&
      result.change !== "replace" &&
      result.change !== "insert") ||
    (context.kind !== "wiki" && context.kind !== "ticket") ||
    typeof context.id !== "string" ||
    typeof context.version !== "string"
  )
    throw new AssistantClientError("invalidOutput");
  return {
    requestId: result.requestId,
    conversationId: result.conversationId,
    text: result.text,
    change: result.change,
    context: { kind: context.kind, id: context.id, version: context.version },
  };
}

/** Reads the owner's conversation list, skipping no malformed entries silently. */
export function readAssistantConversations(
  input: unknown,
): AssistantConversation[] {
  if (!Array.isArray(input)) throw new AssistantClientError("invalidOutput");
  return input.map((entry: unknown) => {
    const conversation = readAgentObject(entry);
    if (
      typeof conversation.id !== "string" ||
      typeof conversation.lastMessageAt !== "string"
    )
      throw new AssistantClientError("invalidOutput");
    return { id: conversation.id, lastMessageAt: conversation.lastMessageAt };
  });
}

/** Messages remain plain Markdown with a narrow role/change contract. */
export function readAssistantMessages(input: unknown): AssistantMessage[] {
  if (!Array.isArray(input)) throw new AssistantClientError("invalidOutput");
  return input.map((entry: unknown) => {
    const message = readAgentObject(entry);
    if (
      typeof message.id !== "string" ||
      typeof message.text !== "string" ||
      typeof message.createdAt !== "string" ||
      (message.role !== "user" && message.role !== "assistant") ||
      (message.change !== "answer" &&
        message.change !== "replace" &&
        message.change !== "insert")
    )
      throw new AssistantClientError("invalidOutput");
    return {
      id: message.id,
      role: message.role,
      text: message.text,
      change: message.change,
      createdAt: message.createdAt,
    };
  });
}

/** Hides browser/network exceptions behind a translated generic failure. */
export function assistantErrorCode(error: unknown): string {
  return error instanceof AssistantClientError
    ? error.message
    : "providerFailed";
}
