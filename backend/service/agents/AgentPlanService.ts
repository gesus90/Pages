import { randomUUID } from "node:crypto";

import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { endTaggedProcesses } from "@/backend/agents/cli/CliProcessScan";
import { AgentError } from "@/backend/error/AgentErrors";
import { requireCredentialFreeText } from "@/backend/service/assistant/TextAssistantValidation";

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
import type { AgentPlanSessionAccess } from "./AgentPlanSessionAccess";
import type { AgentRunArchive } from "./AgentRunArchive";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";

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
  /** Ends the MCP access of interrupted sessions; absent without plan sessions. */
  readonly sessions?: AgentPlanSessionAccess;
  /** Serves the prompts nodes were sent. */
  readonly archive?: AgentRunArchive;
}

/**
 * Ends what an interrupted node left behind: its processes and its MCP access.
 *
 * @remarks
 * A server stop can leave a runner and its helpers running in their own
 * process group. Every process of a session carries its instance tag, so the
 * restarted server finds and ends them before it reports the node as failed.
 */
async function endInterruptedSession(
  step: AgentPlanStepResult,
): Promise<AgentPlanStepResult> {
  const session = step.session;
  if (!session || session.closeout !== "pending") return step;
  const cleanup = await endTaggedProcesses(session.instanceId);
  return {
    ...step,
    session: {
      ...session,
      endedAt: new Date().toISOString(),
      closeout: cleanup.remaining === 0 ? "confirmed" : "failed",
      leftoverProcesses: cleanup.found,
      resultCode: -1,
    },
  };
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

  /**
   * Fails orphaned runs at startup without releasing unknown reservations.
   *
   * @remarks
   * Processes and MCP access that interrupted sessions left behind are ended
   * first; nothing is started again.
   */
  public async recoverInterruptedRuns(): Promise<void> {
    for (const previous of await this.dependencies.runs.unfinished()) {
      await this.dependencies.sessions?.revoke(previous.id, null);
      const steps = await Promise.all(
        previous.steps.map(endInterruptedSession),
      );
      const run: AgentPlanRun = {
        ...previous,
        status: "failed",
        stopRequested: true,
        steps: steps.map((step) => {
          if (step.status === "running")
            return {
              ...step,
              status: "failed",
              cancellation: "requested",
              error: "plan_interrupted",
            };
          if (step.status === "waiting" || step.status === "paused")
            return { ...step, isBlocked: true, error: "plan_interrupted" };
          return step;
        }),
      };
      await this.dependencies.runs.interrupt(run);
    }
  }

  /**
   * Returns the prompt a node of the executor's run was sent.
   *
   * @param userId - The executor; nobody else reads it.
   * @param runId - The plan run.
   * @param stepId - The node.
   * @returns The redacted plain text exactly as the runner received it.
   * @throws {AgentError} `plan_access_denied` without current access, or when
   * the node has not been sent anything.
   */
  public async prompt(
    userId: string,
    runId: string,
    stepId: string,
  ): Promise<string> {
    await this.run(userId, runId);
    const agentId = await this.dependencies.runs.stepAgent(runId, stepId);
    const prompt =
      agentId === null || !this.dependencies.archive
        ? null
        : await this.dependencies.archive.sentPrompt(userId, {
            planRunId: runId,
            stepId,
            agentId,
          });
    if (prompt === null) throw new AgentError("plan_access_denied");
    return prompt;
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
      directory: await this.dependencies.access.directory(userId),
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
    requireCredentialFreeText(JSON.stringify(proposed));
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
    if (
      proposed.projectId !== undefined &&
      proposed.projectId !== workspace.projectId
    )
      throw new AgentError("plan_context_changed");
    await this.validateReferences(userId, proposed, workspace.projectId);
    const planId = id ?? randomUUID();
    await this.dependencies.access.validateSharing({
      ...proposed,
      id: planId,
      ownerId: userId,
      projectId: workspace.projectId,
      revision: proposed.revision ?? 1,
    });
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

  /**
   * Deletes a plan with the same right that edits it: its owner's.
   *
   * @param userId - The authenticated requester.
   * @param id - The plan to delete.
   * @throws {AgentError} `plan_access_denied` when the plan is not visible to
   * the requester or belongs to someone else, `plan_running` while one of its
   * runs is active.
   */
  public async remove(userId: string, id: string): Promise<void> {
    const plan = await this.dependencies.access.require(userId, id);
    if (!plan.canEdit) throw new AgentError("plan_access_denied");
    await this.dependencies.plans.remove(plan.id, userId);
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
    for (const agentId of resources.agentIds)
      if (!(await this.dependencies.profiles.isVisible(userId, agentId)))
        throw new AgentError("plan_access_denied");
    // Access only: a run that started must stay readable and stoppable after its directory or link is gone.
    for (const workspaceId of resources.workspaceIds)
      await this.dependencies.workspaces.requireAccess(
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
    for (const ticketId of resources.ticketIds)
      await this.dependencies.parameters.requireTicket(userId, ticketId);
    return run;
  }

  /** Other workspace users or plan owners cannot stop an executor's private run. */
  public async stop(userId: string, id: string): Promise<AgentPlanRun> {
    await this.run(userId, id);
    await this.dependencies.engine.stop(id);
    return this.run(userId, id);
  }

  /** Only the executor with current plan and resource access may pause this run. */
  public async pause(userId: string, id: string): Promise<AgentPlanRun> {
    await this.run(userId, id);
    await this.dependencies.engine.pause(id);
    return this.run(userId, id);
  }

  /** Reauthorizes the original executor; the engine keeps the original run snapshot. */
  public async resume(userId: string, id: string): Promise<AgentPlanRun> {
    await this.run(userId, id);
    await this.dependencies.engine.resume(id);
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
    // Plans that only use agents of users stay out of the administration.
    const hidden = await this.dependencies.profiles.userAgentIds(actor);
    for (const plan of await this.dependencies.plans.list()) {
      const bindings = planTaskBindings(plan);
      if (bindings.length === 0) continue;
      const tasks =
        readable.get(plan.projectId) ??
        (await this.dependencies.tasks.list(actor.userId, plan.projectId));
      readable.set(plan.projectId, tasks);
      for (const binding of bindings) {
        const task = tasks.find((entry) => entry.id === binding.taskId);
        if (!task || hidden.has(binding.agentId)) continue;
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
    validatePlanGraph(proposed, catalog);
    if (
      planSteps(proposed).some(
        (step) => !catalog.some((agent) => agent.id === step.agentId),
      )
    )
      throw new AgentError("plan_access_denied");
    for (const node of proposed.nodes) {
      if (node.type === "task")
        await this.dependencies.tasks.snapshot(userId, projectId, node.taskId);
      const values = node.type === "parameter" ? [node.value] : [];
      if (node.type === "agent")
        values.push(
          ...Object.values(node.bindings).flatMap((binding) =>
            binding.kind === "literal" && binding.value ? [binding.value] : [],
          ),
        );
      for (const value of values) {
        if (value.type === "ticket")
          await this.dependencies.parameters.requireTicket(
            userId,
            value.ticketId,
          );
        if (value.type === "wiki")
          await this.dependencies.parameters.requireWiki(userId, value.pageId);
        if (value.type === "workspace")
          await this.dependencies.workspaces.resolve(
            userId,
            value.workspaceId,
            projectId,
          );
      }
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
