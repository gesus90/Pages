import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentTicketAssetContent } from "@/definition/AgentTicketParameter";
import type { TextExecutionInput } from "./TextExecution";

/** Fails explicitly if a caller tries to forward references without a live reader. */
export async function readTicketAssetInput(
  input: Pick<TextExecutionInput, "ticketInputs" | "readTicketAssets">,
): Promise<readonly AgentTicketAssetContent[]> {
  if (!input.ticketInputs?.length) return [];
  if (!input.readTicketAssets)
    throw new AgentError("parameter_asset_transfer_unsupported");
  return input.readTicketAssets();
}

/** The same provenance label precedes every native image or complete text resource. */
export function ticketAssetLabel(asset: AgentTicketAssetContent): string {
  return JSON.stringify({
    parameter: asset.parameter,
    ticketId: asset.ticketId,
    ticketKey: asset.ticketKey,
    asset: asset.asset,
    fileName: asset.fileName,
  });
}
