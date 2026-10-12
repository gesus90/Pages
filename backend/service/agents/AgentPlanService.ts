import { randomUUID } from "node:crypto";

import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";

import { planSteps, validatePlanGraph } from "./AgentPlanGraph";
import { requireAgentAdministrator } from "./AgentServiceAccess";

import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type {
  AgentPlan,
  AgentPlanInput,
  AgentPlanPage,
  AgentPlanRun,
  AgentPlanSources,
  AgentPlanTask,
} from "@/definition/AgentPlan";
import type { AgentTaskAssignment } from "@/definition/AgentUsage";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentParameterService } from "./AgentParameterService";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentPlanPreparation } from "./AgentPlanPreparation";
import type { AgentPlanRunEngine } from "./AgentPlanRunEngine";

interface PlanDependencies {
  readonly plans: AgentPlanRepository;
  readonly runs: AgentPlanRunRepository;
  readonly workspaces: AgentWorkspaceService;
  readonly profiles: AgentProfileService;
  readonly parameters: AgentParameterService;
  readonly tasks: AgentPlanTasks;
  readonly access: AgentPlanAccess;
  readonly preparation: AgentPlanPreparation;
  readonly engine: AgentPlanRunEngine;
}

interface PlanTaskBinding {
  readonly agentId: string;
  readonly taskId: string;
}

/** Lists each agent and ticket pair once per plan, including a step's personal access agent. */
function planTaskBindings(plan: AgentPlan): readonly PlanTaskBinding[] {
  const tickets = new Map<string, string>();
  for (const node of plan.nodes)
    if (node.type === "task") tickets.set(node.id, node.taskId);
  const pairs = new Map<string, PlanTaskBinding>();
  for (const step of planSteps(plan)) {
    const agentIds =
      step.personalAgentId === null
        ? [step.agentId]
        : [step.agentId, step.personalAgentId];
    for (const binding of Object.values(step.bindings)) {
      const taskId =
        binding.kind === "source" ? tickets.get(binding.nodeId) : undefined;
      if (taskId === undefined) continue;
      for (const agentId of agentIds)
        pairs.set(`${agentId}\n${taskId}`, { agentId, taskId });
    }
  }
  return [...pairs.values()];
}

/** Route-facing plan facade; graph, authorization and execution responsibilities stay in small services. */
export class AgentPlanService {
  private readonly dependencies: PlanDependencies;

  public constructor(dependencies: PlanDependencies) {
    this.dependencies = dependencies;
  }

  /** Fails orphaned runs at startup without claiming process cancellation or releasing unknown reservations. */
  public async recoverInterruptedRuns(): Promise<void> {
    for (const previous of await this.dependencies.runs.unfinished()) {
      const run: AgentPlanRun = {
        ...previous,
        status: "failed",
        stopRequested: true,
        steps: previous.steps.map((step) => {
          if (step.status === "running")
            return {
              ...step,
              status: "failed",
              cancellation: "requested",
              error: "plan_interrupted",
            };
          if (step.status === "waiting")
            return { ...step, isBlocked: true, error: "plan_interrupted" };
          return step;
        }),
      };
      await this.dependencies.runs.interrupt(run);
    }
  }

  /** Loads only authorized plans, sources and the requesting user's execution history. */
  public async page(
    userId: string,
    selection: {
      readonly planId: string | null;
      readonly workspaceId: string | null;
    },
  ): Promise<AgentPlanPage> {
    const [plans, workspaces] = await Promise.all([
      this.dependencies.access.list(userId),
      this.dependencies.workspaces.choices(userId),
    ]);
    const selected =
      selection.planId === null
        ? null
        : await this.dependencies.access.require(userId, selection.planId);
    const workspaceId = selected?.workspaceId ?? selection.workspaceId;
    const workspace = workspaces.find((entry) => entry.id === workspaceId);
    if (workspaceId !== null && !workspace)
      throw new AgentError("plan_access_denied");
    return {
      userId,
      plans,
      workspaces,
      selected,
      sources: workspace
        ? await this.sources(userId, workspace.id)
        : { agents: [], tasks: [] },
      runs: selected ? await this.history(userId, selected.id) : [],
    };
  }

  /** The source API resolves the selected workspace's current project on the server. */
  public async sources(
    userId: string,
    workspaceId: string,
  ): Promise<AgentPlanSources> {
    const workspace = (await this.dependencies.workspaces.choices(userId)).find(
      (entry) => entry.id === workspaceId,
    );
    if (!workspace) throw new AgentError("plan_access_denied");
    const [agents, tasks] = await Promise.all([
      this.dependencies.profiles.catalog(userId, workspace.projectId),
      this.dependencies.tasks.list(userId, workspace.projectId),
    ]);
    return { agents, tasks };
  }

