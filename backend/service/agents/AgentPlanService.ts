import { randomUUID } from "node:crypto";
import { withPortlessPlanGroups } from "@/definition/AgentPlanGroupUpgrade";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { allPlanSteps, mapPlanSteps } from "@/definition/AgentPlanGroup";
import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { ProjectRunsActiveError } from "@/backend/error/ProjectErrors";
import { requireCredentialFreeText } from "@/backend/security/AgentTextSafety";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import { isAcpProvider } from "@/definition/AgentConfiguration";
import { withoutTicketFlow } from "@/definition/AgentPlanGraph";
import { emptyAgentPlan } from "@/definition/AgentPlan";
import { withInheritedPlanTarget } from "@/definition/AgentPlanTarget";
import { localPlanModelSteps } from "./AgentPlanRemoteExecution";
import { readPlanSources } from "./AgentPlanSources";
import { readPlanHistory } from "./AgentPlanHistory";
import { withPlanProgress } from "./AgentPlanProgressView";
import { AgentPlanControlService } from "./AgentPlanControlService";
import { AgentPlanStartupRecovery } from "./recovery/AgentPlanStartupRecovery";
import { requireCompatibleFields } from "./AgentPlanGroupRuntime";
import { requireAllowedRunOptions } from "./AgentProfileValidation";
import { validatePlanReferences } from "./AgentPlanReferences";
import { requireAgentAdministrator } from "./AgentServiceAccess";
import {
  planOwnership,
  requireOwnerForProjectChange,
} from "./AgentPlanOwnership";
import { AgentPlanScripts } from "./AgentPlanScripts";
import { AgentPlanCloning } from "./AgentPlanCloning";
import { requirePlanModelResources } from "./AgentPlanModel";
import { planTaskBindings } from "./AgentPlanTaskBindings";
import type { AgentPlanRemoteExecution } from "./AgentPlanRemoteExecution";
import type { AgentPlanCloneInput } from "./AgentPlanClone";
import type { AgentPlanRemoteTargets } from "./AgentPlanRemoteTargets";
import type { AgentPlanRunJournal } from "./AgentPlanJournal";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type {
  AgentPlanRunEntry,
  AgentPlanRunRepository,
} from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentRunRecordKey } from "@/backend/database/repositories/project/ProjectDeletionFiles";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type {
  AgentPlan,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPage,
  AgentPlanRun,
  AgentPlanSources,
  AgentPlanTask,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentTaskAssignment } from "@/definition/AgentUsage";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentParameterService } from "./AgentParameterService";
import type { AgentPlanPhases } from "./AgentPlanPhases";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type { AgentPlanAccess, AgentPlanTeam } from "./AgentPlanAccess";
import type { AgentPlanPreparation } from "./AgentPlanPreparation";
import type { AgentPlanRunEngine } from "./AgentPlanRunEngine";
import type { AgentPlanSessionAccess } from "./AgentPlanSessionAccess";
import type { AgentRunArchive } from "./AgentRunArchive";

interface PlanDependencies {
  readonly remoteExecution?: AgentPlanRemoteExecution;
  readonly remoteTargets?: AgentPlanRemoteTargets;
  readonly plans: AgentPlanRepository;
  readonly runs: AgentPlanRunRepository;
  readonly workspaces: AgentWorkspaceService;
  readonly profiles: AgentProfileService;
  readonly parameters: AgentParameterService;
  readonly tasks: AgentPlanTasks;
  readonly phases: AgentPlanPhases;
  readonly access: AgentPlanAccess;
  readonly preparation: AgentPlanPreparation;
  readonly engine: AgentPlanRunEngine;
  /** Ends the MCP access of interrupted sessions; absent without plan sessions. */
  readonly sessions?: AgentPlanSessionAccess;
  /** Serves the prompts nodes were sent. */
  readonly archive?: AgentRunArchive;
  /** The interpreter profiles of script nodes; absent, no profile exists. */
  readonly scripts?: AgentPlanScripts;
}

