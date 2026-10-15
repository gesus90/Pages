import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentPlanStepSnapshot } from "./AgentPlanSnapshot";
import type { PreparedAgentParameters } from "./AgentParameterService";

/** Rejects changed resource identities or asset manifests while allowing live authorization checks. */
export function validatePlanParameterContext(
  step: AgentPlanStepSnapshot,
  live: PreparedAgentParameters,
): void {
  for (const input of step.prepared.parameters.assetInputs ?? []) {
    const current = live.parameters.tickets[input.parameter];
    if (
      !current ||
      JSON.stringify(current.assets) !== JSON.stringify(input.ticket.assets)
    )
      throw new AgentError("parameter_ticket_changed");
  }
  for (const previous of [
    step.prepared.workspace,
    ...step.prepared.references,
  ]) {
    const current = [live.workspace, ...live.references].find(
      (entry) => entry.id === previous.id,
    );
    if (
      !current ||
      current.projectId !== previous.projectId ||
      current.path !== previous.path ||
      current.directoryIdentity !== previous.directoryIdentity ||
      JSON.stringify(current.github) !== JSON.stringify(previous.github)
    )
      throw new AgentError("plan_context_changed");
  }
}
