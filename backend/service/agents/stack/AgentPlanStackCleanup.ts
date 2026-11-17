import { readAgentObject } from "@/backend/agents/AgentPayload";
import { planStacks } from "@/definition/AgentPlanStack";
import { processedPlanStackEntryIds } from "@/definition/AgentPlanStackOutcome";

import type { AgentPlan, AgentPlanRun } from "@/definition/AgentPlan";

/** A ticket entry of a stack that a successful run handed over and processed. */
export interface ProcessedTicketEntry {
  readonly stackId: string;
  readonly entryId: string;
  readonly taskId: string;
}

/**
 * The ticket entries a run handed over and processed, from the plan frozen for it.
 * @param plan - The plan as the run executed it.
 * @param run - The run in its final state.
 * @returns Each entry with the stack, the entry and the ticket it named in the frozen plan.
 * @remarks
 * Only ticket entries count: parameters and files stay in their stack. What
 * counts as processed follows the results of the run, not the handover alone.
 */
export function processedTicketEntries(
  plan: Pick<AgentPlan, "nodes" | "edges">,
  run: Pick<AgentPlanRun, "status" | "steps" | "loops" | "stacks">,
): readonly ProcessedTicketEntry[] {
  return planStacks(plan).flatMap((stack) => {
    const processed = processedPlanStackEntryIds(plan, run, stack.id);
    return stack.entries.flatMap((entry) =>
      entry.type === "task" && processed.has(entry.id)
        ? [{ stackId: stack.id, entryId: entry.id, taskId: entry.taskId }]
        : [],
    );
  });
}

/** Whether a stored entry of a stack is exactly one of the processed ticket entries. */
function isProcessedEntry(
  stackId: unknown,
  entry: unknown,
  processed: readonly ProcessedTicketEntry[],
): boolean {
  const stored = readAgentObject(entry);
  return (
    stored.type === "task" &&
    processed.some(
      (candidate) =>
        candidate.stackId === stackId &&
        candidate.entryId === stored.id &&
        candidate.taskId === stored.taskId,
    )
  );
}

/** The stack with the processed entries removed; every other entry keeps its place. */
function withoutProcessedEntries(
  node: unknown,
  processed: readonly ProcessedTicketEntry[],
): unknown {
  const stack = readAgentObject(node);
  if (stack.type !== "stack" || !Array.isArray(stack.entries)) return node;
  const entries: readonly unknown[] = stack.entries;
  const kept = entries.filter(
    (entry) => !isProcessedEntry(stack.id, entry, processed),
  );
  return kept.length === entries.length ? node : { ...stack, entries: kept };
}

/**
 * Removes processed ticket entries from the stacks of a stored plan.
 * @param planJson - The plan as it is stored now, not as the run saw it.
 * @param processed - The entries the run processed, from its frozen plan.
 * @returns The new stored plan, or `null` when nothing in it matches.
 * @remarks
 * An entry goes only when its stack, its entry ID and its ticket are all
 * unchanged. A ticket added after the run started, the same ticket under a new
 * entry ID, and an entry whose ticket was replaced under its old ID stay.
 * Nothing else of the plan is touched.
 */
export function withoutProcessedTicketEntries(
  planJson: string,
  processed: readonly ProcessedTicketEntry[],
): string | null {
  const parsed: unknown = JSON.parse(planJson);
  const stored = readAgentObject(parsed);
  const nodes: readonly unknown[] = Array.isArray(stored.nodes)
    ? stored.nodes
    : [];
  const cleaned = nodes.map((node) => withoutProcessedEntries(node, processed));
  if (cleaned.every((node, index) => node === nodes[index])) return null;
  return JSON.stringify({ ...stored, nodes: cleaned });
}
