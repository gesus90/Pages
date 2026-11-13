import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentPlanStepSnapshot } from "./AgentPlanSnapshot";
import type { PreparedAgentParameters } from "./AgentParameterService";
import type { AgentTicketInput } from "@/definition/AgentTicketParameter";

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
    const liveInput = live.parameters.assetInputs.find(
      (entry) => entry.parameter === input.parameter,
    );
    const current = currentAssetOwner(input, liveInput, live);
    if (input.snapshots !== undefined) {
      if (!current || current.id !== input.ticket.id)
        throw new AgentError("parameter_ticket_unavailable");
      continue;
    }
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

/** The current owner of the files: a wiki page or plan asset carries them itself, a ticket through its parameter. */
function currentAssetOwner(
  input: AgentTicketInput,
  liveInput: AgentTicketInput | undefined,
  live: PreparedAgentParameters,
): AgentTicketInput["ticket"] | undefined {
  if (input.owner !== "wiki" && input.owner !== "asset")
    return live.parameters.tickets[input.parameter];
  return liveInput?.owner === input.owner ? liveInput.ticket : undefined;
}
