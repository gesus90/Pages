import { planLoopMembers } from "@/definition/AgentPlanLoop";
import { planLoopStages } from "@/definition/AgentPlanLoopStages";
import {
  planFlowSequence,
  planFlowStages,
} from "@/definition/AgentPlanSequence";
import { planLoopStacks } from "@/definition/AgentPlanStack";

import type { AgentPlanNode } from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

/** The kinds of nodes a run's flow consists of. */
export type AgentPlanStructureKind =
  | "start"
  | "end"
  | "agent"
  | "script"
  | "git_closeout"
  | "decision"
  | "stack"
  | "loop"
  | "swarm";

/**
 * A node of the plan revision a run executes, without anything it would run.
 *
 * @remarks
 * Only identifier, kind, number and display name leave the snapshot: no
 * instruction, parameter, path, model or session.
 */
export interface AgentPlanStructureNode {
  readonly id: string;
  readonly kind: AgentPlanStructureKind;
  /** Position in the flow, Start is number one; `null` inside a loop, which the flow numbers as one node. */
  readonly number: number | null;
  /** The name the plan gives the node; `null` for Start, End and a decision without one. */
  readonly name: string | null;
  /**
   * Whether the node is a step of its own for the progress of the run.
   *
   * @remarks
   * Agents, scripts, the Git closeout and loops of the outer flow are; Start,
   * End, decisions, stacks and the nodes inside a loop are not, so a loop is
   * counted once and its members never in addition.
   */
  readonly isStep: boolean;
  /** The nodes of one iteration grouped by their step; only for a loop. */
  readonly iteration?: readonly (readonly AgentPlanStructureNode[])[];
}

/** The nodes of a run's flow grouped by their step, Start first. */
export type AgentPlanRunStructure =
  readonly (readonly AgentPlanStructureNode[])[];

type StructureSnapshot = Pick<
  AgentPlanSnapshot,
  "plan" | "steps" | "remoteSteps"
>;

const STEP_KINDS: ReadonlySet<AgentPlanStructureKind> = new Set([
  "agent",
  "script",
  "git_closeout",
  "loop",
  "swarm",
]);

/** The structure kind of every node type; `null` for nodes that are no part of the flow. */
const STRUCTURE_KIND: Readonly<
  Record<AgentPlanNode["type"], AgentPlanStructureKind | null>
> = {
  start: "start",
  end: "end",
  agent: "agent",
  script: "script",
  git_closeout: "git_closeout",
  decision: "decision",
  stack: "stack",
  loop: "loop",
  swarm: "swarm",
  group: null,
  parameter: null,
  asset: null,
  task: null,
  variable: null,
};

/** A swarm shows its name, or none so the run view falls back to the type name. */
function swarmName(node: AgentPlanNode): string | null {
  return node.type === "swarm" ? (node.name ?? null) : null;
}

function structureKind(node: AgentPlanNode): AgentPlanStructureKind | null {
  return STRUCTURE_KIND[node.type];
}

function agentName(snapshot: StructureSnapshot, id: string): string | null {
  const local = snapshot.steps.find((step) => step.step.id === id);
  if (local) return local.name;
  const remote = snapshot.remoteSteps?.find((step) => step.step.id === id);
  return remote?.step.type === "agent"
    ? (remote.step.configuration?.name ?? null)
    : null;
}

function nodeName(
  snapshot: StructureSnapshot,
  node: AgentPlanNode,
): string | null {
  if (node.type === "agent") return agentName(snapshot, node.id);
  if (node.type === "decision") return node.name ?? null;
  return node.type === "script" ||
    node.type === "git_closeout" ||
    node.type === "stack" ||
    node.type === "loop"
    ? node.name
    : swarmName(node);
}

function iterationStages(
  snapshot: StructureSnapshot,
  loop: AgentPlanLoop,
): readonly (readonly AgentPlanStructureNode[])[] {
  const nodes = new Map<string, AgentPlanNode>([
    ...planLoopMembers(loop).map((member) => [member.id, member] as const),
    ...planLoopStacks(snapshot.plan, loop.id).map(
      (stack) => [stack.id, stack] as const,
    ),
  ]);
  return planLoopStages(snapshot.plan, loop)
    .map((ids) =>
      ids.flatMap((id) => {
        const node = nodes.get(id);
        const kind = node === undefined ? null : structureKind(node);
        if (node === undefined || kind === null) return [];
        return [
          {
            id,
            kind,
            number: null,
            name: nodeName(snapshot, node),
            isStep: false,
          },
        ];
      }),
    )
    .filter((stage) => stage.length > 0);
}

/**
 * Reads the flow structure of the plan revision a run executes.
 *
 * @param snapshot - The private snapshot of the run.
 * @returns The nodes grouped by their step along the flow edges, Start first
 * and End last, numbered as the plan page numbers them; a loop carries the
 * stages of one iteration. Nodes the flow does not number are left out.
 *
 * @remarks
 * The structure comes from the snapshot, never from the plan as it is saved
 * now, so a later edit of the plan never changes how a run is shown.
 */
export function planRunStructure(
  snapshot: StructureSnapshot,
): AgentPlanRunStructure {
  const { plan } = snapshot;
  const numbers = new Map(
    planFlowSequence(plan).order.map((id, index) => [id, index + 1]),
  );
  const nodes = new Map(plan.nodes.map((node) => [node.id, node]));
  return planFlowStages(plan)
    .map((ids) =>
      ids.flatMap((id): AgentPlanStructureNode[] => {
        const node = nodes.get(id);
        const kind = node === undefined ? null : structureKind(node);
        if (node === undefined || kind === null) return [];
        return [
          {
            id,
            kind,
            number: numbers.get(id) ?? null,
            name: nodeName(snapshot, node),
            isStep: STEP_KINDS.has(kind),
            ...(node.type === "loop"
              ? { iteration: iterationStages(snapshot, node) }
              : {}),
          },
        ];
      }),
    )
    .filter((stage) => stage.length > 0);
}
