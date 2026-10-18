import { isAcpProvider } from "./AgentConfiguration";
import { planStepTemplate } from "./AgentPlanConfiguration";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type { AcpProviderId } from "./AgentConfiguration";
import type { AgentProviderId } from "./AgentConnection";
import type { AgentParameter } from "./AgentParameters";
import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanPosition,
  AgentPlanStep,
  AgentPlanInput,
  AgentPlanNode,
} from "./AgentPlan";

/** A stable boundary port; internal source bindings refer to its ID. */
export interface AgentPlanGroupParameter extends AgentParameter {
  readonly id: string;
}

/**
 * Why an agent node cannot join a group.
 *
 * @remarks
 * `notAcp` covers API agents and every runner whose plan nodes do not run as
 * an ACP session; `otherAdapter` is an ACP agent of another adapter class
 * than the group's; `missingAgent` is a node without a resolvable agent.
 */
export type AgentPlanGroupRefusal = "notAcp" | "otherAdapter" | "missingAgent";

/**
 * An ACP group: a subgraph of agents of one adapter class that share one session per run.
 *
 * @remarks
 * The group has no adapter class of its own; it takes the class of its first
 * member and is neutral while it has none, see {@link planGroupAdapter}. The
 * position of a member counts from the top left corner of the frame's member
 * area, so a member moves with its frame.
 */
export interface AgentPlanGroup extends AgentPlanPosition {
  readonly id: string;
  readonly type: "group";
  readonly name: string;
  /** Members in the order they joined; the first one decides the adapter class. */
  readonly steps: readonly AgentPlanStep[];
  /**
   * Flow edges between members, which alone decide the execution order.
   *
   * Absent only in groups saved before this field existed, whose member order
   * was their execution order; {@link planGroupEdges} reads them as that chain.
   */
  readonly edges?: readonly AgentPlanEdge[];
  readonly parameters: readonly AgentPlanGroupParameter[];
  readonly bindings: Readonly<Record<string, AgentPlanBinding>>;
}

/** The provider of an agent node: its pinned copy first, else the agent it names. */
export function planStepProvider(
  step: AgentPlanStep,
  agents: readonly AgentDefinitionChoice[],
): AgentProviderId | null {
  return (
    step.configuration?.provider ??
    agents.find((agent) => agent.id === step.agentId)?.provider ??
    null
  );
}

/**
 * The ACP adapter class of an agent node.
 *
 * @returns The technical adapter ID (`codex_cli`, `claude_code`, `opencode`) of a node
 * that runs as an ACP plan session, or `null` for API agents and the other
 * runners. The display name of an agent never decides it.
 */
export function planStepAdapter(
  step: AgentPlanStep,
  agents: readonly AgentDefinitionChoice[],
): AcpProviderId | null {
  const provider = planStepProvider(step, agents);
  return provider !== null && isAcpProvider(provider) ? provider : null;
}

/**
 * The adapter class of a group, taken from its first member.
 *
 * @returns `null` for a neutral group: one without members, whose class the
 * next ACP agent that joins decides.
 */
export function planGroupAdapter(
  group: AgentPlanGroup,
  agents: readonly AgentDefinitionChoice[],
): AcpProviderId | null {
  const first = group.steps.at(0);
  return first ? planStepAdapter(first, agents) : null;
}

/**
 * Tells why an agent node may not join a group, or `null` when it may.
 *
 * @param group - The group, possibly already holding the node.
 * @param step - The agent node that joins or stays.
 * @param agents - The agents the editor or the server knows.
 */
