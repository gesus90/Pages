import { readAgentObject } from "@/backend/agents/AgentPayload";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import { geminiThinkingLevel } from "./GoogleAiStudioProvider";

import type { ApiProviderId } from "@/definition/AgentConnection";
import type { TextExecutionInput } from "@/backend/agents/TextExecution";

/** Builds native text payloads from the same endpoint and effort contracts as A7. */
export function createTextProviderRequest(
  provider: ApiProviderId,
  input: TextExecutionInput,
): {
  readonly path: string;
  readonly body: Readonly<Record<string, unknown>>;
} {
  const { model, reasoningEffort } = input.agent;
  if (provider === "google_ai_studio")
    return {
      path: `/models/${encodeURIComponent(model.replace(/^models\//, ""))}:generateContent`,
      body: {
        contents: [{ parts: [{ text: input.prompt }] }],
        generationConfig: {
          maxOutputTokens: 16_384,
          ...(reasoningEffort === null
            ? {}
            : {
                thinkingConfig: {
                  thinkingLevel: geminiThinkingLevel(reasoningEffort),
                },
              }),
        },
      },
    };
  if (provider === "anthropic")
    return {
      path: "/messages",
      body: {
        model,
        max_tokens: 16_384,
        messages: [{ role: "user", content: input.prompt }],
        ...(reasoningEffort === null
          ? {}
          : { output_config: { effort: reasoningEffort } }),
      },
    };
  let reasoning: Readonly<Record<string, unknown>> = {};
  if (reasoningEffort !== null) {
    reasoning =
      provider === "openrouter"
        ? { reasoning: { effort: reasoningEffort } }
        : { reasoning_effort: reasoningEffort };
  }
  return {
    path: "/chat/completions",
    body: {
      model,
      messages: [{ role: "user", content: input.prompt }],
      stream: false,
      ...(provider === "openai"
        ? { max_completion_tokens: 16_384, store: false }
        : { max_tokens: 16_384 }),
      ...(provider === "openrouter"
        ? { provider: { allow_fallbacks: false } }
        : {}),
      ...reasoning,
    },
  };
}

function readTextParts(parts: unknown): string {
  if (!Array.isArray(parts)) throw new TextAssistantError("invalidOutput");
  return parts
    .map((part: unknown) => {
      const entry = readAgentObject(part);
      if (typeof entry.text !== "string" || entry.thought === true)
        throw new TextAssistantError("invalidOutput");
      return entry.text;
    })
    .join("");
}

/** Rejects truncation, tool requests and refusal outputs instead of applying partial text. */
export function readTextProviderResponse(
  provider: ApiProviderId,
  payload: unknown,
): string {
  const response = readAgentObject(payload);
  if (provider === "anthropic") {
    if (response.stop_reason !== "end_turn")
      throw new TextAssistantError("invalidOutput");
    return readTextParts(response.content);
  }
  if (provider === "google_ai_studio") {
    const candidate = readAgentObject(
      Array.isArray(response.candidates) ? response.candidates[0] : null,
    );
    if (candidate.finishReason !== "STOP")
      throw new TextAssistantError("invalidOutput");
    return readTextParts(readAgentObject(candidate.content).parts);
  }
  const choice = readAgentObject(
    Array.isArray(response.choices) ? response.choices[0] : null,
  );
  const message = readAgentObject(choice.message);
  if (
    choice.finish_reason !== "stop" ||
    typeof message.content !== "string" ||
    message.tool_calls !== undefined ||
    message.refusal
  )
    throw new TextAssistantError("invalidOutput");
  return message.content;
}
