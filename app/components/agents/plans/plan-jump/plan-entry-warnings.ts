import { expandPlanGroups } from "@/definition/AgentPlanGroup";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { isPlanJumpIn } from "@/definition/AgentPlanJump";
import { expandPlanLoops } from "@/definition/AgentPlanLoop";
import { executablePlan, planStartIssues } from "@/definition/AgentPlanStart";
import { planWarnings } from "@/definition/AgentPlanWarnings";

import { planJumpTargetIssues } from "./plan-jump-model";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";

/** The ids of every node of a plan, those inside groups and loops included. */
function allNodeIds(plan: AgentPlanInput): ReadonlySet<string> {
  return new Set([
    ...plan.nodes.map((node) => node.id),
    ...expandPlanLoops(expandPlanGroups(plan)).nodes.map((node) => node.id),
  ]);
}

/** The same finding once, however many entries report it. */
function uniqueIssues(
  issues: readonly AgentPlanIssue[],
): readonly AgentPlanIssue[] {
  return [
    ...new Map(issues.map((issue) => [JSON.stringify(issue), issue])).values(),
  ];
}

/**
 * The findings the canvas marks on nodes and ports.
 * @param draft - The plan as it is edited.
 * @param sources - What the plan can use: the agents, and the plans a Jump may call.
 * @remarks
 * A run begins at a start, or at the receiving Jump a call names. The plan
 * check of the start alone would call everything behind a receiving Jump
 * unreachable, so the part of the plan behind each released entry is checked
 * as the run of that entry, and its nodes are no longer reported as
 * unreachable. The stored target of every calling Jump is compared with the
 * plans the person may call now.
 */
export function planCanvasIssues(
  draft: AgentPlanInput,
  sources: AgentPlanSources,
): readonly AgentPlanIssue[] {
  const entries = draft.nodes
    .filter(isPlanJumpIn)
    .filter((node) => node.isEnabled);
  const reached = new Set<string>();
  const found: AgentPlanIssue[] = [];
  for (const entry of entries) {
    const active = executablePlan(draft, entry.id);
    for (const id of allNodeIds(active)) reached.add(id);
    found.push(
      ...planStartIssues(draft, entry.id),
      ...planExecutionIssues(active, sources.agents).filter(
        (issue) => issue.nodeId !== null,
      ),
    );
  }
  const kept = planWarnings(draft, sources.agents).filter(
    (issue) =>
      issue.reason !== "unreachable" ||
      issue.nodeId === null ||
      !reached.has(issue.nodeId),
  );
  return uniqueIssues([
    ...kept,
    ...found,
    ...planJumpTargetIssues(draft, sources),
  ]);
}
