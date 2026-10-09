import { sanitizeCheckDetail } from "@/backend/agents/AgentCheckDetail";
import { readAgentObject } from "@/backend/agents/AgentPayload";

import type { AgentCheckDetail } from "@/definition/AgentConnection";

/** Model listings need an actual array; a 200 with an empty object is not proof. */
export function readModelList(payload: unknown): AgentCheckDetail | null {
  const result = readAgentObject(payload);
  if (!Array.isArray(result.data)) return null;
  if (
    !result.data.every(
      (entry: unknown) => typeof readAgentObject(entry).id === "string",
    )
  )
    return null;
  return sanitizeCheckDetail({
    modelCount: result.data.length,
    hasMoreModels: result.has_more,
  });
}

/** Accepts a completed choice, including a response truncated at the output token cap. */
export function readChatCompletion(
  payload: unknown,
  model: string,
): AgentCheckDetail | null {
  const result = readAgentObject(payload);
  if (!Array.isArray(result.choices) || result.choices.length === 0)
    return null;
  const choice = readAgentObject(result.choices[0]);
  const message = readAgentObject(choice.message);
  if (
    message.role !== "assistant" ||
    (typeof message.content !== "string" && choice.finish_reason !== "length")
  )
    return null;
  const usage = readAgentObject(result.usage);
  return sanitizeCheckDetail({
    model,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
  });
}
