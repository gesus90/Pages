import { AgentError } from "@/backend/error/AgentErrors";

import { readAgentObject } from "./AgentPayload";
import { readPlanText } from "./AgentPlanInput";
import { readPlanWorkView } from "./AgentPlanWorkInput";

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
    status !== "active" &&
    status !== "open" &&
    status !== "missing" &&
    status !== "unreported"
  )
    throw new AgentError("plan_invalid");
  return {
    id: readPlanText(item.id, 420),
    text: readProgressText(item.text),
    status,
    ...(item.ticket === undefined
      ? {}
      : { ticket: readItemTicket(item.ticket) }),
  };
}

function readItemTicket(
  input: unknown,
): NonNullable<AgentPlanProgressItem["ticket"]> {
  const ticket = readAgentObject(input);
  return {
    id: readPlanText(ticket.id, 200),
    key: readPlanText(ticket.key, 200),
    itemId: readPlanText(ticket.itemId, 200),
  };
}

function readScope(input: unknown): NonNullable<AgentPlanProgress["scope"]> {
  const scope = readAgentObject(input);
  return {
    runId: readPlanText(scope.runId),
    stepId: readPlanText(scope.stepId),
    attemptId: scope.attemptId === null ? null : readPlanText(scope.attemptId),
  };
}

function readObservation(
  input: unknown,
): Pick<AgentPlanProgress, "availability" | "tickets"> {
  const progress = readAgentObject(input);
  const availability = progress.availability;
  if (
    availability !== undefined &&
    availability !== "observed" &&
    availability !== "unavailable"
  )
    throw new AgentError("plan_invalid");
  if (progress.tickets !== undefined && !Array.isArray(progress.tickets))
    throw new AgentError("plan_invalid");
  return {
    ...(availability === undefined ? {} : { availability }),
    ...(progress.tickets === undefined
      ? {}
      : {
          tickets: progress.tickets.map((entry: unknown) => {
            const ticket = readAgentObject(entry);
            return {
              id: readPlanText(ticket.id, 200),
              key: readPlanText(ticket.key, 200),
              contentHash: readPlanText(ticket.contentHash, 64),
            };
          }),
        }),
  };
}

/** Validates the safe read-time checklist projection used by run polling. */
export function readPlanProgress(input: unknown): AgentPlanProgress {
  const progress = readAgentObject(input);
  if (progress.work !== undefined && !Array.isArray(progress.work))
    throw new AgentError("plan_invalid");
  if (
    (progress.source !== "live" && progress.source !== "historical") ||
    !Array.isArray(progress.todos)
  )
    throw new AgentError("plan_invalid");
  return {
    source: progress.source,
    observedAt: readPlanText(progress.observedAt),
    todos: progress.todos.map(readItem),
    ...(Array.isArray(progress.work)
      ? { work: progress.work.map(readPlanWorkView) }
      : {}),
    ...readObservation(progress),
    ...(progress.scope === undefined
      ? {}
      : { scope: readScope(progress.scope) }),
  };
}
