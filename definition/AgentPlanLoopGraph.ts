import { hasAgentParameterValue } from "./AgentParameters";
import { containerEdgeIssues } from "./AgentPlanGroupGraph";
import { planNodeParameters, planStepAdapter } from "./AgentPlanGroup";
import {
  PLAN_LOOP_NAME_LENGTH,
  PLAN_LOOP_RUNS_BINDING,
  isPlanLoopConditionActive,
  isPlanLoopRuns,
  parsePlanLoopPath,
  readPlanLoopRunsText,
} from "./AgentPlanLoop";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type { AgentPlanInput, AgentPlanNode } from "./AgentPlan";
import type { AgentPlanIssue } from "./AgentPlanGraph";
import type { AgentPlanLoop, AgentPlanLoopMember } from "./AgentPlanLoop";

/** The count a parameter node supplies, or `null` when it is no whole number 1 to 999. */
export function planLoopParameterRuns(
  node: AgentPlanNode | undefined,
): number | null {
  if (node?.type !== "parameter") return null;
  const { value } = node;
  if (value.type === "number")
    return isPlanLoopRuns(value.number) ? value.number : null;
  return value.type === "text" ? readPlanLoopRunsText(value.text.trim()) : null;
}

function nameIssues(loop: AgentPlanLoop): AgentPlanIssue[] {
  const name = loop.name.trim();
  const isValid =
    name.length > 0 &&
    name.length <= PLAN_LOOP_NAME_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(name);
  return isValid ? [] : [{ nodeId: loop.id, port: null, reason: "name" }];
}

function runsIssues(
  loop: AgentPlanLoop,
  plan: AgentPlanInput,
  isExecution: boolean,
): AgentPlanIssue[] {
  const issue: AgentPlanIssue = {
    nodeId: loop.id,
    port: PLAN_LOOP_RUNS_BINDING,
    reason: "loopRuns",
  };
  if (loop.runsSource === "value")
    return isPlanLoopRuns(loop.runs) ? [] : [issue];
  const binding = loop.bindings[PLAN_LOOP_RUNS_BINDING];
  if (binding?.kind !== "source") return [issue];
  const source = plan.nodes.find((node) => node.id === binding.nodeId);
  if (source?.type !== "parameter") return [issue];
  // The value is checked again, once, when the loop starts.
  return !isExecution || planLoopParameterRuns(source) !== null ? [] : [issue];
}

function conditionIssues(loop: AgentPlanLoop): AgentPlanIssue[] {
  const condition = loop.condition;
  if (!condition || !isPlanLoopConditionActive(loop)) return [];
  const source = loop.steps.find((step) => step.id === condition.sourceNodeId);
  const issues: AgentPlanIssue[] = [];
  if (!source)
    issues.push({ nodeId: loop.id, port: "source", reason: "loopCondition" });
  if (parsePlanLoopPath(condition.outputPath) === null)
    issues.push({ nodeId: loop.id, port: "path", reason: "loopCondition" });
  return issues;
}

