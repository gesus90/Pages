import {
  planGroupWidth,
  planStackHeight,
  PLAN_STACK_WIDTH,
} from "@/definition/AgentPlanNodeSize";
import { planLayoutHeight } from "@/definition/AgentPlanAutoLayoutSize";

import { firstFilledText } from "./plan-jump/plan-jump-text";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanStack } from "@/definition/AgentPlanStack";
import type { PlanFrame } from "@/definition/AgentPlanNodeSize";

// The sizes of the cards are shared with the automatic layout of the server.
export {
  PLAN_DECISION_WIDTH,
  PLAN_FRAME_FOOTER,
  PLAN_FRAME_PADDING,
  PLAN_GROUP_COMPACT_HEIGHT,
  PLAN_GROUP_COMPACT_WIDTH,
  PLAN_FRAME_HEADER,
  PLAN_NODE_WIDTH,
  PLAN_STACK_WIDTH,
  planGroupHeaderHeight,
  planGroupWidth,
  planMemberOrigin,
  planMemberPosition,
} from "@/definition/AgentPlanNodeSize";
// Jump, signal and the endpoints with value ports are sized from their stored configuration.
export {
  planLayoutHeight as planNodeHeight,
  planLayoutWidth as planNodeWidth,
} from "@/definition/AgentPlanAutoLayoutSize";
export type { PlanFrame } from "@/definition/AgentPlanNodeSize";

// A pointer this close to a frame's edge does not take a node into the frame.
const FRAME_EDGE = 16;

/**
 * The stack a dropped ticket or value node lands in, decided by the pointer alone.
 * @returns The topmost stack card under the pointer, or `null`.
 */
export function planDropStack(
  plan: AgentPlanInput,
  point: AgentPlanPosition,
): AgentPlanStack | null {
  const stacks = plan.nodes.filter((node) => node.type === "stack");
  for (const stack of [...stacks].reverse())
    if (
      point.x >= stack.x &&
      point.x <= stack.x + PLAN_STACK_WIDTH &&
      point.y >= stack.y &&
      point.y <= stack.y + planStackHeight(stack)
    )
      return stack;
  return null;
}

/**
 * The frame a dropped node lands in, decided by the pointer alone.
 * @param plan - The plan with its frames.
 * @param point - The pointer in grid coordinates.
 * @param sources - The agents whose templates size the members.
 * @param memberOf - The frame the node belongs to now, if any.
 * @returns The topmost frame, a group or a loop, under the pointer. A node
 * joins a frame only with the pointer clearly inside it, and a member leaves
 * only once the pointer is outside, so a drop near an edge never flips the
 * membership.
 */
export function planDropGroup(
  plan: AgentPlanInput,
  point: AgentPlanPosition,
  sources: AgentPlanSources,
  memberOf: string | null,
): PlanFrame | null {
  const groups = plan.nodes.filter(
    (node) => node.type === "group" || node.type === "loop",
  );
  for (const group of [...groups].reverse()) {
    const inset = group.id === memberOf ? 0 : FRAME_EDGE;
    const right = group.x + planGroupWidth(group) - inset;
    const bottom = group.y + planLayoutHeight(group, sources) - inset;
    if (
      point.x >= group.x + inset &&
      point.x <= right &&
      point.y >= group.y + inset &&
      point.y <= bottom
    )
      return group;
  }
  return null;
}

/**
 * The name of an agent node: its own copy first, else its agent.
 * @returns An empty text when neither is known; callers name the missing
 * agent instead of showing its identifier.
 */
export function planAgentName(
  step: AgentPlanStep,
  sources: AgentPlanSources,
): string {
  return (
    step.configuration?.name ??
    sources.agents.find((entry) => entry.id === step.agentId)?.name ??
    ""
  );
}

/** Labels stay readable when a saved resource has become unavailable. */
export function planNodeLabel(
  node: AgentPlanNode,
  sources: AgentPlanSources,
): string {
  if (node.type === "start") return firstFilledText(node.name) || node.type;
  if (node.type === "end") return node.type;
  if (node.type === "jump") return jumpLabel(node);
  if (node.type === "signal")
    return firstFilledText(node.name) || node.signalName;
  if (node.type === "decision" || node.type === "swarm")
    return node.name ?? node.type;
  if (node.type === "task") {
    const task = sources.tasks.find((entry) => entry.id === node.taskId);
    return task ? `${task.key}: ${task.title}` : node.taskId;
  }
  if (node.type !== "agent") return node.name;
  return agentLabel(node, sources);
}

function agentLabel(node: AgentPlanStep, sources: AgentPlanSources): string {
  return (
    node.configuration?.name ??
    sources.agents.find((entry) => entry.id === node.agentId)?.name ??
    node.agentId
  );
}

