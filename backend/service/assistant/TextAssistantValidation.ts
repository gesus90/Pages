import { readAgentObject } from "@/backend/agents/AgentPayload";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import type {
  TextAssistantContext,
  TextAssistantPreferences,
  TextAssistantRequest,
} from "@/definition/TextAssistant";

const IDENTIFIER = /^[a-zA-Z0-9-]{1,100}$/;
const LANGUAGE = /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8}){0,3}$/;
const CREDENTIALS =
  /\b(?:sk-[a-zA-Z0-9_-]{12,}|AIza[a-zA-Z0-9_-]{20,}|Bearer\s+\S+|(?:api[_ -]?key|access[_ -]?token|password|client[_ -]?secret)\s*[=:]\s*["']?[^\s"']{8,}|v1\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)/gi;

/** Masks recognizable pasted credentials before any message is persisted or returned. */
export function redactAssistantCredentials(text: string): string {
  return text.replace(CREDENTIALS, "[redacted]");
}

/** Rejects credential-shaped input instead of forwarding it to an external provider. */
export function requireCredentialFreeText(text: string): void {
  if (redactAssistantCredentials(text) !== text)
    throw new TextAssistantError("credentialsInText");
}

/** Validates an opaque identifier without interpreting it as a path or SQL fragment. */
export function readAssistantIdentifier(input: unknown): string {
  if (typeof input !== "string" || !IDENTIFIER.test(input))
    throw new TextAssistantError("invalidInput");
  return input;
}

/** The context envelope cannot contain a provider assignment or ticket field changes. */
export function readAssistantContext(input: unknown): TextAssistantContext {
  const context = readAgentObject(input);
  if (context.kind !== "wiki" && context.kind !== "ticket")
    throw new TextAssistantError("invalidInput");
  if (typeof context.version !== "string" || context.version.length > 65_536)
    throw new TextAssistantError("invalidInput");
  if (context.kind === "wiki" && !/^\d{1,16}$/.test(context.version))
    throw new TextAssistantError("invalidInput");
  return {
    kind: context.kind,
    id: readAssistantIdentifier(context.id),
    version: context.version,
  };
}

/** Only personal auto-apply and a language tag can be saved through this endpoint. */
export function readAssistantPreferences(
  input: unknown,
): TextAssistantPreferences {
  const preferences = readAgentObject(input);
  if (
    typeof preferences.autoApply !== "boolean" ||
    typeof preferences.targetLanguage !== "string" ||
    !LANGUAGE.test(preferences.targetLanguage)
  )
    throw new TextAssistantError("invalidInput");
  return {
    autoApply: preferences.autoApply,
    targetLanguage: preferences.targetLanguage,
  };
}

function readChoice<Choice extends string>(
  input: unknown,
  choices: readonly Choice[],
): Choice {
  const selected = choices.find((choice) => choice === input);
  if (selected === undefined) throw new TextAssistantError("invalidInput");
  return selected;
}

function readText(input: unknown, maximumLength: number): string {
  if (typeof input !== "string" || input.length > maximumLength)
    throw new TextAssistantError("invalidInput");
  requireCredentialFreeText(input);
  return input;
}

function validateAction(request: TextAssistantRequest): void {
  const { scope, source, action, change, instruction } = request;
  if (
    (scope === "none" && source !== "") ||
    (["explain", "summarize"].includes(action) && change !== "answer") ||
    (change === "replace" && scope === "none")
  )
    throw new TextAssistantError("invalidInput");
  if (scope === "selection" && !source.trim())
    throw new TextAssistantError("emptySelection");
  if (["generate", "instruct", "chat"].includes(action) && !instruction.trim())
    throw new TextAssistantError("invalidInput");
}

/** Narrows the entire external request before services use any part of it. */
export function readAssistantRequest(input: unknown): TextAssistantRequest {
  const envelope = readAgentObject(input);
  const request: TextAssistantRequest = {
    requestId: readAssistantIdentifier(envelope.requestId),
    conversationId:
      envelope.conversationId === null
        ? null
        : readAssistantIdentifier(envelope.conversationId),
    context: readAssistantContext(envelope.context),
    action: readChoice(envelope.action, [
      "translate",
      "proofread",
      "generate",
      "summarize",
      "explain",
      "instruct",
      "chat",
    ] as const),
    scope: readChoice(envelope.scope, [
      "none",
      "selection",
      "document",
    ] as const),
    change: readChoice(envelope.change, [
      "answer",
      "replace",
      "insert",
    ] as const),
    source: readText(envelope.source, 200_000),
    instruction: readText(envelope.instruction, 5_000),
    targetLanguage: readAssistantPreferences({
      autoApply: false,
      targetLanguage: envelope.targetLanguage,
    }).targetLanguage,
  };
  validateAction(request);
  return request;
}
