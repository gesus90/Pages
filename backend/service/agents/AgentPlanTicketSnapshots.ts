import type { PreparedAgentParameters } from "./AgentParameterService";
import type { RemotePlanParameters } from "./AgentPlanRemoteParameters";

/** Keeps the first ticket-file manifests when a paused or failed run adopts prepared parameters. */
export function retainTicketSnapshots(
  previous: PreparedAgentParameters | undefined,
  next: PreparedAgentParameters,
): PreparedAgentParameters {
  if (!previous) return next;
  return {
    ...next,
    parameters: {
      ...next.parameters,
      assetInputs: next.parameters.assetInputs.map(
        (input) =>
          previous.parameters.assetInputs.find(
            (pinned) =>
              pinned.snapshots !== undefined &&
              pinned.parameter === input.parameter &&
              pinned.ticket.id === input.ticket.id &&
              pinned.owner === input.owner,
          ) ?? input,
      ),
    },
  };
}

/** Remote attempts receive the same first ticket copies as local attempts, including an empty manifest. */
export function retainRemoteTicketSnapshots(
  previous: RemotePlanParameters | undefined,
  next: RemotePlanParameters | undefined,
): RemotePlanParameters | undefined {
  if (!previous || !next) return next;
  const retained = new Set(
    Object.keys(next.tickets).filter(
      (id) => previous.tickets[id] !== undefined,
    ),
  );
  return {
    ...next,
    tickets: Object.fromEntries(
      Object.entries(next.tickets).map(([id, ticket]) => [
        id,
        retained.has(id)
          ? { ...ticket, assets: previous.tickets[id].assets }
          : ticket,
      ]),
    ),
    assets: [
      ...next.assets.filter(
        (asset) =>
          asset.owner.type !== "ticket" || !retained.has(asset.owner.id),
      ),
      ...previous.assets.filter(
        (asset) =>
          asset.owner.type === "ticket" && retained.has(asset.owner.id),
      ),
    ],
  };
}
