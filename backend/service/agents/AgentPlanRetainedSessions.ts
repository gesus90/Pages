import { turnFailureCode } from "./AgentPlanSessionRecords";

import type { NodeRun } from "./AgentPlanStepContext";
import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

/** Keeps the existing native session until its actual group, loop or event lifetime ends. */
export function retainPlanSession(
  node: NodeRun,
  turn: PlanSessionTurn,
  retained: Map<string, NodeRun[]>,
): boolean {
  // Retain until every actual member has succeeded, independent of chain or
  // membership order. A later frontier may return from outside the frame.
  if (turnFailureCode(turn) !== null || node.control.signal.aborted)
    return false;
  const group = node.snapshot.groups?.find(
    (entry) => entry.id === node.step.groupId,
  );
  // A loop keeps the session of each agent open until the loop itself ends or fails;
  // an agent that receives events keeps its own until the run ends.
  if (!group && node.loop?.policy !== "reuse" && !node.receivesEvents)
    return false;
  const key = `${node.run.id}/${node.sessionGroup ?? group?.id}`;
  const nodes = retainedSiblings(node, retained.get(key) ?? []);
  // A group inside a loop that reuses sessions keeps its session until the loop ends.
  if (node.loop?.policy !== "reuse" && isGroupDone(node, group, nodes))
    return false;
  retained.set(key, [...nodes, node]);
  return true;
}

/** Drops the older start of the same event agent; only the newest start holds the current record. */
function retainedSiblings(
  node: NodeRun,
  siblings: readonly NodeRun[],
): NodeRun[] {
  return siblings.filter(
    (entry) => !node.receivesEvents || entry.step.step.id !== node.step.step.id,
  );
}

function isGroupDone(
  node: NodeRun,
  group: AgentPlanGroup | undefined,
  nodes: readonly NodeRun[],
): boolean {
  // A loop may revisit its agents; retain the outer owner until the scheduler closes the run.
  if (!group || group.loops?.length) return false;
  const succeeded = node.run.steps
    .filter((entry) => entry.status === "succeeded")
    .map((entry) => entry.id);
  const completed = new Set([
    ...succeeded,
    ...nodes.map((entry) => entry.step.step.id),
    node.step.step.id,
  ]);
  return group.steps.every((step) => completed.has(step.id));
}
