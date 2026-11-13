import { planEdgeKind } from "@/definition/AgentPlanBranching";

import { eventPrompt } from "../branching/AgentPlanBranchSettle";
import { newPlanBranchingState } from "../branching/AgentPlanBranchState";
import {
  readPlanBranchState,
  serializePlanBranchState,
} from "../branching/AgentPlanBranchPersistence";

import type { AgentPlan, AgentPlanRun } from "@/definition/AgentPlan";

/** Keeps consumed events consumed and restores the news of an unfinished activation, including legacy runs. */
export function recoveredPlanBranching(
  run: AgentPlanRun,
  plan: AgentPlan,
  stored: unknown,
): unknown {
  const state = stored ? readPlanBranchState(stored) : newPlanBranchingState();
  for (const edge of plan.edges) {
    if (planEdgeKind(edge) !== "event") continue;
    const source = run.steps.find((step) => step.id === edge.from);
    if (!source || source.status !== "succeeded") continue;
    state.queued.add(`${source.id}#${source.activation ?? 1}>${edge.to}`);
  }
  for (const step of run.steps) {
    if (
      !step.trigger ||
      step.status === "succeeded" ||
      state.prompts.has(step.id)
    )
      continue;
    const sections = step.trigger.sources.map((trigger) => {
      const source = run.steps.find((entry) => entry.id === trigger.stepId);
      const output =
        source?.activation === trigger.activation
          ? source.output
          : source?.history?.find(
              (entry) => entry.activation === trigger.activation,
            )?.output;
      return `### New information from "${source?.name ?? trigger.stepId}"\n\n${eventPrompt(output ?? null)}`;
    });
    state.prompts.set(step.id, sections.join("\n\n"));
  }
  return serializePlanBranchState(state);
}
