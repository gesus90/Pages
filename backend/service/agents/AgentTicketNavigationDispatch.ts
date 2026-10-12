import {
  isAgentTicketLinkOperation,
  isAgentTicketNavigationRead,
} from "./AgentTicketNavigationValidation";

import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { AgentPlanningServices } from "./AgentPlanningServices";

/**
 * Runs a ticket search, hierarchy, link or assignment target operation.
 *
 * @param planning - The ticket services of the agent surface.
 * @param identity - The verified owner of the call.
 * @param operation - The requested operation name.
 * @param parameters - The raw operation parameters.
 * @returns The result envelope, or `null` when the name is none of these operations.
 * @throws {AgentOperationError} The business failure of the operation.
 */
export async function dispatchAgentTicketNavigation(
  planning: AgentPlanningServices,
  identity: AgentIdentity,
  operation: unknown,
  parameters: unknown,
): Promise<PagesAgentReadResponse | PagesAgentWriteResponse | null> {
  if (isAgentTicketLinkOperation(operation))
    return planning.links.apply(identity, operation, parameters);
  if (!isAgentTicketNavigationRead(operation)) return null;
  const reads = {
    "tickets.search": () => planning.search.search(identity, parameters),
    "tickets.tree.read": () => planning.tree.read(identity, parameters),
    "tickets.links.read": () => planning.links.read(identity, parameters),
    "assignment.targets.search": () =>
      planning.targets.search(identity, parameters),
  }[operation];
  return reads();
}
