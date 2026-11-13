import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import {
  copyPlanConfiguration,
  planSavedModel,
  planTargetModels,
} from "@/definition/AgentPlanConfiguration";

import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanStep,
  AgentPlanBinding,
} from "@/definition/AgentPlan";
import type {
  AgentParameterValue,
  AgentParameter,
} from "@/definition/AgentParameters";
import type { AgentPlanCloneAdjustment } from "@/definition/AgentPlanClone";
import type { PlanDependencies } from "./AgentPlanDependencies";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { PageAgentModel } from "@/definition/PageAgent";

/** Only metadata and authorization are read; copying never starts a runner. */
export type CloneReferenceDependencies = Pick<
  PlanDependencies,
  | "profiles"
  | "parameters"
  | "tasks"
  | "workspaces"
  | "remoteExecution"
  | "remoteTargets"
  | "planAssets"
>;

/** Repairs external selections while preserving the graph, instructions and parameter declarations. */
export class AgentPlanCloneReferences {
  private readonly dependencies: CloneReferenceDependencies;
  private readonly userId: string;
  private readonly adjustments: AgentPlanCloneAdjustment[];
  private agents: readonly AgentDefinitionChoice[] = [];
  private models: readonly PageAgentModel[] = [];
  private projectId = "";
  private planTarget: AgentPlanExecutionTarget | undefined;
  private workspaceIds: ReadonlySet<string> = new Set();

  public constructor(
    dependencies: CloneReferenceDependencies,
    userId: string,
    adjustments: AgentPlanCloneAdjustment[],
  ) {
    this.dependencies = dependencies;
    this.userId = userId;
    this.adjustments = adjustments;
  }

  /** Clears only resources that the caller cannot select in the destination project. */
  public async prepare(plan: AgentPlanInput): Promise<AgentPlanInput> {
    this.projectId = plan.projectId ?? "";
    this.planTarget = plan.executionTarget;
    const [agents, models, remote, workspaces, targets] = await Promise.all([
      this.dependencies.profiles.catalog(this.userId, this.projectId),
      this.dependencies.profiles.planModels(this.userId, this.projectId),
      this.dependencies.remoteExecution?.sources(this.userId, this.projectId),
      this.dependencies.workspaces.choices(this.userId),
      this.dependencies.remoteTargets?.list(this.userId, this.projectId),
    ]);
    this.agents = agents;
    this.models = [...models, ...(remote?.models ?? [])];
    this.workspaceIds = new Set([
      ...workspaces
        .filter(
          (entry) =>
            entry.projectId === this.projectId && entry.isUsable !== false,
        )
        .map((entry) => entry.id),
      ...(targets ?? []).map((entry) => entry.workspaceId),
    ]);
    const nodes: AgentPlanNode[] = [];
    for (const node of plan.nodes) nodes.push(await this.node(node));
    return { ...plan, nodes };
  }

  private mark(nodeId: string): void {
    if (
      !this.adjustments.some(
        (entry) =>
          entry.code === "reference_cleared" && entry.nodeId === nodeId,
      )
    )
      this.adjustments.push({ code: "reference_cleared", nodeId });
  }

  private async allowed(check: () => Promise<unknown>): Promise<boolean> {
    try {
      await check();
      return true;
    } catch (error: unknown) {
      if (error instanceof AgentError) return false;
      if (
        error instanceof AgentExecutionError &&
        error.code !== "credentialsInText"
      )
        return false;
      throw error;
    }
  }

  private async reference(
    reference: AgentParameterValue,
    nodeId: string,
  ): Promise<AgentParameterValue | null> {
    let isAllowed = true;
    if (reference.type === "ticket")
      isAllowed = await this.allowed(() =>
        this.dependencies.parameters.requireTicket(
          this.userId,
          reference.ticketId,
        ),
      );
    if (reference.type === "wiki")
      isAllowed = await this.allowed(() =>
        this.dependencies.parameters.requireWiki(this.userId, reference.pageId),
      );
    if (reference.type === "workspace")
      isAllowed = this.workspaceIds.has(reference.workspaceId);
    if (reference.type === "asset")
      isAllowed = await this.allowed(async () => {
        const asset = await this.dependencies.planAssets?.describe(
          this.userId,
          reference.assetId,
        );
        if (asset?.projectId !== this.projectId)
          throw new AgentError("plan_asset_missing");
      });
    if (isAllowed) return reference;
    this.mark(nodeId);
    return null;
  }

