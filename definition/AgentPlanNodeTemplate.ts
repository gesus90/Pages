import { planGroupEdges } from "./AgentPlanGroup";

import type {
  AgentPlanBinding,
  AgentPlanNode,
  AgentPlanParameter,
  AgentPlanStep,
} from "./AgentPlan";
import type { AgentPlanGroup } from "./AgentPlanGroup";

/** The longest template name, as long as a group name. */
export const PLAN_TEMPLATE_NAME_LENGTH = 120;

const TEMPLATE_TYPES: readonly string[] = ["parameter", "agent", "group"];

/**
 * The node types a template can hold.
 *
 * @remarks
 * Saved templates store their type as plain text beside the content, so a
 * later node type, such as a script node, joins this union without a
 * migration of the templates saved before.
 */
export type AgentPlanTemplateType = "parameter" | "agent" | "group";

/** A node whose configuration can be saved as a template. */
export type AgentPlanTemplateNode =
  AgentPlanParameter | AgentPlanStep | AgentPlanGroup;

/**
 * A named node configuration of one person.
 *
 * @remarks
 * Only its owner lists and inserts it; it is never shared. The node holds no
 * link into the plan it came from: no outer connection, no run state.
 */
export interface AgentPlanNodeTemplate {
  readonly id: string;
  readonly name: string;
  readonly type: AgentPlanTemplateType;
  /** When it was saved, as stored: `YYYY-MM-DD HH:MM:SS` in UTC. */
  readonly createdAt: string;
  readonly node: AgentPlanTemplateNode;
}

/** Whether a stored type names a node type this version can insert. */
export function isPlanTemplateType(
  value: string,
): value is AgentPlanTemplateType {
  return TEMPLATE_TYPES.includes(value);
}

/** Whether a plan node can be saved as a template. */
export function isPlanTemplateNode(
  node: AgentPlanNode,
): node is AgentPlanTemplateNode {
  return (
    node.type === "parameter" || node.type === "agent" || node.type === "group"
  );
}

/**
 * The key that keeps the template names of one person unique.
 *
 * @remarks
 * Surrounding spaces and letter case do not count, so `Review` and
 * ` review ` name the same template.
 */
export function planTemplateNameKey(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}

/** Typed values stay; inside a group, results of other members stay as well. */
function internalBindings(
  bindings: Readonly<Record<string, AgentPlanBinding>>,
  members: ReadonlySet<string>,
): Readonly<Record<string, AgentPlanBinding>> {
  return Object.fromEntries(
    Object.entries(bindings).filter(
      ([, binding]) =>
        binding.kind === "literal" ||
        (binding.kind === "result" && members.has(binding.stepId)),
    ),
  );
}

/**
 * The configuration a template keeps of a node, without its links into the plan.
 *
 * @remarks
 * Connections to nodes outside — value sources, results of outer agents,
 * flow edges and legacy frame ports — stay behind, so an inserted copy never
 * uses another plan's data; its inputs then show what is left to connect.
 * A group keeps its members with their positions in the frame, their typed
 * values, the results they hand each other and the flow edges between them.
 * The node moves to the grid origin; insertion places it.
 */
export function planTemplateNode(
  node: AgentPlanTemplateNode,
): AgentPlanTemplateNode {
  if (node.type === "parameter") return { ...node, x: 0, y: 0 };
  if (node.type === "agent")
    return {
      ...node,
      x: 0,
      y: 0,
      bindings: internalBindings(node.bindings, new Set()),
    };
  const members = new Set(node.steps.map((step) => step.id));
  return {
    ...node,
    x: 0,
    y: 0,
    steps: node.steps.map((step) => ({
      ...step,
      bindings: internalBindings(step.bindings, members),
    })),
    edges: planGroupEdges(node).filter(
      (edge) => members.has(edge.from) && members.has(edge.to),
    ),
    parameters: [],
    bindings: {},
  };
}

/**
 * A new, independent copy of a template node.
 *
 * @param node - The template node, as {@link planTemplateNode} keeps it.
 * @param createId - Supplies one new identifier per call.
 * @returns The copy with new identifiers for the node and each member; the
 * edges and results between members follow their new identifiers, so the
 * copy refers neither to the template nor to an earlier copy.
 */
export function instantiatePlanTemplate(
  node: AgentPlanTemplateNode,
  createId: () => string,
): AgentPlanTemplateNode {
  const copy = structuredClone(node);
  if (copy.type !== "group") return { ...copy, id: createId() };
  const ids = new Map(copy.steps.map((step) => [step.id, createId()]));
  const mapped = (id: string): string => ids.get(id) ?? id;
  return {
    ...copy,
    id: createId(),
    steps: copy.steps.map((step) => ({
      ...step,
      id: mapped(step.id),
      bindings: Object.fromEntries(
        Object.entries(step.bindings).map(([name, binding]) => [
          name,
          binding.kind === "result"
            ? { kind: "result" as const, stepId: mapped(binding.stepId) }
            : binding,
        ]),
      ),
    })),
    edges: planGroupEdges(copy).map((edge) => ({
      ...edge,
      from: mapped(edge.from),
      to: mapped(edge.to),
    })),
  };
}