function jumpLabel(node: Extract<AgentPlanNode, { type: "jump" }>): string {
  return (
    firstFilledText(
      node.name,
      node.direction === "out" ? node.target?.planName : undefined,
    ) || node.type
  );
}

// Each node type names its color token and the subtle surface of that token;
// the card mixes its edge, header and icon tile from both.
const NODE_TYPE_COLORS = {
  start:
    "[--plan-type:var(--color-plan-checkpoint)] [--plan-type-subtle:var(--color-plan-checkpoint-subtle)]",
  end: "[--plan-type:var(--color-plan-checkpoint)] [--plan-type-subtle:var(--color-plan-checkpoint-subtle)]",
  jump: "[--plan-type:var(--color-plan-checkpoint)] [--plan-type-subtle:var(--color-plan-checkpoint-subtle)]",
  signal:
    "[--plan-type:var(--color-plan-checkpoint)] [--plan-type-subtle:var(--color-plan-checkpoint-subtle)]",
  agent:
    "[--plan-type:var(--color-plan-agent)] [--plan-type-subtle:var(--color-plan-agent-subtle)]",
  script:
    "[--plan-type:var(--color-plan-script)] [--plan-type-subtle:var(--color-plan-script-subtle)]",
  git_closeout:
    "[--plan-type:var(--color-plan-script)] [--plan-type-subtle:var(--color-plan-script-subtle)]",
  group:
    "[--plan-type:var(--color-plan-group)] [--plan-type-subtle:var(--color-plan-group-subtle)]",
  loop: "[--plan-type:var(--color-plan-loop)] [--plan-type-subtle:var(--color-plan-loop-subtle)]",
  decision:
    "[--plan-type:var(--color-plan-logic)] [--plan-type-subtle:var(--color-plan-logic-subtle)]",
  stack:
    "[--plan-type:var(--color-plan-stack)] [--plan-type-subtle:var(--color-plan-stack-subtle)]",
  swarm:
    "[--plan-type:var(--color-plan-swarm)] [--plan-type-subtle:var(--color-plan-swarm-subtle)]",
  task: "[--plan-type:var(--color-plan-ticket)] [--plan-type-subtle:var(--color-plan-ticket-subtle)]",
  variable:
    "[--plan-type:var(--color-plan-parameter)] [--plan-type-subtle:var(--color-plan-parameter-subtle)]",
  parameter:
    "[--plan-type:var(--color-plan-parameter)] [--plan-type-subtle:var(--color-plan-parameter-subtle)]",
  asset:
    "[--plan-type:var(--color-plan-asset)] [--plan-type-subtle:var(--color-plan-asset-subtle)]",
};

const NODE_ACCENTS = {
  start: "text-plan-checkpoint",
  end: "text-plan-checkpoint",
  jump: "text-plan-checkpoint",
  signal: "text-plan-checkpoint",
  agent: "text-plan-agent",
  script: "text-plan-script",
  git_closeout: "text-plan-script",
  group: "text-plan-group",
  loop: "text-plan-loop",
  decision: "text-plan-logic",
  stack: "text-plan-stack",
  swarm: "text-plan-swarm",
  task: "text-plan-ticket",
  variable: "text-plan-parameter",
  parameter: "text-plan-parameter",
  asset: "text-plan-asset",
};

/**
 * The type color of a node as the CSS variables `--plan-type` and `--plan-type-subtle`.
 * @remarks
 * Both variables name theme tokens, so a card follows the light and the dark
 * palette. The run status never replaces them: the card stays in its type
 * color and only its status marker shows the status.
 */
export function planNodeClass(type: AgentPlanNode["type"]): string {
  return NODE_TYPE_COLORS[type];
}

/**
 * The parts of a card and a container drawn in the type color that {@link planNodeClass} sets.
 * @remarks
 * A card edge mixes 45 % of the type color into the border token, a container
 * edge 55 %; header lines take 30 % and the dashed member area of a container
 * 40 %. A container surface lays 60 % of the subtle type surface over the
 * surface token.
 */
export const PLAN_TYPE_COLORS = {
  cardEdge:
    "border-[color:color-mix(in_srgb,var(--plan-type)_45%,var(--color-border))]",
  frameEdge:
    "border-[color:color-mix(in_srgb,var(--plan-type)_55%,var(--color-border))]",
  frameSurface:
    "bg-[color:color-mix(in_srgb,var(--plan-type-subtle)_60%,var(--color-surface))]",
  header:
    "border-b border-b-[color:color-mix(in_srgb,var(--plan-type)_30%,transparent)] bg-[color:var(--plan-type-subtle)]",
  memberArea:
    "border-[1.5px] border-dashed border-[color:color-mix(in_srgb,var(--plan-type)_40%,transparent)]",
  tile: "bg-[color:var(--plan-type)] text-surface",
} as const;

/** The type color of a card's icon. */
export function planNodeAccent(type: AgentPlanNode["type"]): string {
  return NODE_ACCENTS[type];
}
