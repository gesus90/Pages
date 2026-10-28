import type { AgentPlanInput, AgentPlanNode } from "./AgentPlan";
import type { AgentPlanIssue } from "./AgentPlanGraph";
import type { AgentPlanScript } from "./AgentPlanScript";

function isGate(node: AgentPlanNode | undefined): boolean {
  return node?.type === "script" && node.outputs[0]?.policy === "gate";
}

function acceptsReport(
  node: AgentPlanNode | undefined,
  sourceId: string,
): boolean {
  if (
    !node ||
    (node.type !== "agent" &&
      (node.type !== "script" || !node.outputs[0]?.policy))
  )
    return false;
  if (node.type !== "agent" && node.type !== "script") return false;
  return Object.values(node.bindings).some(
    (binding) => binding.kind === "result" && binding.stepId === sourceId,
  );
}

/** Every route to End must cross an explicit passing report gate. */
function reachesEndWithoutGate(
  plan: AgentPlanInput,
  sourceId: string,
): boolean {
  const pending = [sourceId];
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const node = plan.nodes.find((entry) => entry.id === id);
    if (isGate(node)) continue;
    if (node?.type === "end") return true;
    pending.push(
      ...plan.edges.filter((edge) => edge.from === id).map((edge) => edge.to),
    );
  }
  return false;
}

/** Requires explicit data handoff and a passing gate for the report-forwarding policy. */
export function scriptReportGraphIssues(
  plan: AgentPlanInput,
): readonly AgentPlanIssue[] {
  const reports = plan.nodes.filter(
    (node): node is AgentPlanScript =>
      node.type === "script" && node.outputs[0]?.policy === "report",
  );
  const issues: AgentPlanIssue[] = [];
  for (const report of reports) {
    const destinations = plan.edges.filter((edge) => edge.from === report.id);
    if (
      destinations.some(
        (edge) =>
          !acceptsReport(
            plan.nodes.find((node) => node.id === edge.to),
            report.id,
          ),
      )
    )
      issues.push({
        nodeId: report.id,
        port: "flow-out",
        reason: "scriptReportTarget",
      });
    if (reachesEndWithoutGate(plan, report.id))
      issues.push({
        nodeId: report.id,
        port: "flow-out",
        reason: "scriptReportGate",
      });
  }
  return issues;
}
