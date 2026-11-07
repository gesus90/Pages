import { planGroupEdges } from "@/definition/AgentPlanGroup";

import { isSamePlanValue } from "./PlanNotationEquality";

import type {
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
} from "@/definition/AgentPlan";
import type { AgentPlanLoopContent } from "@/definition/AgentPlanLoop";

/** One changed field of a node. */
export interface PlanNotationFieldChange {
  readonly nodeId: string;
  readonly field: string;
}

/** What replacing the stored plan with a notation changes (PAGE-250, section 3). */
export interface PlanNotationPreview {
  readonly nodes: {
    readonly added: readonly string[];
    readonly changed: readonly string[];
    readonly removed: readonly string[];
  };
  readonly edges: {
    readonly added: readonly AgentPlanEdge[];
    readonly removed: readonly AgentPlanEdge[];
  };
  readonly fields: readonly PlanNotationFieldChange[];
}

/** Fields a notation never decides: places, members and the edges of a frame, compared on their own. */
const STRUCTURAL_FIELDS = new Set(["x", "y", "steps", "edges"]);

/** A node together with the frame that holds it, `null` at the top. */
interface PlacedNode {
  readonly node: AgentPlanNode;
  readonly container: string | null;
}

function placedNodes(
  members: readonly (AgentPlanNode | AgentPlanLoopContent)[],
  container: string | null,
): readonly PlacedNode[] {
  return members.flatMap((node): readonly PlacedNode[] =>
    node.type === "group" || node.type === "loop"
      ? [{ node, container }, ...placedNodes(node.steps, node.id)]
      : [{ node, container }],
  );
}

/** Every edge of the plan: the outer ones and those inside its groups and loops. */
function allEdges(plan: AgentPlanInput): readonly AgentPlanEdge[] {
  return [
    ...plan.edges,
    ...placedNodes(plan.nodes, null).flatMap(({ node }) => {
      if (node.type === "group") return planGroupEdges(node);
      return node.type === "loop" ? node.edges : [];
    }),
  ];
}

function edgeKey(edge: AgentPlanEdge): string {
  return JSON.stringify([edge.from, edge.fromPort, edge.to, edge.toPort]);
}

/** The edges of one list that the other lacks, each repetition counted. */
function missingEdges(
  edges: readonly AgentPlanEdge[],
  others: readonly AgentPlanEdge[],
): readonly AgentPlanEdge[] {
  const counts = new Map<string, number>();
  for (const edge of others)
    counts.set(edgeKey(edge), (counts.get(edgeKey(edge)) ?? 0) + 1);
  return edges.filter((edge) => {
    const left = counts.get(edgeKey(edge)) ?? 0;
    counts.set(edgeKey(edge), left - 1);
    return left <= 0;
  });
}

/** The fields of a node that differ, `container` when it moved into or out of a frame. */
function changedFields(
  before: PlacedNode,
  after: PlacedNode,
): readonly string[] {
  const keys = new Set([
    ...Object.keys(before.node),
    ...Object.keys(after.node),
  ]);
  const fields = [...keys].filter(
    (key) =>
      !STRUCTURAL_FIELDS.has(key) &&
      !isSamePlanValue(
        Reflect.get(before.node, key),
        Reflect.get(after.node, key),
      ),
  );
  return before.container === after.container
    ? fields
    : [...fields, "container"];
}

/**
 * Compares a plan read from a notation with the stored plan.
 *
 * @param stored - The plan as it is stored.
 * @param proposed - The plan the notation describes.
 * @returns The added, changed and removed nodes, the added and removed edges
 * of every level, and every changed field of a node.
 *
 * @remarks
 * Positions do not count: the notation has none, and a node that keeps its
 * identifier keeps its place. `fields` names node fields only, as the
 * interface and Pages MCP read it: `{ "nodeId", "field" }` with a node.
 */
export function previewPlanNotation(
  stored: AgentPlanInput,
  proposed: AgentPlanInput,
): PlanNotationPreview {
  const before = new Map(
    placedNodes(stored.nodes, null).map((entry) => [entry.node.id, entry]),
  );
  const after = new Map(
    placedNodes(proposed.nodes, null).map((entry) => [entry.node.id, entry]),
  );
  const fields: PlanNotationFieldChange[] = [];
  const changed: string[] = [];
  for (const [id, entry] of after) {
    const previous = before.get(id);
    if (!previous) continue;
    const nodeFields = changedFields(previous, entry);
    if (nodeFields.length > 0) changed.push(id);
    fields.push(...nodeFields.map((field) => ({ nodeId: id, field })));
  }
  return {
    nodes: {
      added: [...after.keys()].filter((id) => !before.has(id)),
      changed,
      removed: [...before.keys()].filter((id) => !after.has(id)),
    },
    edges: {
      added: missingEdges(allEdges(proposed), allEdges(stored)),
      removed: missingEdges(allEdges(stored), allEdges(proposed)),
    },
    fields,
  };
}
