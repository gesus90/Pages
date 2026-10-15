import { buildPlanContract } from "./AgentPlanContract";

import type {
  AgentPlanContract,
  AgentPlanContractItem,
} from "@/definition/AgentPlanSession";
import type { AgentPlanContractOptions } from "./AgentPlanContract";
import type { AgentPlanTicketChecklist } from "./AgentPlanTasks";

function sameRequirement(
  current: AgentPlanContractItem,
  previous: AgentPlanContractItem,
): boolean {
  if (current.text !== previous.text) return false;
  if (current.ticket === null)
    return previous.ticket === null && current.id === previous.id;
  return (
    previous.ticket?.id === current.ticket.id &&
    previous.ticket.itemId === current.ticket.itemId
  );
}

function reconcileItems(
  current: readonly AgentPlanContractItem[],
  previous: readonly AgentPlanContractItem[],
  prefix: string,
): readonly AgentPlanContractItem[] {
  let nextId = previous.length;
  return current.map((item) => {
    const original = previous.find((entry) => sameRequirement(item, entry));
    return { ...item, id: original?.id ?? `${prefix}${++nextId}` };
  });
}

/**
 * Refreshes ticket requirements while keeping report IDs tied to unchanged work.
 *
 * @param instruction - The unchanged instruction sent to the runner.
 * @param previous - The contract sent at the start of the turn.
 * @param tickets - Current, authorized ticket checklists.
 * @param options - The existing read-only restriction; the saved report scope is preserved.
 * @returns The current lists; added or edited requirements receive unused report IDs.
 */
export function refreshPlanContract(
  instruction: string,
  previous: AgentPlanContract,
  tickets: readonly AgentPlanTicketChecklist[],
  options: Pick<AgentPlanContractOptions, "isReadOnly">,
): AgentPlanContract {
  const current = buildPlanContract(instruction, tickets, {
    ...options,
    completion: previous.completion,
  });
  return {
    ...current,
    todos: reconcileItems(current.todos, previous.todos, "T"),
    criteria: reconcileItems(current.criteria, previous.criteria, "K"),
  };
}