  /** Creates or owner-edits a graph without silently rebinding nodes to another project. */
  public async save(
    userId: string,
    id: string | null,
    input: unknown,
  ): Promise<string> {
    const proposed = readPlanInput(input);
    validatePlanGraph(proposed);
    const previous =
      id === null ? null : await this.dependencies.access.require(userId, id);
    if (previous && !previous.canEdit)
      throw new AgentError("plan_access_denied");
    if (previous && proposed.revision === undefined)
      throw new AgentError("plan_conflict");
    if (
      previous &&
      previous.workspaceId !== proposed.workspaceId &&
      proposed.nodes.length > 0
    )
      throw new AgentError("plan_context_changed");
    const workspace = await this.dependencies.workspaces.resolve(
      userId,
      proposed.workspaceId,
    );
    await this.validateReferences(userId, proposed, workspace.projectId);
    const planId = id ?? randomUUID();
    await this.dependencies.plans.save(
      {
        ...proposed,
        id: planId,
        ownerId: userId,
        projectId: workspace.projectId,
        revision: proposed.revision ?? 1,
      },
      id === null,
    );
    return planId;
  }

  /** Play uses the saved revision and never executes an unsaved client graph. */
  public async play(
    userId: string,
    id: string,
    revision: number,
  ): Promise<AgentPlanRun> {
    const plan = await this.dependencies.access.require(userId, id);
    if (plan.revision !== revision) throw new AgentError("plan_conflict");
    const snapshot = await this.dependencies.preparation.prepare(userId, plan);
    await this.dependencies.access.require(userId, id);
    return this.dependencies.engine.start(userId, snapshot);
  }

  /** Run output stays private to its executor and still requires current plan/workspace permission. */
  public async run(userId: string, id: string): Promise<AgentPlanRun> {
    const run = await this.dependencies.runs.find(id);
    if (!run || run.userId !== userId)
      throw new AgentError("plan_access_denied");
    await this.dependencies.access.require(userId, run.planId);
    const resources = await this.dependencies.runs.resources(id);
    for (const workspaceId of resources.workspaceIds)
      await this.dependencies.workspaces.resolve(
        userId,
        workspaceId,
        resources.projectId,
      );
    for (const taskId of resources.taskIds)
      await this.dependencies.tasks.snapshot(
        userId,
        resources.projectId,
        taskId,
      );
    for (const pageId of resources.wikiIds)
      await this.dependencies.parameters.requireWiki(userId, pageId);
    return run;
  }

  /** Other workspace users or plan owners cannot stop an executor's private run. */
  public async stop(userId: string, id: string): Promise<AgentPlanRun> {
    await this.run(userId, id);
    await this.dependencies.engine.stop(id);
    return this.run(userId, id);
  }

  /**
   * Lists, per agent, the tickets that plan steps bind to it, for the protected agent administration.
   *
   * @remarks
   * Tickets the administrator cannot read are omitted, not counted. The plan stays the only place that changes them.
   */
  public async taskAssignments(
    actor: AccountAccess,
  ): Promise<Readonly<Record<string, readonly AgentTaskAssignment[]>>> {
    requireAgentAdministrator(actor);
    const assignments: Record<string, AgentTaskAssignment[]> = {};
    const readable = new Map<string, readonly AgentPlanTask[]>();
    for (const plan of await this.dependencies.plans.list()) {
      const bindings = planTaskBindings(plan);
      if (bindings.length === 0) continue;
      const tasks =
        readable.get(plan.projectId) ??
        (await this.dependencies.tasks.list(actor.userId, plan.projectId));
      readable.set(plan.projectId, tasks);
      for (const binding of bindings) {
        const task = tasks.find((entry) => entry.id === binding.taskId);
        if (!task) continue;
        const list = assignments[binding.agentId] ?? [];
        list.push({
          planId: plan.id,
          planName: plan.name,
          taskId: task.id,
          key: task.key,
          title: task.title,
        });
        assignments[binding.agentId] = list;
      }
    }
    return assignments;
  }

  /** Completes active cancellation before application shutdown closes the database. */
  public async shutdown(): Promise<void> {
    await this.dependencies.engine.shutdown();
  }

  private async validateReferences(
    userId: string,
    proposed: AgentPlanInput,
    projectId: string,
  ): Promise<void> {
    const catalog = await this.dependencies.profiles.catalog(userId, projectId);
    if (
      planSteps(proposed).some(
        (step) => !catalog.some((agent) => agent.id === step.agentId),
      )
    )
      throw new AgentError("plan_access_denied");
    for (const node of proposed.nodes) {
      if (node.type === "task")
        await this.dependencies.tasks.snapshot(userId, projectId, node.taskId);
    }
  }

  private async history(
    userId: string,
    planId: string,
  ): Promise<readonly AgentPlanRun[]> {
    const history: AgentPlanRun[] = [];
    for (const run of await this.dependencies.runs.list(userId, planId)) {
      try {
        history.push(await this.run(userId, run.id));
      } catch (error: unknown) {
        if (!(error instanceof AgentError)) throw error;
      }
    }
    return history;
  }
}