  private async parameters(
    parameters: readonly AgentParameter[],
    nodeId: string,
  ): Promise<readonly AgentParameter[]> {
    const result: AgentParameter[] = [];
    for (const parameter of parameters)
      result.push({
        ...parameter,
        defaultValue: parameter.defaultValue
          ? await this.reference(parameter.defaultValue, nodeId)
          : null,
      });
    return result;
  }

  private async bindings(
    bindings: Readonly<Record<string, AgentPlanBinding>>,
    nodeId: string,
  ): Promise<Readonly<Record<string, AgentPlanBinding>>> {
    const result: Record<string, AgentPlanBinding> = {};
    for (const [name, binding] of Object.entries(bindings))
      result[name] =
        binding.kind === "literal" && binding.value
          ? { ...binding, value: await this.reference(binding.value, nodeId) }
          : binding;
    return result;
  }

  private async agent(original: AgentPlanStep): Promise<AgentPlanStep> {
    const step = this.executionTarget(original);
    const source = this.agents.find((entry) => entry.id === step.agentId);
    let configuration =
      step.configuration ??
      (source ? copyPlanConfiguration(source) : undefined);
    const isAllowed = await this.canUseAgent(step, configuration, source);
    if (!isAllowed) {
      this.mark(step.id);
      configuration = configuration
        ? this.emptyModel(configuration)
        : {
            name: "",
            revision: 1,
            modelProfileId: "",
            model: "",
            provider: null,
            reasoningEffort: null,
            template: {
              markdown: "",
              parameters: [],
              directoryParameter: null,
            },
          };
    }
    if (configuration)
      configuration = {
        ...configuration,
        template: {
          ...configuration.template,
          parameters: await this.parameters(
            configuration.template.parameters,
            step.id,
          ),
        },
      };
    let selectionRequired = step.selectionRequired;
    if (!isAllowed) selectionRequired = step.configuration ? "model" : "agent";
    return {
      ...step,
      selectionRequired,
      agentId: isAllowed ? step.agentId : "",
      personalAgentId: isAllowed ? step.personalAgentId : null,
      ...(configuration ? { configuration } : {}),
      bindings: await this.bindings(step.bindings, step.id),
    };
  }

  private async canUseAgent(
    step: AgentPlanStep,
    configuration: AgentPlanConfiguration | undefined,
    source: AgentDefinitionChoice | undefined,
  ): Promise<boolean> {
    if (!configuration) return source !== undefined;
    const models = planTargetModels(
      this.models,
      step.executionTarget ?? this.planTarget,
    );
    if (!planSavedModel(models, configuration)) return false;
    if (!configuration.connectionId && !configuration.runnerRoute && !source)
      return false;
    if (
      step.personalAgentId &&
      !(await this.dependencies.profiles.isVisible(
        this.userId,
        step.personalAgentId,
      ))
    )
      return false;
    if (configuration.runnerRoute) return true;
    return this.allowed(() =>
      this.dependencies.profiles.resolveDefinition(this.userId, {
        agentId: step.agentId,
        personalAgentId: step.personalAgentId,
        projectId: this.projectId,
        configuration,
      }),
    );
  }

  private emptyModel(
    configuration: AgentPlanConfiguration,
  ): AgentPlanConfiguration {
    return {
      name: configuration.name,
      revision: configuration.revision,
      modelProfileId: "",
      model: "",
      provider: null,
      reasoningEffort: null,
      template: configuration.template,
    };
  }

