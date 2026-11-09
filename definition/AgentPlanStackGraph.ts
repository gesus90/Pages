import { isAgentParameterName } from "./AgentParameters";
import { planLoopMembers } from "./AgentPlanLoop";
import { hasPlanPath } from "./AgentPlanPath";
import { planValueIssue } from "./AgentPlanValue";
import {
  PLAN_STACK_ENTRY_COUNT,
  PLAN_STACK_NAME_LENGTH,
  planStackScope,
  planStacks,
} from "./AgentPlanStack";

import type { AgentParameter } from "./AgentParameters";
import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanNode,
} from "./AgentPlan";
import type { AgentPlanIssue } from "./AgentPlanGraph";
import type {
  AgentPlanStack,
  AgentPlanStackEntry,
  AgentPlanStackOutput,
} from "./AgentPlanStack";

/** A node that reads inputs through bindings. */
export type PlanBindingNode = Extract<
  AgentPlanNode,
  { readonly bindings: Readonly<Record<string, AgentPlanBinding>> }
>;

/** Whether one entry can feed a parameter of the given type. */
function fitsEntry(
  entry: AgentPlanStackEntry,
  parameterType: AgentParameter["type"],
): boolean {
  if (entry.type === "task")
    return parameterType === "ticket" || parameterType === "text";
  return entry.value.type === parameterType;
}

/**
 * Whether a stack output can feed a parameter of the given type.
 *
 * @param stack - The stack, or `undefined` when the binding names no stack.
 * @param output - The output the binding reads.
 * @param parameterType - The type of the receiving parameter.
 *
 * @remarks
 * The count is a number and also fits a text input. The content fits when
 * every entry fits: a ticket entry feeds a ticket or a text input, a value
 * entry an input of its own type. An empty stack fits; it hands over nothing.
 */
export function fitsPlanStackOutput(
  stack: AgentPlanNode | undefined,
  output: AgentPlanStackOutput,
  parameterType: AgentParameter["type"],
): boolean {
  if (stack?.type !== "stack") return false;
  if (output === "count")
    return parameterType === "number" || parameterType === "text";
  return stack.entries.every((entry) => fitsEntry(entry, parameterType));
}

function nameIssues(stack: AgentPlanStack): AgentPlanIssue[] {
  const name = stack.name.trim();
  const isValid =
    name.length > 0 &&
    name.length <= PLAN_STACK_NAME_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(name);
  return isValid ? [] : [{ nodeId: stack.id, port: null, reason: "name" }];
}

function isEntryValid(entry: AgentPlanStackEntry): boolean {
  if (entry.type === "task") return entry.taskId.trim().length > 0;
  return isAgentParameterName(entry.name) && planValueIssue(entry) === null;
}

function entryIssues(stack: AgentPlanStack): AgentPlanIssue[] {
  const ids = new Set(stack.entries.map((entry) => entry.id));
  const isValid =
    stack.entries.length <= PLAN_STACK_ENTRY_COUNT &&
    ids.size === stack.entries.length &&
    stack.entries.every(isEntryValid);
  return isValid
    ? []
    : [{ nodeId: stack.id, port: "entries", reason: "stackEntries" }];
}

function scopeIssues(
  stack: AgentPlanStack,
  plan: AgentPlanInput,
): AgentPlanIssue[] {
  return planStackScope(plan, stack.id).kind === "mixed"
    ? [{ nodeId: stack.id, port: "flow-in", reason: "stackScope" }]
    : [];
}

/** Every node of a plan that reads inputs, the members of groups and loops included. */
export function planBindingNodes(
  plan: Pick<AgentPlanInput, "nodes">,
): readonly PlanBindingNode[] {
  return plan.nodes.flatMap((node): readonly PlanBindingNode[] => {
    if (
      node.type === "agent" ||
      node.type === "script" ||
      node.type === "git_closeout"
    )
      return [node];
    if (node.type === "group") return node.steps;
    if (node.type !== "loop") return [];
    return [node, ...planLoopMembers(node)];
  });
}

/** A node that reads the content of a stack runs after the stack's trigger. */
function orderIssues(
  plan: AgentPlanInput,
  expanded: AgentPlanInput,
): AgentPlanIssue[] {
  return planBindingNodes(plan).flatMap((node) => {
    if (node.type === "loop") return [];
    return Object.entries(node.bindings).flatMap(
      ([name, binding]): AgentPlanIssue[] =>
        binding.kind === "stack" &&
        binding.output === "content" &&
        !hasPlanPath(expanded.edges, binding.stackId, node.id)
          ? [{ nodeId: node.id, port: name, reason: "stackOrder" }]
          : [],
    );
  });
}

/** A remote runner has no access to the state of a stack in the run. */
function remoteIssues(plan: AgentPlanInput): AgentPlanIssue[] {
  return planBindingNodes(plan).flatMap((node) => {
    if (node.type === "loop" || node.type === "group") return [];
    const target =
      node.type === "git_closeout"
        ? plan.executionTarget
        : (node.executionTarget ?? plan.executionTarget);
    if (target?.kind !== "remote") return [];
    return Object.entries(node.bindings).flatMap(
      ([name, binding]): AgentPlanIssue[] =>
        binding.kind === "stack"
          ? [{ nodeId: node.id, port: name, reason: "stackRemote" }]
          : [],
    );
  });
}

/**
 * Validates every stack of a plan and every binding that reads one.
 *
 * @param plan - The plan with its groups and loops in place.
 * @param expanded - The same plan with groups and loops expanded, for the order.
 */
export function planStackIssues(
  plan: AgentPlanInput,
  expanded: AgentPlanInput,
): readonly AgentPlanIssue[] {
  const stacks = planStacks(plan);
  if (
    stacks.length === 0 &&
    !planBindingNodes(plan).some((node) =>
      Object.values(node.bindings).some((binding) => binding.kind === "stack"),
    )
  )
    return [];
  return [
    ...stacks.flatMap((stack) => [
      ...nameIssues(stack),
      ...entryIssues(stack),
      ...scopeIssues(stack, plan),
    ]),
    ...orderIssues(plan, expanded),
    ...remoteIssues(plan),
  ];
}
