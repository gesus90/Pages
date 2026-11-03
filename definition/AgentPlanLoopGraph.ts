import { hasAgentParameterValue } from "./AgentParameters";
import { containerEdgeIssues } from "./AgentPlanGroupGraph";
import { planNodeParameters, planStepAdapter } from "./AgentPlanGroup";
import {
  PLAN_LOOP_NAME_LENGTH,
  PLAN_LOOP_RUNS_BINDING,
  PLAN_LOOP_WHILE_BINDING,
  isPlanLoopBoundRuns,
  isPlanLoopConditionActive,
  isPlanLoopRuns,
  parsePlanLoopPath,
  planLoopEdges,
  planLoopMembers,
  planLoopMode,
  readPlanLoopBoundRunsText,
} from "./AgentPlanLoop";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanNode,
} from "./AgentPlan";
import type { AgentPlanIssue } from "./AgentPlanGraph";
import type { AgentPlanLoop, AgentPlanLoopMember } from "./AgentPlanLoop";

/**
 * The count a parameter node supplies, or `null` when it is no whole number 0 to 999.
 *
 * @remarks
 * A bound 0 is valid: the loop runs no iteration and continues through its exit.
 */
export function planLoopParameterRuns(
  node: AgentPlanNode | undefined,
): number | null {
  if (node?.type !== "parameter") return null;
  const { value } = node;
  if (value.type === "number")
    return isPlanLoopBoundRuns(value.number) ? value.number : null;
  return value.type === "text"
    ? readPlanLoopBoundRunsText(value.text.trim())
    : null;
}

/**
 * The count a binding of a loop supplies: a parameter node or the count output of a stack.
 *
 * @returns The number 0 to 999, or `null` when the binding names no such source or its value is invalid.
 */
export function planLoopBoundRuns(
  binding: AgentPlanBinding | undefined,
  plan: Pick<AgentPlanInput, "nodes">,
): number | null {
  if (binding?.kind === "stack" && binding.output === "count") {
    const stack = plan.nodes.find((node) => node.id === binding.stackId);
    return stack?.type === "stack" && isPlanLoopBoundRuns(stack.entries.length)
      ? stack.entries.length
      : null;
  }
  if (binding?.kind !== "source") return null;
  return planLoopParameterRuns(
    plan.nodes.find((node) => node.id === binding.nodeId),
  );
}

/**
 * Reads the boolean a parameter node supplies to a while loop.
 *
 * @returns `true` or `false` for a JSON or text value of exactly `true` or
 * `false`; `null` for anything else, which is never read as `false`.
 */
export function planLoopParameterBoolean(
  node: AgentPlanNode | undefined,
): boolean | null {
  if (node?.type !== "parameter" || node.value.type !== "text") return null;
  const text = node.value.text.trim();
  if (text === "true") return true;
  return text === "false" ? false : null;
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
  if (planLoopMode(loop) === "while") return [];
  if (loop.runsSource === "value")
    return isPlanLoopRuns(loop.runs) ? [] : [issue];
  const binding = loop.bindings[PLAN_LOOP_RUNS_BINDING];
  if (binding?.kind === "stack") {
    const stack = plan.nodes.find((node) => node.id === binding.stackId);
    return stack?.type === "stack" && binding.output === "count" ? [] : [issue];
  }
  if (binding?.kind !== "source") return [issue];
  const source = plan.nodes.find((node) => node.id === binding.nodeId);
  if (source?.type !== "parameter") return [issue];
  // The value is checked again, once, when the loop starts.
  return !isExecution || planLoopParameterRuns(source) !== null ? [] : [issue];
}

/** A while loop reads a boolean parameter first and, optionally, a member's result later. */
function whileIssues(
  loop: AgentPlanLoop,
  plan: AgentPlanInput,
  isExecution: boolean,
): AgentPlanIssue[] {
  if (planLoopMode(loop) !== "while") return [];
  const issues: AgentPlanIssue[] = [];
  const binding = loop.bindings[PLAN_LOOP_WHILE_BINDING];
  const source =
    binding?.kind === "source"
      ? plan.nodes.find((node) => node.id === binding.nodeId)
      : undefined;
  if (
    source?.type !== "parameter" ||
    (isExecution && planLoopParameterBoolean(source) === null)
  )
    issues.push({
      nodeId: loop.id,
      port: PLAN_LOOP_WHILE_BINDING,
      reason: "loopWhile",
    });
  const later = loop.while;
  if (later && later.sourceNodeId !== "") {
    if (!planLoopMembers(loop).some((step) => step.id === later.sourceNodeId))
      issues.push({ nodeId: loop.id, port: "source", reason: "loopWhile" });
    if (parsePlanLoopPath(later.outputPath) === null)
      issues.push({ nodeId: loop.id, port: "path", reason: "loopWhile" });
  }
  return issues;
}

