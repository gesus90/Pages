import { readAgentObject } from "@/backend/agents/AgentPayload";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import type { CliProviderId } from "@/definition/AgentConnection";

function readClaudeText(output: string): string {
  const parsed: unknown = JSON.parse(output);
  const result = readAgentObject(parsed);
  if (
    result.is_error !== false ||
    result.subtype !== "success" ||
    typeof result.result !== "string"
  )
    throw new TextAssistantError("invalidOutput");
  return result.result;
}

function readCodexText(output: string): string {
  let isComplete = false;
  let text = "";
  for (const line of output.split("\n").filter((entry) => entry.trim())) {
    const parsed: unknown = JSON.parse(line);
    const event = readAgentObject(parsed);
    const item = readAgentObject(event.item);
    if (event.type === "turn.failed" || event.type === "error")
      throw new TextAssistantError("providerFailed");
    if (
      event.type === "item.completed" &&
      item.type === "agent_message" &&
      typeof item.text === "string"
    )
      text = item.text;
    if (
      (event.type === "item.started" || event.type === "item.completed") &&
      item.type !== "agent_message" &&
      item.type !== "reasoning"
    )
      throw new TextAssistantError("invalidOutput");
    if (event.type === "turn.completed") isComplete = true;
  }
  if (!isComplete || !text) throw new TextAssistantError("invalidOutput");
  return text;
}

/** Accepts only a completed assistant turn, never CLI diagnostics or tool events. */
export function readCliTextResponse(
  provider: CliProviderId,
  output: string,
): string {
  try {
    return provider === "claude_code"
      ? readClaudeText(output)
      : readCodexText(output);
  } catch (error: unknown) {
    if (error instanceof TextAssistantError) throw error;
    throw new TextAssistantError("invalidOutput");
  }
}
