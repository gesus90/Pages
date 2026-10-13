import { AgentError } from "@/backend/error/AgentErrors";

import { readAgentObject } from "./AgentPayload";

function text(input: unknown): string {
  if (typeof input !== "string") throw new AgentError("plan_invalid");
  return input;
}

/** What the archive needs of a frozen plan step; it cannot start a provider or open a workspace. */
export interface ArchiveAgentStep {
  readonly agentId: string;
  readonly stepId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  /** The template rendering of the plan start, used only when no dispatched prompt was pinned. */
  readonly input: string;
}

/** Reads the steps of a persisted plan snapshot without trusting a JSON assertion. */
export function readArchiveSteps(input: unknown): readonly ArchiveAgentStep[] {
  const snapshot = readAgentObject(input);
  if (!Array.isArray(snapshot.steps)) throw new AgentError("plan_invalid");
  return snapshot.steps.map((entry: unknown) => {
    const stored = readAgentObject(entry);
    const step = readAgentObject(stored.step);
    const parameters = readAgentObject(
      readAgentObject(stored.prepared).parameters,
    );
    const { reasoningEffort } = stored;
    if (reasoningEffort !== null && typeof reasoningEffort !== "string")
      throw new AgentError("plan_invalid");
    return {
      agentId: text(step.agentId),
      stepId: text(step.id),
      model: text(stored.model),
      reasoningEffort,
      input: `${text(parameters.markdown)}\n\n${text(step.instruction)}`,
    };
  });
}