function conditionIssues(loop: AgentPlanLoop): AgentPlanIssue[] {
  const condition = loop.condition;
  if (!condition || !isPlanLoopConditionActive(loop)) return [];
  const source = planLoopMembers(loop).find(
    (step) => step.id === condition.sourceNodeId,
  );
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
  return planLoopMembers(loop).flatMap((step): AgentPlanIssue[] =>
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
      const isMember = planLoopMembers(loop).some(
        (step) => step.id === binding.stepId,
      );
      // A script input that is not required may stay empty in the first iteration.
      const hasStart =
        parameter?.type === "text" &&
        (hasAgentParameterValue(parameter.defaultValue) ||
          (member.type === "script" && !parameter.isRequired));
      return isMember && hasStart
        ? []
        : [{ nodeId: member.id, port: name, reason: "loopPrevious" }];
    },
  );
}

/** Bindings of a member may reach its own loop's members and outer value sources, never an outer result. */
function memberBindingIssues(loop: AgentPlanLoop): AgentPlanIssue[] {
  const members = new Set(planLoopMembers(loop).map((step) => step.id));
  return planLoopMembers(loop).flatMap((member) =>
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
  const members = new Set([
    ...loop.steps.map((step) => step.id),
    ...planLoopMembers(loop).map((step) => step.id),
  ]);
  const issues: AgentPlanIssue[] = [];
  for (const edge of plan.edges) {
    // A stack the loop triggers per iteration joins its members without becoming one.
    if (isStackEdge(edge, plan)) continue;
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

/** Whether a flow edge joins a stack, which may be triggered by and lead into a loop's members. */
function isStackEdge(
  edge: AgentPlanInput["edges"][number],
  plan: AgentPlanInput,
): boolean {
  const isStack = (id: string): boolean =>
    plan.nodes.some((node) => node.id === id && node.type === "stack");
  return (
    (edge.fromPort === "flow-out" && isStack(edge.from)) ||
    (edge.toPort === "flow-in" && isStack(edge.to))
  );
}

/** A loop holds agents, scripts and groups of agents; never another loop. */
function nestingIssues(loop: AgentPlanLoop): AgentPlanIssue[] {
  return loop.steps.flatMap((member): AgentPlanIssue[] => {
    const type: string = member.type;
    if (type === "loop")
      return [{ nodeId: member.id, port: null, reason: "loopNested" }];
    if (member.type !== "group") return [];
    return member.steps.some((step) => step.type !== "agent")
      ? [{ nodeId: member.id, port: null, reason: "loopNested" }]
      : [];
  });
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
    if (isExecution && planLoopMembers(loop).length === 0)
      issues.push({ nodeId: loop.id, port: null, reason: "loopSize" });
    const contained = loop.steps.flatMap(
      (step): readonly { readonly id: string }[] =>
        step.type === "group" ? [step, ...step.steps] : [step],
    );
    for (const step of contained) {
      if (ids.has(step.id))
        issues.push({ nodeId: step.id, port: null, reason: "duplicateNode" });
      ids.add(step.id);
    }
    issues.push(
      ...nameIssues(loop),
      ...nestingIssues(loop),
      ...runsIssues(loop, plan, isExecution),
      ...whileIssues(loop, plan, isExecution),
      ...conditionIssues(loop),
      ...providerIssues(loop, agents),
      ...containerEdgeIssues(
        new Set(planLoopMembers(loop).map((step) => step.id)),
        planLoopEdges(loop),
      ),
      ...planLoopMembers(loop).flatMap((member) =>
        previousIssues(member, loop, agents),
      ),
      ...memberBindingIssues(loop),
      ...boundaryIssues(loop, plan),
    );
  }
  return issues;
}
