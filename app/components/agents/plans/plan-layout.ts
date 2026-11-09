import {
  planGroupWidth,
  planNodeHeight,
  planStackHeight,
  PLAN_STACK_WIDTH,
} from "@/definition/AgentPlanNodeSize";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanStack } from "@/definition/AgentPlanStack";
import type { PlanFrame } from "@/definition/AgentPlanNodeSize";

// The sizes of the cards are shared with the automatic layout of the server (PAGE-250).
export {
  PLAN_DECISION_WIDTH,
  PLAN_FRAME_FOOTER,
  PLAN_FRAME_PADDING,
  PLAN_GROUP_COMPACT_HEIGHT,
  PLAN_GROUP_COMPACT_WIDTH,
  PLAN_LOOP_PORT_ROW,
  PLAN_LOOP_TITLE_HEIGHT,
  PLAN_NODE_WIDTH,
  PLAN_STACK_WIDTH,
  planGroupHeaderHeight,
  planGroupWidth,
  planMemberOrigin,
  planMemberPosition,
  planNodeHeight,
  planNodeWidth,
} from "@/definition/AgentPlanNodeSize";
export type { PlanFrame } from "@/definition/AgentPlanNodeSize";

// A pointer this close to a frame's edge does not take a node into the frame.
const FRAME_EDGE = 16;

/**
 * The stack a dropped ticket or value node lands in, decided by the pointer alone.
 *
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
 *
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
    const bottom = group.y + planNodeHeight(group, sources) - inset;
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
 *
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
  if (node.type === "start" || node.type === "end") return node.type;
  if (node.type === "decision") return node.name ?? node.type;
  if (node.type === "task") {
    const task = sources.tasks.find((entry) => entry.id === node.taskId);
    return task ? `${task.key}: ${task.title}` : node.taskId;
  }
  if (node.type !== "agent") return node.name;
  return (
    node.configuration?.name ??
    sources.agents.find((entry) => entry.id === node.agentId)?.name ??
    node.agentId
  );
}

const NODE_TINTS = {
  start: "border-plan-checkpoint/60 bg-plan-checkpoint-subtle",
  end: "border-plan-checkpoint/60 bg-plan-checkpoint-subtle",
  agent: "border-plan-agent/60 bg-plan-agent-subtle",
  script: "border-plan-script/60 bg-plan-script-subtle",
  git_closeout: "border-plan-script/60 bg-plan-script-subtle",
  group: "border-plan-group/60 bg-plan-group-subtle",
  loop: "border-plan-loop-edge/60 bg-plan-loop-subtle",
  decision: "border-plan-logic-edge/60 bg-plan-logic-subtle",
  stack: "border-plan-stack-edge/60 bg-plan-stack-subtle",
  task: "border-plan-ticket-edge bg-plan-ticket-subtle",
  variable: "border-plan-parameter/60 bg-plan-parameter-subtle",
  parameter: "border-plan-parameter/60 bg-plan-parameter-subtle",
  asset: "border-plan-asset-edge/60 bg-plan-asset-subtle",
};

const NODE_ACCENTS = {
  start: "text-plan-checkpoint",
  end: "text-plan-checkpoint",
  agent: "text-plan-agent",
  script: "text-plan-script",
  git_closeout: "text-plan-script",
  group: "text-plan-group",
  loop: "text-plan-loop",
  decision: "text-plan-logic",
  stack: "text-plan-stack",
  task: "text-plan-ticket",
  variable: "text-plan-parameter",
  parameter: "text-plan-parameter",
  asset: "text-plan-asset",
};

/**
 * A calm tint and border in the color of the node type.
 *
 * @remarks
 * The type colors stay apart from the run status colors in both theme
 * palettes; a card shows its status colors instead only while a run of the
 * same revision is shown.
 */
export function planNodeClass(type: AgentPlanNode["type"]): string {
  return NODE_TINTS[type];
}

/** The type color of a card's icon. */
export function planNodeAccent(type: AgentPlanNode["type"]): string {
  return NODE_ACCENTS[type];
}