function providerIssues(
  loop: AgentPlanLoop,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanIssue[] {
  if (loop.sessionPolicy !== "reuse") return [];
  return loop.steps.flatMap((step): AgentPlanIssue[] =>
    step.type === "agent" && planStepAdapter(step, agents) === null
      ? [{ nodeId: step.id, port: "provider/adapter", reason: "loopProvider" }]
      : [],
  );
}

/** A member input that takes its value from the previous iteration needs a start value for the first one. */
function previousIssues(
  member: AgentPlanLoopMember,
  loop: AgentPlanLoop,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanIssue[] {
  const parameters = planNodeParameters(member, agents);
  return Object.entries(member.bindings).flatMap(
    ([name, binding]): AgentPlanIssue[] => {
      if (binding.kind !== "previous") return [];
      const parameter = parameters.find((entry) => entry.name === name);
      const isMember = loop.steps.some((step) => step.id === binding.stepId);
      const hasStart =
        parameter?.type === "text" &&
        hasAgentParameterValue(parameter.defaultValue);
      return isMember && hasStart
        ? []
        : [{ nodeId: member.id, port: name, reason: "loopPrevious" }];
    },
  );
}

/** Bindings of a member may reach its own loop's members and outer value sources, never an outer result. */
function memberBindingIssues(loop: AgentPlanLoop): AgentPlanIssue[] {
  const members = new Set(loop.steps.map((step) => step.id));
  return loop.steps.flatMap((member) =>
    Object.entries(member.bindings).flatMap(
      ([name, binding]): AgentPlanIssue[] =>
        binding.kind === "result" && !members.has(binding.stepId)
          ? [{ nodeId: member.id, port: name, reason: "loopBoundary" }]
          : [],
    ),
  );
}

/** Outer nodes and outer edges may not reach into a loop except through its own entry and exit. */
function boundaryIssues(
  loop: AgentPlanLoop,
  plan: AgentPlanInput,
): AgentPlanIssue[] {
  const members = new Set(loop.steps.map((step) => step.id));
  const issues: AgentPlanIssue[] = [];
  for (const edge of plan.edges) {
    if (members.has(edge.from))
      issues.push({
        nodeId: edge.from,
        port: edge.fromPort,
        reason: "loopBoundary",
      });
    if (members.has(edge.to))
      issues.push({
        nodeId: edge.to,
        port: edge.toPort,
        reason: "loopBoundary",
      });
  }
  for (const node of plan.nodes) {
    if (node.type !== "agent" && node.type !== "script") continue;
    for (const [name, binding] of Object.entries(node.bindings))
      if (
        (binding.kind === "result" || binding.kind === "previous") &&
        members.has(binding.stepId)
      )
        issues.push({ nodeId: node.id, port: name, reason: "loopBoundary" });
  }
  return issues;
}

/** The input bindings of outer nodes that name a previous iteration: valid only inside a loop. */
function strayPreviousIssues(plan: AgentPlanInput): AgentPlanIssue[] {
  return plan.nodes.flatMap((node): AgentPlanIssue[] => {
    if (node.type === "group")
      return node.steps.flatMap((step) =>
        strayPrevious(step.id, step.bindings),
      );
    if (node.type !== "agent" && node.type !== "script") return [];
    return strayPrevious(node.id, node.bindings);
  });
}

function strayPrevious(
  nodeId: string,
  bindings: AgentPlanLoopMember["bindings"],
): AgentPlanIssue[] {
  return Object.entries(bindings).flatMap(
    ([name, binding]): AgentPlanIssue[] =>
      binding.kind === "previous"
        ? [{ nodeId, port: name, reason: "loopPrevious" }]
        : [],
  );
}

/**
 * Validates every loop of a plan: its members, internal flow, count, condition and boundaries.
 *
 * @param plan - The plan with its loops still in place.
 * @param agents - The agents the editor or the server knows.
 * @param isExecution - Whether the plan is about to run; an empty loop and a
 * count parameter outside 1 to 999 only refuse then.
 */
export function planLoopIssues(
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
  isExecution: boolean,
): readonly AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = strayPreviousIssues(plan);
  const ids = new Set(
    plan.nodes.flatMap((node) =>
      node.type === "group"
        ? [node.id, ...node.steps.map((step) => step.id)]
        : [node.id],
    ),
  );
  for (const loop of plan.nodes.filter((node) => node.type === "loop")) {
    if (isExecution && loop.steps.length === 0)
      issues.push({ nodeId: loop.id, port: null, reason: "loopSize" });
    for (const step of loop.steps) {
      if (ids.has(step.id))
        issues.push({ nodeId: step.id, port: null, reason: "duplicateNode" });
      ids.add(step.id);
    }
    issues.push(
      ...nameIssues(loop),
      ...runsIssues(loop, plan, isExecution),
      ...conditionIssues(loop),
      ...providerIssues(loop, agents),
      ...containerEdgeIssues(
        new Set(loop.steps.map((step) => step.id)),
        loop.edges,
      ),
      ...loop.steps.flatMap((member) => previousIssues(member, loop, agents)),
      ...memberBindingIssues(loop),
      ...boundaryIssues(loop, plan),
    );
  }
  return issues;
}