export function planGroupRefusal(
  group: AgentPlanGroup,
  step: AgentPlanStep,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanGroupRefusal | null {
  const provider = planStepProvider(step, agents);
  if (provider === null) return "missingAgent";
  if (!isAcpProvider(provider)) return "notAcp";
  // The first member decides the class, so only the later ones can differ from it.
  const adapter =
    group.steps.at(0)?.id === step.id ? null : planGroupAdapter(group, agents);
  return adapter !== null && adapter !== provider ? "otherAdapter" : null;
}

/**
 * Tells why a member of a group may not run on a provider, or `null` when it may.
 *
 * @param group - The group that holds the member.
 * @param stepId - The member whose model would change.
 * @param provider - The provider of the model it would run on.
 * @param agents - The agents the editor or the server knows.
 * @returns `notAcp` for a runner without ACP plan sessions and
 * `otherAdapter` when another member runs on a different ACP adapter; the
 * members of a group share one session, which never spans adapters.
 */
export function planMemberProviderRefusal(
  group: AgentPlanGroup,
  stepId: string,
  provider: AgentProviderId,
  agents: readonly AgentDefinitionChoice[],
): Extract<AgentPlanGroupRefusal, "notAcp" | "otherAdapter"> | null {
  if (!isAcpProvider(provider)) return "notAcp";
  const others = group.steps.filter((step) => step.id !== stepId);
  return others.some((step) => {
    const adapter = planStepAdapter(step, agents);
    return adapter !== null && adapter !== provider;
  })
    ? "otherAdapter"
    : null;
}

/** The flow edges between the members of a group; an older group reads as the chain of its member order. */
export function planGroupEdges(
  group: AgentPlanGroup,
): readonly AgentPlanEdge[] {
  if (group.edges) return group.edges;
  return group.steps.slice(1).map((step, index) => ({
    from: group.steps[index]?.id ?? step.id,
    to: step.id,
    fromPort: "flow-out",
    toPort: "flow-in",
  }));
}

/** Members without an internal predecessor: where the outer flow enters the group. */
export function planGroupEntries(
  group: AgentPlanGroup,
): readonly AgentPlanStep[] {
  const edges = planGroupEdges(group);
  return group.steps.filter(
    (step) => !edges.some((edge) => edge.to === step.id),
  );
}

/** Members without an internal successor: where the flow leaves the group. */
export function planGroupExits(
  group: AgentPlanGroup,
): readonly AgentPlanStep[] {
  const edges = planGroupEdges(group);
  return group.steps.filter(
    (step) => !edges.some((edge) => edge.from === step.id),
  );
}

/**
 * The members in execution order, following the internal flow edges.
 *
 * @returns `null` unless the edges join every member into one chain without
 * a branch, which is what a shared session can run one turn after another.
 */
export function planGroupOrder(
  group: AgentPlanGroup,
): readonly AgentPlanStep[] | null {
  const edges = planGroupEdges(group);
  const entries = planGroupEntries(group);
  const first = entries.at(0);
  if (entries.length !== 1 || !first) return null;
  const order: AgentPlanStep[] = [first];
  for (;;) {
    const current = order.at(-1);
    const next = edges.filter((edge) => edge.from === current?.id);
    if (next.length === 0) break;
    const step = group.steps.find((entry) => entry.id === next[0]?.to);
    if (next.length > 1 || !step || order.includes(step)) return null;
    order.push(step);
  }
  return order.length === group.steps.length ? order : null;
}

/** Visits each agent once, including the members of group nodes. */
export function allPlanSteps(plan: AgentPlanInput): readonly AgentPlanStep[] {
  return plan.nodes.flatMap((node) => {
    if (node.type === "agent") return [node];
    return node.type === "group" ? node.steps : [];
  });
}

/** Applies an agent edit without changing its group membership or the group's edges. */
export function mapPlanSteps<Plan extends AgentPlanInput>(
  plan: Plan,
  transform: (step: AgentPlanStep) => AgentPlanStep,
): Plan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) => {
      if (node.type === "agent") return transform(node);
      return node.type === "group"
        ? { ...node, steps: node.steps.map(transform) }
        : node;
    }),
  };
}

/**
 * Expands only scheduling and boundary bindings; the saved outer graph stays intact.
 *
 * @remarks
 * Members become plain agent nodes. An edge into the frame reaches the
 * entering members, an edge out of it starts at the leaving members, and the
 * internal edges stay as they are; no edge is derived from positions.
 */
export function expandPlanGroups<Plan extends AgentPlanInput>(
  plan: Plan,
): Plan {
  const groups = plan.nodes.filter((node) => node.type === "group");
  const nodes: AgentPlanNode[] = plan.nodes.flatMap((node) => {
    if (node.type !== "group") return [node];
    return [
      ...node.steps.map((step) => ({
        ...step,
        bindings: Object.fromEntries(
          Object.entries(step.bindings).map(([name, binding]) => {
            if (binding.kind !== "source") return [name, binding];
            const port = node.parameters.find(
              (entry) => entry.id === binding.nodeId,
            );
            return [
              name,
              port
                ? (node.bindings[port.name] ?? {
                    kind: "literal",
                    value: port.defaultValue,
                  })
                : binding,
            ];
          }),
        ),
      })),
    ];
  });
  // An edge at the frame reaches the members where the flow enters and leaves; an empty group keeps it.
  const ends = (id: string, side: "from" | "to"): readonly string[] => {
    const group = groups.find((entry) => entry.id === id);
    if (!group) return [id];
    const members =
      side === "from" ? planGroupExits(group) : planGroupEntries(group);
    return members.length > 0 ? members.map((step) => step.id) : [id];
  };
  const edges: AgentPlanEdge[] = plan.edges.flatMap((edge) =>
    ends(edge.from, "from").flatMap((from) =>
      ends(edge.to, "to").map((to) => ({ ...edge, from, to })),
    ),
  );
  for (const group of groups) edges.push(...planGroupEdges(group));
  return { ...plan, nodes, edges };
}

/** Lists the named data inputs shown at the node boundary. */
export function planNodeParameters(
  node: AgentPlanNode,
  agents: readonly AgentDefinitionChoice[],
): readonly AgentParameter[] {
  if (node.type === "group") return node.parameters;
  return node.type === "agent"
    ? (planStepTemplate(node, agents)?.parameters ?? [])
    : [];
}
