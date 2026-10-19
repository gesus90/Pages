import { randomUUID } from "node:crypto";

import { AgentError } from "@/backend/error/AgentErrors";
import { requireCredentialFreeText } from "@/backend/security/AgentTextSafety";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import { allPlanSteps, mapPlanSteps } from "@/definition/AgentPlanGroup";
import {
  instantiatePlanTemplate,
  isPlanTemplateNode,
  planTemplateNode,
} from "@/definition/AgentPlanNodeTemplate";

import type { AgentPlanTemplateRepository } from "@/backend/database/repositories/agent/AgentPlanTemplateRepository";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentPlanInput } from "@/definition/AgentPlan";
import type {
  AgentPlanNodeTemplate,
  AgentPlanTemplateNode,
} from "@/definition/AgentPlanNodeTemplate";
import type { AgentPlanService } from "./AgentPlanService";

interface TemplateDependencies {
  readonly templates: AgentPlanTemplateRepository;
  readonly plans: Pick<AgentPlanService, "view" | "agents" | "checkNodes">;
}

/** The plan a template is saved from or inserted into, as the editor holds it. */
export interface AgentPlanTemplateContext {
  /** The saved plan, or `null` for a plan that was never saved. */
  readonly planId: string | null;
  /** The workspace of the edited plan, whose project decides what is available. */
  readonly workspaceId: string;
}

/** A named node configuration to save, still unchecked. */
export interface AgentPlanTemplateDraft {
  readonly name: string;
  readonly node: AgentPlanTemplateNode;
}

/**
 * Saves node configurations as personal templates and checks every insertion again.
 *
 * @remarks
 * A template belongs to the person who saved it; nobody else lists or
 * inserts it. Saving and inserting require the right to edit the plan.
 * An insertion checks agents, models and referenced values against the
 * target plan's project at that moment and refuses with the first
 * unavailable reference: nothing falls back to another agent or model.
 */
export class AgentPlanTemplateService {
  private readonly dependencies: TemplateDependencies;

  public constructor(dependencies: TemplateDependencies) {
    this.dependencies = dependencies;
  }

  /** Lists the person's own templates, the newest first. */
  public async list(userId: string): Promise<readonly AgentPlanNodeTemplate[]> {
    return this.dependencies.templates.list(userId);
  }

  /**
   * Saves the configuration of one node under a new name.
   *
   * @remarks
   * Outer connections stay behind (see `planTemplateNode`); the plan itself
   * does not change.
   *
   * @throws {AgentError} `template_name_taken` for a name the person already
   * uses, `plan_access_denied` without the right to edit the plan.
   */
  public async save(
    userId: string,
    context: AgentPlanTemplateContext,
    draft: AgentPlanTemplateDraft,
  ): Promise<AgentPlanNodeTemplate> {
    if (!draft.name.trim()) throw new AgentError("template_name_required");
    await this.requireEditable(userId, context);
    // The template gets identifiers of its own, so it names no node of the source plan.
    const node = await this.pinned(
      userId,
      context.workspaceId,
      instantiatePlanTemplate(planTemplateNode(draft.node), randomUUID),
    );
    requireCredentialFreeText(JSON.stringify(node));
    await this.dependencies.plans.checkNodes(userId, context.workspaceId, [
      node,
    ]);
    return this.dependencies.templates.create({
      id: randomUUID(),
      ownerId: userId,
      name: draft.name.trim(),
      node,
    });
  }

  /**
   * Returns a new, independent copy of a template for the edited plan.
   *
   * @remarks
   * The copy is not stored: it joins the draft like any new node, and the
   * plan's save stores it with the plan.
   *
   * @throws {AgentError} `template_not_found` for a missing or foreign
   * template, or the code of the first reference the plan cannot use.
   */
  public async insert(
    userId: string,
    context: AgentPlanTemplateContext,
    templateId: string,
  ): Promise<AgentPlanTemplateNode> {
    const template = await this.dependencies.templates.find(userId, templateId);
    if (!template) throw new AgentError("template_not_found");
    await this.requireEditable(userId, context);
    const copy = instantiatePlanTemplate(
      planTemplateNode(template.node),
      randomUUID,
    );
    await this.requireAgents(userId, context.workspaceId, copy);
    await this.dependencies.plans.checkNodes(userId, context.workspaceId, [
      copy,
    ]);
    return copy;
  }

  private async requireEditable(
    userId: string,
    context: AgentPlanTemplateContext,
  ): Promise<void> {
    if (context.planId === null) return;
    const plan = await this.dependencies.plans.view(userId, context.planId);
    if (!plan.canEdit) throw new AgentError("plan_access_denied");
  }

  /**
   * Names a missing agent as such, before the general plan checks.
   *
   * @returns The agents a node of the workspace's plans may run.
   */
  private async requireAgents(
    userId: string,
    workspaceId: string,
    node: AgentPlanTemplateNode,
  ): Promise<readonly AgentDefinitionChoice[]> {
    const agents = await this.dependencies.plans.agents(userId, workspaceId);
    for (const step of allPlanSteps(templatePlan(node)))
      if (!agents.some((agent) => agent.id === step.agentId))
        throw new AgentError("agent_usage_denied");
    return agents;
  }

  /**
   * Keeps the configuration an agent node runs with.
   *
   * @remarks
   * A node of an older plan without its own copy runs with its agent's
   * current one; the template takes that copy, as the plan's next save would.
   */
  private async pinned(
    userId: string,
    workspaceId: string,
    node: AgentPlanTemplateNode,
  ): Promise<AgentPlanTemplateNode> {
    const agents = await this.requireAgents(userId, workspaceId, node);
    const [pinned] = mapPlanSteps(templatePlan(node), (step) => {
      if (step.configuration) return step;
      const agent = agents.find((entry) => entry.id === step.agentId);
      return agent
        ? { ...step, configuration: copyPlanConfiguration(agent) }
        : step;
    }).nodes;
    if (pinned?.type !== node.type || !isPlanTemplateNode(pinned))
      throw new AgentError("template_invalid");
    return pinned;
  }
}

/** A plan of the one node, for the plan-wide helpers. */
function templatePlan(node: AgentPlanTemplateNode): AgentPlanInput {
  return {
    name: "",
    workspaceId: "",
    usage: "private",
    globals: {},
    nodes: [node],
    edges: [],
  };
}
