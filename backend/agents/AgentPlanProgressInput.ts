import { AgentError } from "@/backend/error/AgentErrors";

import { readAgentObject } from "./AgentPayload";
import { readPlanText } from "./AgentPlanInput";

import type {
  AgentPlanProgress,
  AgentPlanProgressItem,
} from "@/definition/AgentPlanProgress";

function readProgressText(input: unknown): string {
  if (typeof input !== "string") throw new AgentError("plan_invalid");
  return input;
}

function readItem(input: unknown): AgentPlanProgressItem {
  const item = readAgentObject(input);
  const status = item.status;
  if (
    status !== "done" &&
    status !== "open" &&
    status !== "missing" &&
    status !== "unreported"
  )
    throw new AgentError("plan_invalid");
  return {
    id: readPlanText(item.id, 420),
    text: readProgressText(item.text),
    status,
  };
}

/** Validates the safe read-time checklist projection used by run polling. */
export function readPlanProgress(input: unknown): AgentPlanProgress {
  const progress = readAgentObject(input);
  if (
    (progress.source !== "live" && progress.source !== "historical") ||
    !Array.isArray(progress.todos)
  )
    throw new AgentError("plan_invalid");
  return {
    source: progress.source,
    observedAt: readPlanText(progress.observedAt),
    todos: progress.todos.map(readItem),
  };
}