  private executionTarget<Node extends AgentPlanStep | AgentPlanScript>(
    node: Node,
  ): Node {
    if (
      node.executionTarget?.kind !== "remote" ||
      this.workspaceIds.has(node.executionTarget.workspaceId)
    )
      return node;
    this.mark(node.id);
    return { ...node, executionTarget: undefined };
  }

  private async script(original: AgentPlanScript): Promise<AgentPlanScript> {
    const node = this.executionTarget(original);
    return { ...node, bindings: await this.bindings(node.bindings, node.id) };
  }

  private async node(node: AgentPlanNode): Promise<AgentPlanNode> {
    if (node.type === "agent") return this.agent(node);
    if (node.type === "group") return this.group(node);
    if (node.type === "loop") {
      const steps: (typeof node.steps)[number][] = [];
      for (const step of node.steps) {
        if (step.type === "agent") steps.push(await this.agent(step));
        else if (step.type === "group") steps.push(await this.group(step));
        else steps.push(await this.script(step));
      }
      const decisions = await this.decisions(node.decisions);
      return {
        ...node,
        steps,
        decisions,
        bindings: await this.bindings(node.bindings, node.id),
      };
    }
    return this.leaf(node);
  }

  private async group(
    node: Extract<AgentPlanNode, { type: "group" }>,
  ): Promise<typeof node> {
    const steps: AgentPlanStep[] = [];
    for (const step of node.steps) steps.push(await this.agent(step));
    const parameters: (typeof node.parameters)[number][] = [];
    for (const parameter of node.parameters)
      parameters.push({
        ...parameter,
        defaultValue: parameter.defaultValue
          ? await this.reference(parameter.defaultValue, node.id)
          : null,
      });
    return {
      ...node,
      steps,
      parameters,
      decisions: await this.decisions(node.decisions),
      bindings: await this.bindings(node.bindings, node.id),
    };
  }

  private async decisions(
    nodes: Extract<AgentPlanNode, { type: "group" }>["decisions"],
  ): Promise<typeof nodes> {
    if (!nodes) return undefined;
    const result: NonNullable<typeof nodes>[number][] = [];
    for (const node of nodes) result.push(await this.decision(node));
    return result;
  }

  private async decision(
    node: Extract<AgentPlanNode, { type: "decision" }>,
  ): Promise<typeof node> {
    const saved = node.model;
    let model = saved;
    if (
      saved &&
      !this.models.some(
        (entry) =>
          entry.connectionId === saved.connectionId &&
          entry.model === saved.model,
      )
    ) {
      this.mark(node.id);
      model = undefined;
    }
    const input = node.input
      ? (await this.bindings({ input: node.input }, node.id)).input
      : undefined;
    return { ...node, model, ...(node.input ? { input } : {}) };
  }

  private async leaf(node: AgentPlanNode): Promise<AgentPlanNode> {
    if (node.type === "decision") return this.decision(node);
    if (node.type === "parameter") {
      const value = await this.reference(node.value, node.id);
      return value
        ? { ...node, value }
        : { ...node, format: "string", value: { type: "text", text: "" } };
    }
    if (
      node.type === "task" &&
      node.taskId &&
      !(await this.allowed(() =>
        this.dependencies.tasks.snapshot(
          this.userId,
          this.projectId,
          node.taskId,
        ),
      ))
    ) {
      this.mark(node.id);
      return { ...node, taskId: "" };
    }
    if (node.type === "stack") {
      const entries: (typeof node.entries)[number][] = [];
      for (const entry of node.entries) {
        if (
          entry.type === "task" &&
          !(await this.allowed(() =>
            this.dependencies.tasks.snapshot(
              this.userId,
              this.projectId,
              entry.taskId,
            ),
          ))
        ) {
          this.mark(node.id);
          continue;
        }
        if (entry.type !== "parameter") {
          entries.push(entry);
          continue;
        }
        const value = await this.reference(entry.value, node.id);
        entries.push(
          value
            ? { ...entry, value }
            : { ...entry, format: "string", value: { type: "text", text: "" } },
        );
      }
      return { ...node, entries };
    }
    if (node.type === "script") return this.script(node);
    return node;
  }
}
