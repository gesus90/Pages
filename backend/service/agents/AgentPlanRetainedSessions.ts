import { turnFailureCode } from "./AgentPlanSessionRecords";

import type { NodeRun } from "./AgentPlanStepContext";
import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";

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
  // Only the newest start of an event agent is kept: it alone holds the current record.
  const nodes = (retained.get(key) ?? []).filter(
    (entry) => !node.receivesEvents || entry.step.step.id !== node.step.step.id,
  );
  const succeeded = node.run.steps
    .filter((entry) => entry.status === "succeeded")
    .map((entry) => entry.id);
  const completed = new Set([
    ...succeeded,
    ...nodes.map((entry) => entry.step.step.id),
    node.step.step.id,
  ]);
  const isGroupDone = group?.steps.every((step) => completed.has(step.id));
  // A group inside a loop that reuses sessions keeps its session until the loop ends.
  if (isGroupDone && node.loop?.policy !== "reuse") return false;
  retained.set(key, [...nodes, node]);
  return true;
}
