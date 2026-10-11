import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentError } from "@/backend/error/AgentErrors";

import { readCliTextResponse } from "./CliTextResponse";

import type { CliProviderId } from "@/definition/AgentConnection";

/** Extracts only the final answer; tool events, stdout diagnostics and partial results stay private. */
export function readCliPlanResponse(
  provider: CliProviderId,
  output: string,
): string {
  if (provider === "claude_code") return readCliTextResponse(provider, output);
  let text = "";
  let isComplete = false;
  try {
    for (const line of output.split("\n").filter((entry) => entry.trim())) {
      const parsed: unknown = JSON.parse(line);
      const event = readAgentObject(parsed);
      const item = readAgentObject(event.item);
      if (event.type === "turn.failed" || event.type === "error")
        throw new AgentError("plan_step_failed");
      if (
        event.type === "item.completed" &&
        item.type === "agent_message" &&
        typeof item.text === "string"
      )
        text = item.text;
      if (event.type === "turn.completed") isComplete = true;
    }
  } catch {
    throw new AgentError("plan_step_failed");
  }
  if (!isComplete || !text) throw new AgentError("plan_step_failed");
  return text;
}
