import { planEdgeKind } from "@/definition/AgentPlanBranching";
import {
  planBooleanParameterValue,
  planDecisionBinding,
  planDecisionMode,
} from "@/definition/AgentPlanDecision";

import type {
  AgentPlanDecision,
  AgentPlanDecisionInput,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";

/** Where a decision reads its value: the edges and results of its scope and the frozen plan. */
export interface PlanDecisionScope {
  /** The frozen plan, whose parameter nodes hold the snapshot values. */
  readonly plan: Pick<AgentPlanInput, "nodes">;
  /** The execution edges of the decision's scope: the outer plan or one iteration. */
  readonly edges: readonly AgentPlanEdge[];
  /** The results of the scope by node: the run or the current iteration. */
  readonly results: ReadonlyMap<string, AgentPlanStepResult>;
}

/** The changes of a decision that found no valid value: it fails and activates nothing. */
export function invalidDecisionInput(): Partial<AgentPlanStepResult> {
  return {
    status: "failed",
    error: "plan_decision_input_invalid",
    output: null,
    branch: undefined,
    condition: undefined,
    verdict: undefined,
  };
}

/** The agent whose boolean result the decision reads through an edge in its scope, if exactly one. */
function conditionAgent(
  decision: AgentPlanDecision,
  edges: readonly AgentPlanEdge[],
): string | null {
  const sources = edges.filter(
    (edge) => edge.to === decision.id && planEdgeKind(edge) === "condition",
  );
  return sources.length === 1 ? (sources[0]?.from ?? null) : null;
}

/** The boolean a boolean decision reads now, or `null` when it is absent. */
function currentValue(
  decision: AgentPlanDecision,
  scope: PlanDecisionScope,
): AgentPlanDecisionInput | null {
  const binding = planDecisionBinding(decision);
  if (binding) {
    if (binding.kind !== "source") return null;
    const value = planBooleanParameterValue(
      scope.plan.nodes.find((node) => node.id === binding.nodeId),
    );
    return value === null
      ? null
      : {
          sourceStepId: binding.nodeId,
          sourceActivation: 1,
          value,
          sourceKind: "parameter",
        };
  }
  const agentId = conditionAgent(decision, scope.edges);
  const source = agentId === null ? undefined : scope.results.get(agentId);
  if (
    agentId === null ||
    source?.status !== "succeeded" ||
    typeof source.passed !== "boolean"
  )
    return null;
  return {
    sourceStepId: agentId,
    sourceActivation: source.activation ?? 1,
    value: source.passed,
  };
}

/**
 * Decides a boolean decision once, without a model.
 *
 * @param decision - The frozen decision, in the `boolean` mode.
 * @param scope - Where it reads its value.
 * @returns The changes of its result: the activated branch and the value it read,
 * or `plan_decision_input_invalid` when the value is absent. A missing value is
 * never `false`.
 *
 * @remarks
 * Every activation reads anew: a parameter from the snapshot of the run, an
 * agent from its current start (PAGE-286). A decision never reads two values
 * in one activation, so no earlier value can stand in for the current one.
 */
export function decidePlanBoolean(
  decision: AgentPlanDecision,
  scope: PlanDecisionScope,
): Partial<AgentPlanStepResult> {
  if (planDecisionMode(decision) !== "boolean") return invalidDecisionInput();
  const condition = currentValue(decision, scope);
  if (condition === null) return invalidDecisionInput();
  return {
    status: "succeeded",
    branch: condition.value ? "true" : "false",
    condition,
    output: null,
    error: null,
  };
}
