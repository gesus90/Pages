import { AgentError } from "@/backend/error/AgentErrors";

import { readAgentObject } from "./AgentPayload";

import type { PageAgentRunRecord } from "@/definition/PageAgent";

function text(input: unknown): string {
  if (typeof input !== "string") throw new AgentError("plan_invalid");
  return input;
}

/** Narrows private durable records before materializing or returning their markdown. */
export function readPageAgentRecord(input: unknown): PageAgentRunRecord {
  const record = readAgentObject(input);
  const { status, reasoningEffort } = record;
  if (
    status !== "succeeded" &&
    status !== "failed" &&
    status !== "cancelled" &&
    status !== "timeout"
  )
    throw new AgentError("plan_invalid");
  if (reasoningEffort !== null && typeof reasoningEffort !== "string")
    throw new AgentError("plan_invalid");
  return {
    agentId: text(record.agentId),
    runId: text(record.runId),
    planRunId: text(record.planRunId),
    userId: text(record.userId),
    startedAt: text(record.startedAt),
    finishedAt: text(record.finishedAt),
    status,
    model: text(record.model),
    reasoningEffort,
    input: text(record.input),
    result: text(record.result),
  };
}

/** Minimal archive snapshot; it cannot be used to start a provider or access a workspace. */
export interface ArchiveAgentStep {
  readonly agentId: string;
  readonly stepId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly input: string;
}

/** Reads archive metadata for completed and interrupted plans without trusting a JSON assertion. */
export function readArchiveSteps(input: unknown): readonly ArchiveAgentStep[] {
  const snapshot = readAgentObject(input);
  if (!Array.isArray(snapshot.steps)) throw new AgentError("plan_invalid");
  return snapshot.steps.map((entry: unknown) => {
    const stored = readAgentObject(entry);
    const step = readAgentObject(stored.step);
    const prepared = readAgentObject(stored.prepared);
    const parameters = readAgentObject(prepared.parameters);
    if (
      stored.reasoningEffort !== null &&
      typeof stored.reasoningEffort !== "string"
    )
      throw new AgentError("plan_invalid");
    return {
      agentId: text(step.agentId),
      stepId: text(step.id),
      model: text(stored.model),
      reasoningEffort: stored.reasoningEffort,
      input: `${text(parameters.markdown)}\n\n${text(step.instruction)}`,
    };
  });
}
