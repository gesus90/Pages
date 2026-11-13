import { randomUUID } from "node:crypto";

import { AgentOperationError } from "@/backend/error/AgentOperationError";

import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanStep,
  AgentPlanDecision,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

/** Remaps the graph's identities together, including decisions, stacks and nested group members. */
export class AgentPlanCloneGraph {
  private readonly identities = new Map<string, string>();
  private readonly plan: AgentPlanInput;

  public constructor(plan: AgentPlanInput) {
    this.plan = plan;
    plan.nodes.forEach((node) => this.identify(node));
  }

  /** Returns an independent graph whose references all name the copied identities. */
  public copy(): Pick<AgentPlanInput, "nodes" | "edges"> {
    return {
      nodes: this.plan.nodes.map((node) => this.node(node)),
      edges: this.edges(this.plan.edges),
    };
  }

  private add(id: string): void {
    if (this.identities.has(id)) this.invalidReference();
    this.identities.set(id, randomUUID());
  }

  private identify(node: AgentPlanNode): void {
    this.add(node.id);
    if (node.type === "group" || node.type === "loop") {
      node.steps.forEach((step) => this.identify(step));
      node.decisions?.forEach((decision) => this.identify(decision));
    }
    if (node.type === "group")
      node.parameters.forEach((entry) => this.add(entry.id));
    if (node.type === "stack")
      node.entries.forEach((entry) => this.add(entry.id));
  }

  private invalidReference(): never {
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "graph_invalid",
    });
  }

  private mapped(id: string): string {
    return this.identities.get(id) ?? this.invalidReference();
  }

  private edges(edges: readonly AgentPlanEdge[]): readonly AgentPlanEdge[] {
    return edges.map((edge) => ({
      ...edge,
      from: this.mapped(edge.from),
      to: this.mapped(edge.to),
    }));
  }

  private binding(binding: AgentPlanBinding): AgentPlanBinding {
    if (binding.kind === "stack")
      return { ...binding, stackId: this.mapped(binding.stackId) };
    if (binding.kind === "source")
      return { ...binding, nodeId: this.mapped(binding.nodeId) };
    if (binding.kind === "result" || binding.kind === "previous")
      return { ...binding, stepId: this.mapped(binding.stepId) };
    return binding;
  }

  private bindings(
    entries: Readonly<Record<string, AgentPlanBinding>>,
  ): Readonly<Record<string, AgentPlanBinding>> {
    return Object.fromEntries(
      Object.entries(entries).map(([name, binding]) => [
        name,
        this.binding(binding),
      ]),
    );
  }

  private step(step: AgentPlanStep): AgentPlanStep {
    const id = this.mapped(step.id);
    return {
      ...step,
      id,
      agentId:
        step.configuration?.connectionId || step.configuration?.runnerRoute
          ? id
          : step.agentId,
      bindings: this.bindings(step.bindings),
    };
  }

  private decision(node: AgentPlanDecision): AgentPlanDecision {
    return {
      ...node,
      id: this.mapped(node.id),
      ...(node.input ? { input: this.binding(node.input) } : {}),
    };
  }

  private group(node: AgentPlanGroup): AgentPlanGroup {
    return {
      ...node,
      id: this.mapped(node.id),
      steps: node.steps.map((step) => this.step(step)),
      ...(node.edges ? { edges: this.edges(node.edges) } : {}),
      ...(node.decisions
        ? {
            decisions: node.decisions.map((decision) =>
              this.decision(decision),
            ),
          }
        : {}),
      parameters: node.parameters.map((entry) => ({
        ...entry,
        id: this.mapped(entry.id),
      })),
      bindings: this.bindings(node.bindings),
    };
  }

  private loop(node: AgentPlanLoop): AgentPlanLoop {
    const steps = node.steps.map((step) => {
      if (step.type === "agent") return this.step(step);
      if (step.type === "group") return this.group(step);
      return {
        ...step,
        id: this.mapped(step.id),
        bindings: this.bindings(step.bindings),
      };
    });
    return {
      ...node,
      id: this.mapped(node.id),
      steps,
      ...(node.decisions
        ? {
            decisions: node.decisions.map((decision) =>
              this.decision(decision),
            ),
          }
        : {}),
      ...(node.while
        ? {
            while: {
              ...node.while,
              sourceNodeId: this.conditionSource(node.while.sourceNodeId),
            },
          }
        : {}),
      edges: this.edges(node.edges),
      bindings: this.bindings(node.bindings),
      condition: node.condition
        ? {
            ...node.condition,
            sourceNodeId: this.conditionSource(node.condition.sourceNodeId),
          }
        : null,
    };
  }

  private conditionSource(sourceId: string): string {
    return sourceId ? this.mapped(sourceId) : "";
  }

  private node(node: AgentPlanNode): AgentPlanNode {
    if (node.type === "agent") return this.step(node);
    if (node.type === "group") return this.group(node);
    if (node.type === "loop") return this.loop(node);
    if (node.type === "decision") return this.decision(node);
    if (node.type === "stack")
      return {
        ...node,
        id: this.mapped(node.id),
        entries: node.entries.map((entry) => ({
          ...entry,
          id: this.mapped(entry.id),
        })),
      };
    if (node.type === "script" || node.type === "git_closeout")
      return {
        ...node,
        id: this.mapped(node.id),
        bindings: this.bindings(node.bindings),
      };
    return { ...node, id: this.mapped(node.id) };
  }
}
