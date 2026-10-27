import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentPlanStepSnapshot } from "./AgentPlanSnapshot";
import type { PreparedAgentParameters } from "./AgentParameterService";

/** Rejects changed resource identities or asset manifests while allowing live authorization checks. */
export function validatePlanParameterContext(
  step: AgentPlanStepSnapshot,
  live: PreparedAgentParameters,
): void {
  validateAssetInputs(step, live);
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

function validateAssetInputs(
  step: AgentPlanStepSnapshot,
  live: PreparedAgentParameters,
): void {
  for (const input of step.prepared.parameters.assetInputs ?? []) {
    const current =
      input.owner === "wiki"
        ? live.parameters.assetInputs.find(
            (entry) =>
              entry.owner === "wiki" && entry.parameter === input.parameter,
          )?.ticket
        : live.parameters.tickets[input.parameter];
    const liveInput = live.parameters.assetInputs.find(
      (entry) => entry.parameter === input.parameter,
    );
    if (
      input.originals &&
      JSON.stringify(input.originals) !== JSON.stringify(liveInput?.originals)
    )
      throw new AgentError("parameter_ticket_changed");
    if (
      !current ||
      JSON.stringify(current.assets) !== JSON.stringify(input.ticket.assets)
    )
      throw new AgentError("parameter_ticket_changed");
  }
}
