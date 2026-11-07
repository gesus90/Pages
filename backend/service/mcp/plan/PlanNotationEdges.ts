import { connectPlanBranching } from "@/definition/AgentPlanBranchingEdit";
import { isPlanResultNode } from "@/definition/AgentPlanGraph";
import {
  bindPlanParameter,
  connectPlanFlow,
  findPlanBindingTarget,
  replacePlanNode,
} from "@/definition/AgentPlanGroupEdit";
import {
  PLAN_LOOP_RUNS_BINDING,
  PLAN_LOOP_WHILE_BINDING,
} from "@/definition/AgentPlanLoop";

import {
  PLAN_NOTATION_CONDITION_INPUT,
  PLAN_NOTATION_EVENT_INPUT,
  PLAN_NOTATION_STACK_OUTPUTS,
  allPlanNotationNodes,
  planNotationInputs,
} from "./PlanNotationVocabulary";

import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanNode,
} from "@/definition/AgentPlan";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { PlanNotationAttributes } from "./PlanNotationAttributes";
import type { PlanNotationIssueCode } from "./PlanNotationIssue";

/** What the attributes of an edge statement ask for; every link of a chain shares it. */
export interface PlanNotationEdgeSpec {
  /** The input a data edge enters; absent for a flow or branch edge. */
  readonly input?: string;
  readonly branch?: "true" | "false";
  readonly output?: "content" | "count";
  readonly isPrevious: boolean;
}

/** The plan with the link added, or why the link cannot exist. */
export type PlanNotationEdgeResult =
  | { readonly plan: AgentPlanInput }
  | { readonly code: PlanNotationIssueCode; readonly nodeId: string };

/**
 * Reads the attributes of an edge statement: `in`, `branch`, `out` and `previous`.
 *
 * @param attributes - The attributes; any other key is `unknown_attribute`.
 */
export function readPlanNotationEdgeSpec(
  attributes: PlanNotationAttributes,
): PlanNotationEdgeSpec {
  const input = attributes.text("in");
  const branch = attributes.choice("branch", ["true", "false"]);
  const out = attributes.choice("out", ["entry", "count"]);
  const isPrevious = attributes.boolean("previous") ?? false;
  attributes.finish();
  return {
    ...(input === undefined ? {} : { input }),
    ...(branch === undefined ? {} : { branch }),
    ...(out === undefined ? {} : { output: PLAN_NOTATION_STACK_OUTPUTS[out] }),
    isPrevious,
  };
}

function refused(
  code: PlanNotationIssueCode,
  nodeId: string,
): PlanNotationEdgeResult {
  return { code, nodeId };
}

/** The binding a data edge from this node writes, as the editor's connection does. */
function sourceBinding(
  source: AgentPlanNode,
  spec: PlanNotationEdgeSpec,
): AgentPlanBinding | null {
  const isSource = ["parameter", "task", "variable"].includes(source.type);
  if (isSource && !spec.isPrevious && spec.output === undefined)
    return { kind: "source", nodeId: source.id };
  if (source.type === "stack" && !spec.isPrevious)
    return {
      kind: "stack",
      stackId: source.id,
      output: spec.output ?? "content",
    };
  if (!isPlanResultNode(source) || spec.output !== undefined) return null;
  return spec.isPrevious
    ? { kind: "previous", stepId: source.id }
    : { kind: "result", stepId: source.id };
}

/**
 * A value into an input of a loop: its count or the boolean of a while loop.
 *
 * @remarks
 * As in the editor, binding the count makes the count come from that value
 * and binding the boolean makes a while loop; explicit `mode` and
 * `runsSource` attributes of the loop still decide afterwards.
 */
function bindLoopInput(
  plan: AgentPlanInput,
  loop: AgentPlanLoop,
  input: { readonly name: string; readonly binding: AgentPlanBinding },
): PlanNotationEdgeResult {
  const { name, binding } = input;
  const isRuns = name === PLAN_LOOP_RUNS_BINDING;
  const fits = isRuns
    ? binding.kind === "source" ||
      (binding.kind === "stack" && binding.output === "count")
    : name === PLAN_LOOP_WHILE_BINDING && binding.kind === "source";
  if (!fits) return refused("unknown_port", loop.id);
  if (Object.hasOwn(loop.bindings, name))
    return refused("duplicate_field", loop.id);
  return {
    plan: replacePlanNode(plan, {
      ...loop,
      bindings: { ...loop.bindings, [name]: binding },
      ...(isRuns
        ? { runsSource: "parameter" as const }
        : { mode: "while" as const }),
    }),
  };
}