/** Route-facing plan facade; graph, authorization and execution responsibilities stay in small services. */
export class AgentPlanService {
  private readonly dependencies: PlanDependencies;
  private readonly controls: AgentPlanControlService;
  private readonly scripts: AgentPlanScripts;

  public constructor(dependencies: PlanDependencies) {
    this.dependencies = dependencies;
    this.controls = new AgentPlanControlService(dependencies);
    this.scripts = dependencies.scripts ?? new AgentPlanScripts(null);
  }

  /**
   * Records orphaned runs as interrupted without inventing a user stop or replaying work.
   *
   * @remarks
   * Processes and MCP access that interrupted sessions left behind are ended
   * first; nothing is started again. A working copy stays reserved only while
   * a process of one of the run's sessions is still alive, so a confirmed
   * cleanup lets the next run of a plan start.
   *
   * @param retained - Sessions whose leftover cleanup could not be confirmed;
   * their runs keep the working copies reserved until a later start.
   */
  public async recoverInterruptedRuns(
    retained: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    await new AgentPlanStartupRecovery(this.dependencies).recover(retained);
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
      teamDepartmentId: (await this.dependencies.access.team(userId, null))
        .departmentId,
      plans,
      workspaces,
      remoteWorkspaces:
        (await this.dependencies.remoteTargets?.choices(userId)) ?? [],
      selected,
      sources: workspace
        ? await this.sources(userId, workspace.id)
        : { agents: [], tasks: [] },
      runs: selected ? await this.history(userId, selected.id) : [],
      control: selected ? await this.control(userId, selected.id) : undefined,
      directory: await this.dependencies.access.directory(userId),
    };
  }

  /** The source API resolves the selected workspace's current project on the server. */
  public async sources(
    userId: string,
    workspaceId: string,
  ): Promise<AgentPlanSources> {
    const workspace = await this.workspace(userId, workspaceId);
    return readPlanSources(
      { ...this.dependencies, scripts: this.scripts },
      userId,
      workspace,
    );
  }

  /**
   * Returns the agents a node of a plan in the workspace may run, as the plan page offers them.
   *
   * @throws {AgentError} `plan_access_denied` for a workspace the person cannot use for plans.
   */
  public async agents(
    userId: string,
    workspaceId: string,
  ): Promise<readonly AgentDefinitionChoice[]> {
    const workspace = await this.workspace(userId, workspaceId);
    return this.dependencies.profiles.catalog(userId, workspace.projectId);
  }

  /**
   * Checks nodes that are about to join a plan in the workspace, as a save would.
   *
   * @remarks
   * Node templates use it: agents, models, run options, group adapters and
   * referenced values must be available to the person in the workspace's
   * project now. Nothing is stored or replaced.
   *
   * @throws {AgentError} The code of the first reference that is no longer available.
   */
  public async checkNodes(
    userId: string,
    workspaceId: string,
    nodes: readonly AgentPlanNode[],
  ): Promise<void> {
    const workspace = await this.dependencies.workspaces.resolve(
      userId,
      workspaceId,
    );
    const plan = { ...emptyAgentPlan(), workspaceId, nodes };
    const pinned = await this.pinConfigurations(
      userId,
      { ...plan, projectId: workspace.projectId },
      null,
    );
    await this.dependencies.remoteTargets?.validate(userId, {
      ...pinned,
      projectId: workspace.projectId,
    });
    await validatePlanReferences(
      this.dependencies,
      userId,
      pinned,
      workspace.projectId,
    );
  }

  /** Returns the workspaces of the projects the person may open, the choices of a new plan. */
  public async workspaces(
    userId: string,
  ): Promise<readonly AgentWorkspaceChoice[]> {
    return this.dependencies.workspaces.choices(userId);
  }

  /**
   * Resolves the project and departments that decide which shared objects the person works with.
   *
   * @param userId - The signed-in person.
   * @param workspaceId - The workspace being worked in, or `null` without one.
   * @throws {AgentError} `plan_access_denied` for a workspace the person cannot use.
   */
  public async team(
    userId: string,
    workspaceId: string | null,
  ): Promise<AgentPlanTeam> {
    return this.dependencies.access.team(userId, workspaceId);
  }

  /** Lists the plans the person may read now, ordered by name. */
  public async visible(userId: string): Promise<readonly AgentPlanView[]> {
    return this.dependencies.access.list(userId);
  }

  /**
   * Returns one plan the person may read now.
   *
   * @throws {AgentError} `plan_access_denied` for a missing or hidden plan alike.
   */
  public async view(userId: string, id: string): Promise<AgentPlanView> {
    return this.dependencies.access.require(userId, id);
  }

  /** Names the groups and departments a plan share may refer to. */
  public async directory(userId: string): Promise<AgentProfileDirectory> {
    return this.dependencies.access.directory(userId);
  }

  /**
   * Lists the runs the person started of a visible plan, by start, without their results.
   *
   * @remarks
   * Only the start and the status are listed; reading a run itself still
   * needs the current access to everything it used, see {@link run}.
   * @throws {AgentError} `plan_access_denied` for a plan the person cannot read.
   */
  public async runEntries(
    userId: string,
    planId: string,
    order: "newest" | "oldest",
  ): Promise<readonly AgentPlanRunEntry[]> {
    await this.dependencies.access.require(userId, planId);
    return this.dependencies.runs.entries(userId, planId, order);
  }

  /**
   * Lists the runs the person started of each named plan they may read, newest first.
   *
   * @remarks
   * Access is resolved once for all plans; a plan the person cannot read is
   * left out of the result.
   */
  public async runOverview(
    userId: string,
    planIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly AgentPlanRunEntry[]>> {
    const visible = new Set(
      (await this.dependencies.access.list(userId)).map((plan) => plan.id),
    );
    const overview = new Map<string, readonly AgentPlanRunEntry[]>();
    for (const planId of planIds)
      if (visible.has(planId))
        overview.set(
          planId,
          await this.dependencies.runs.entries(userId, planId, "newest"),
        );
    return overview;
  }

  /**
   * Creates a plan or saves its next revision without silently rebinding nodes to another project.
   *
   * @remarks
   * The owner and the department of a plan are fixed at creation: a member or
   * leader of its team who saves it changes the same plan, and the plan stays with its
   * owner and its team.
   *
   * @param userId - The authenticated person: the creator of a new plan, or
   * its owner or a team member when `id` names a plan.
   * @param id - The plan to change, or `null` to create one.
   * @param input - The proposed plan, validated here.
   * @param journal - Runs in the transaction of the write with the plan identifier.
   * @returns The identifier of the saved plan.
   * @throws {AgentError} `plan_name_taken` when another plan of the team has
   * the name, `plan_conflict` for a stale revision.
   */
  public async save(
    userId: string,
    id: string | null,
    input: unknown,
    journal?: (
      transaction: DatabaseTransaction,
      planId: string,
    ) => Promise<void>,
  ): Promise<string> {
    const plan = await this.revise(userId, id, input);
    await this.dependencies.plans.save(
      plan,
      id === null,
      journal && ((transaction) => journal(transaction, plan.id)),
      userId,
    );
    return plan.id;
  }

  /**
   * Creates an independent complete plan under the caller's normal create rights.
   * Source revision, new graph and replay journal commit atomically; no execution is created.
   */
  public async clone(
    userId: string,
    sourceId: string,
    input: AgentPlanCloneInput,
    journal?: (
      transaction: DatabaseTransaction,
      planId: string,
    ) => Promise<void>,
  ): Promise<string> {
    return new AgentPlanCloning({
      plans: this.dependencies.plans,
      access: this.dependencies.access,
      revise: (actorId, proposed) => this.revise(actorId, null, proposed),
    }).clone(userId, sourceId, input, journal);
  }

  /**
   * Deletes a plan; only its owner may, however many people share it.
   *
   * @param userId - The authenticated requester.
   * @param id - The plan to delete.
   * @throws {AgentError} `plan_access_denied` when the plan is not visible to
   * the requester or belongs to someone else, `plan_running` while one of its
   * runs is active.
   */
  public async remove(
    userId: string,
    id: string,
    options?: {
      readonly revision: number;
      readonly journal: (transaction: DatabaseTransaction) => Promise<void>;
    },
  ): Promise<void> {
    const plan = await this.dependencies.access.require(userId, id);
    if (plan.ownerId !== userId) throw new AgentError("plan_access_denied");
    await this.dependencies.plans.remove(plan.id, userId, options);
  }

  /**
   * Play uses the saved revision and never executes an unsaved client graph.
   *
   * @remarks
   * The person who presses Play executes the run with their own access to
   * agents, models, workspaces and tickets; the owner's access never stands in.
   */
  public async play(
    userId: string,
    id: string,
    revision: number,
    journal?: AgentPlanRunJournal,
  ): Promise<AgentPlanRun> {
    const plan = await this.dependencies.access.require(userId, id);
    if (!plan.canEdit) throw new AgentError("plan_access_denied");
    if (plan.revision !== revision) throw new AgentError("plan_conflict");
    const snapshot = await this.dependencies.preparation.prepare(userId, plan);
    await this.dependencies.access.require(userId, id);
    return this.dependencies.engine.start(userId, snapshot, undefined, journal);
  }

  /**
   * Saves the edited plan as its next revision and starts exactly that revision.
   *
   * @remarks
   * The revision is prepared like any Play before anything is stored. The
   * plan and the record of the new run are then written in one transaction,
   * so a refused start leaves the plan unchanged and a refused save starts
   * nothing; the old revision is never started instead.
   *
   * @param userId - The owner or a team member, who also executes the run.
   * @param id - The plan.
   * @param input - The edited plan with the revision it was based on.
   * @returns The new run; it names the saved revision.
   * @throws {AgentError} `plan_conflict` when the plan changed since that
   * revision, `plan_run_unavailable` while a run of it is active, and every
   * refusal of {@link save} and {@link play}.
   */
  public async saveAndPlay(
    userId: string,
    id: string,
    input: unknown,
  ): Promise<AgentPlanRun> {
    const plan = await this.revise(userId, id, input);
    // The stored plan is read through the same bridge, so the snapshot is the saved revision.
    const snapshot = await this.dependencies.preparation.prepare(
      userId,
      withoutTicketFlow({ ...plan, revision: plan.revision + 1 }),
    );
    await this.dependencies.access.require(userId, id);
    return this.dependencies.engine.start(userId, snapshot, (create) =>
      this.dependencies.plans.save(plan, false, create, userId),
    );
  }

  /** Run output stays private to its executor and still requires current plan/workspace permission. */
  public async run(userId: string, id: string): Promise<AgentPlanRun> {
    const run = await this.dependencies.runs.find(id);
    if (!run || run.userId !== userId)
      throw new AgentError("plan_access_denied");
    await this.dependencies.access.require(userId, run.planId);
    const resources = await this.dependencies.runs.resources(id);
    await requirePlanModelResources(
      this.dependencies.profiles,
      userId,
      resources,
    );
    await this.dependencies.remoteExecution?.requireRead(userId, resources);
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
    if (resources.ticketAssets?.length)
      await this.dependencies.parameters.requireTicketAssets(
        userId,
        resources.ticketAssets,
      );
    return withPlanProgress(run, {
      projectId: resources.projectId,
      tasks: this.dependencies.tasks,
    });
  }

  /** Other workspace users or plan owners cannot stop an executor's private run. */
  public async stop(
    userId: string,
    id: string,
    journal?: AgentPlanRunJournal,
  ): Promise<AgentPlanRun> {
    const run = await this.run(userId, id);
    if (!(await this.dependencies.access.require(userId, run.planId)).canEdit)
      throw new AgentError("plan_access_denied");
    await this.dependencies.engine.stop(id, journal);
    return this.run(userId, id);
  }

  /** Only the executor with current plan and resource access may pause this run. */
  public async pause(
    userId: string,
    id: string,
    journal?: AgentPlanRunJournal,
  ): Promise<AgentPlanRun> {
    const run = await this.run(userId, id);
    if (!(await this.dependencies.access.require(userId, run.planId)).canEdit)
      throw new AgentError("plan_access_denied");
    await this.dependencies.engine.pause(id, journal);
    return this.run(userId, id);
  }

  /** Revalidates the saved draft and adopts it at the live run's durable pause boundary. */
  public async resume(
    userId: string,
    id: string,
    revision?: number,
    journal?: AgentPlanRunJournal,
  ): Promise<AgentPlanRun> {
    const run = await this.run(userId, id);
    const plan = await this.dependencies.access.require(userId, run.planId);
    if (!plan.canEdit) throw new AgentError("plan_access_denied");
    if (revision === undefined || plan.revision !== revision)
      throw new AgentError("plan_conflict");
    if (run.status !== "paused" || run.stopRequested)
      throw new AgentError("plan_run_unavailable");
    const control = await this.control(userId, run.planId);
    if (control.issue === "plan_continuation_deleted")
      throw new AgentError("plan_continuation_deleted");
    const snapshot = await this.dependencies.preparation.prepare(userId, plan);
    await this.run(userId, id);
    await this.dependencies.engine.resume(id, snapshot, journal);
    return this.run(userId, id);
  }

  /** Public control metadata lets shared readers see true state without disclosing run output. */
  public async control(
    userId: string,
    planId: string,
  ): Promise<AgentPlanControl> {
    return this.controls.read(userId, planId);
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

  /**
   * Stops the active runs of a project that is about to be deleted.
   *
   * @param projectId - The project whose runs end.
   * @throws {ProjectRunsActiveError} When a run does not close within a reasonable time.
   */
  public async stopProject(projectId: string): Promise<void> {
    if (!(await this.dependencies.engine.stopProject(projectId)))
      throw new ProjectRunsActiveError();
  }

  /**
   * Removes the record files of runs that were deleted with their project.
   *
   * @param keys - The agent and run of each record.
   */
  public async removeRunRecordFiles(
    keys: readonly AgentRunRecordKey[],
  ): Promise<void> {
    await this.dependencies.archive?.removeRecordFiles(keys);
  }

  /** Completes active cancellation before application shutdown closes the database. */
  public async shutdown(): Promise<void> {
    await this.dependencies.engine.shutdown();
  }

  private async workspace(
    userId: string,
    workspaceId: string,
  ): Promise<AgentWorkspaceChoice> {
    const workspace = (await this.dependencies.workspaces.choices(userId)).find(
      (entry) => entry.id === workspaceId,
    );
    if (!workspace) throw new AgentError("plan_access_denied");
    return workspace;
  }

  /**
   * Validates a proposed plan and returns it as it is stored, with the revision it was based on.
   *
   * @remarks
   * A new plan belongs to its creator and, when the creator is a member or
   * leader of exactly one department, to that department. An existing plan keeps its
   * owner and its department whoever saves it. Every team member may change
   * the workspace within the plan's project, the usage and the share, with the
   * checks the owner has; only the owner moves the plan to another project.
   *
   * @throws {AgentError} `plan_conflict` when an existing plan is no longer at that revision.
   */
  private async revise(
    userId: string,
    id: string | null,
    input: unknown,
  ): Promise<AgentPlan> {
    let proposed = withPortlessPlanGroups(readPlanInput(input));
    requireCredentialFreeText(JSON.stringify(proposed));
    const previous =
      id === null ? null : await this.dependencies.access.require(userId, id);
    if (previous && !previous.canEdit)
      throw new AgentError("plan_access_denied");
    if (previous && proposed.revision !== previous.revision)
      throw new AgentError("plan_conflict");
    // The workspace is resolved for the person who saves: the owner's access never stands in.
    const workspace = await this.dependencies.workspaces.resolve(
      userId,
      proposed.workspaceId,
    );
    if (previous)
      requireOwnerForProjectChange(userId, previous, workspace.projectId);
    if (
      proposed.projectId !== undefined &&
      proposed.projectId !== workspace.projectId
    )
      throw new AgentError("plan_context_changed");
    proposed = await this.pinConfigurations(
      userId,
      { ...proposed, projectId: workspace.projectId },
      previous,
    );
    await validatePlanReferences(
      this.dependencies,
      userId,
      proposed,
      workspace.projectId,
    );
    await this.dependencies.remoteTargets?.validate(userId, proposed);
    const plan: AgentPlan = {
      ...proposed,
      ...(await planOwnership(this.dependencies.access, userId, previous)),
      id: id ?? randomUUID(),
      projectId: workspace.projectId,
      revision: proposed.revision ?? 1,
    };
    await this.dependencies.access.validateSharing(plan);
    if (plan.nodes.some((node) => node.type === "group")) {
      const catalog = await this.dependencies.profiles.catalog(
        userId,
        plan.projectId,
      );
      if (planExecutionIssues(plan, catalog).length === 0)
        await this.dependencies.preparation.prepare(userId, plan);
    }
    return plan;
  }

  private async pinConfigurations(
    userId: string,
    plan: AgentPlanInput,
    previous: AgentPlanView | null,
  ): Promise<AgentPlanInput> {
    await this.scripts.requireProfiles(
      withInheritedPlanTarget(plan).nodes,
      previous?.nodes ?? [],
    );
    const catalog = await this.dependencies.profiles.catalog(
      userId,
      plan.projectId ?? null,
    );
    const pinned = mapPlanSteps(plan, (node) => {
      if (node.configuration) return node;
      const saved = previous
        ? allPlanSteps(previous).find((entry) => entry.id === node.id)
        : undefined;
      if (saved?.agentId === node.agentId && saved.configuration)
        return { ...node, configuration: structuredClone(saved.configuration) };
      const source = catalog.find((entry) => entry.id === node.agentId);
      return source
        ? { ...node, configuration: copyPlanConfiguration(source) }
        : node;
    });
    const groupConnections = new Map<
      string,
      Readonly<Record<string, string>>
    >();
    for (const node of await localPlanModelSteps(
      this.dependencies.remoteExecution,
      userId,
      pinned,
    )) {
      if (!node.configuration) continue;
      const resolved = await this.dependencies.profiles.resolveDefinition(
        userId,
        {
          agentId: node.agentId,
          personalAgentId: node.personalAgentId,
          projectId: plan.projectId ?? previous?.projectId ?? null,
          configuration: node.configuration,
        },
      );
      const group = pinned.nodes.find(
        (entry) =>
          entry.type === "group" &&
          entry.steps.some((step) => step.id === node.id),
      );
      if (group) {
        const fields = {
          "provider/adapter": resolved.assignment.connection.provider,
          connectionId: resolved.assignment.connection.id,
        };
        if (!isAcpProvider(fields["provider/adapter"]))
          throw new AgentPlanValidationError([
            {
              nodeId: node.id,
              port: "provider/adapter",
              reason: "groupProvider",
            },
          ]);
        requireCompatibleFields(
          node.id,
          fields,
          groupConnections.get(group.id) ?? null,
        );
        groupConnections.set(group.id, fields);
      }
      const saved = previous
        ? allPlanSteps(previous).find((entry) => entry.id === node.id)
        : undefined;
      requireAllowedRunOptions(
        resolved.assignment.connection.provider,
        node.configuration.template.run,
        saved?.configuration?.template.run,
      );
    }
    return pinned;
  }

  private async history(
    userId: string,
    planId: string,
  ): Promise<readonly AgentPlanRun[]> {
    return readPlanHistory(this, this.dependencies.runs, userId, planId);
  }
}