function connectData(
  plan: AgentPlanInput,
  link: { readonly source: AgentPlanNode; readonly target: AgentPlanNode },
  input: {
    readonly name: string;
    readonly spec: PlanNotationEdgeSpec;
    readonly agents: readonly AgentDefinitionChoice[];
  },
): PlanNotationEdgeResult {
  const { source, target } = link;
  const binding = sourceBinding(source, input.spec);
  if (binding === null) return refused("unknown_port", source.id);
  if (target.type === "loop")
    return bindLoopInput(plan, target, { name: input.name, binding });
  const holder = findPlanBindingTarget(plan, target.id);
  if (
    !holder ||
    holder.type === "group" ||
    holder.type === "loop" ||
    !planNotationInputs(target, input.agents).has(input.name)
  )
    return refused("unknown_port", target.id);
  if (Object.hasOwn(holder.bindings, input.name))
    return refused("duplicate_field", target.id);
  return { plan: bindPlanParameter(plan, target.id, input.name, binding) };
}

/** A condition or an event: the two inputs a wire, not a binding, enters. */
function connectWire(
  plan: AgentPlanInput,
  link: { readonly source: AgentPlanNode; readonly target: AgentPlanNode },
  kind: "condition" | "event",
): PlanNotationEdgeResult {
  const { source, target } = link;
  const isCondition = kind === "condition";
  if (isCondition ? source.type !== "agent" : !isPlanResultNode(source))
    return refused("unknown_port", source.id);
  if (target.type !== (isCondition ? "decision" : "agent"))
    return refused("unknown_port", target.id);
  return {
    plan: connectPlanBranching(plan, { kind, from: source.id, to: target.id }),
  };
}

/** A flow edge, or the branch of a decision. */
function connectOrder(
  plan: AgentPlanInput,
  link: { readonly source: AgentPlanNode; readonly target: AgentPlanNode },
  spec: PlanNotationEdgeSpec,
): PlanNotationEdgeResult {
  const { source, target } = link;
  if (spec.output !== undefined || spec.isPrevious)
    return refused("invalid_value", source.id);
  if (spec.branch !== undefined) {
    if (source.type !== "decision") return refused("unknown_port", source.id);
    return {
      plan: connectPlanBranching(plan, {
        kind: "branch",
        from: source.id,
        branch: spec.branch,
        to: target.id,
      }),
    };
  }
  // A decision has no flow output of its own; it leaves through a branch.
  if (source.type === "decision") return refused("unknown_port", source.id);
  const next = connectPlanFlow(plan, source.id, target.id);
  return typeof next === "string"
    ? refused("unknown_port", target.id)
    : { plan: next };
}

/**
 * Adds one link of an edge statement to the plan, as the editor connects two ports.
 *
 * @param plan - The plan so far, with every node in place.
 * @param link - The identifiers of both ends; both exist in the plan.
 * @param input - What the statement asks for, and the agents that declare the inputs of agent nodes.
 * @returns The plan with the edge or binding, or the finding that refuses it.
 *
 * @remarks
 * A plain link is a flow edge (`flow-out` to `flow-in`), `branch` leaves a
 * decision, `in=condition` and `in=event` are the two wires of branching,
 * and any other `in` binds a data input: a parameter or ticket as `source`,
 * an agent or script as `result` (`previous` with `previous=true`), a stack
 * as `stack` with its `out`. Flow edges between members land in their group
 * or loop, as in the editor.
 */
export function applyPlanNotationEdge(
  plan: AgentPlanInput,
  link: { readonly from: string; readonly to: string },
  input: {
    readonly spec: PlanNotationEdgeSpec;
    readonly agents: readonly AgentDefinitionChoice[];
  },
): PlanNotationEdgeResult {
  const nodes = allPlanNotationNodes(plan);
  const source = nodes.find((node) => node.id === link.from);
  const target = nodes.find((node) => node.id === link.to);
  if (!source) return refused("unknown_node", link.from);
  if (!target) return refused("unknown_node", link.to);
  const { spec } = input;
  const ends = { source, target };
  if (spec.input === undefined) return connectOrder(plan, ends, spec);
  if (spec.branch !== undefined) return refused("invalid_value", source.id);
  if (spec.input === PLAN_NOTATION_CONDITION_INPUT)
    return connectWire(plan, ends, "condition");
  if (spec.input === PLAN_NOTATION_EVENT_INPUT)
    return connectWire(plan, ends, "event");
  return connectData(plan, ends, {
    name: spec.input,
    spec,
    agents: input.agents,
  });
}
