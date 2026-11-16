import { planGroupAgents } from "@/definition/AgentPlanGroupLoop";
import { withPortlessPlanGroups } from "@/definition/AgentPlanGroupUpgrade";
import { expandPlanGroups } from "@/definition/AgentPlanGroup";
import {
  expandPlanLoops,
  planLoopEdges,
  planLoopDecisions,
  planLoopGroups,
  planLoopMembers,
} from "@/definition/AgentPlanLoop";
import { unsupportedRunOption } from "@/backend/agents/cli/CliSessionPlans";
import { planStepTemplate } from "@/definition/AgentPlanConfiguration";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanWorkspaceConflictError } from "@/backend/error/AgentPlanWorkspaceConflictError";
import {
  agentRunOptionsFor,
  isAcpProvider,
} from "@/definition/AgentConfiguration";
import { executablePlan, planStartIssues } from "@/definition/AgentPlanStart";
import {
  allPlanDecisions,
  planDecisionMode,
} from "@/definition/AgentPlanDecision";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import {
  planTargetIssues,
  withInheritedPlanTarget,
} from "@/definition/AgentPlanTarget";

import { remoteWorkspaceKeys } from "./AgentPlanRemoteWorkspaceKey";
import { remoteSessionSnapshot } from "./AgentPlanRemoteSession";
import { validateGroupRuntimes } from "./AgentPlanGroupRuntime";
import { AgentPlanPreparationFailures } from "./AgentPlanPreparationFailures";
import { remoteReferenceIssues } from "./AgentPlanReferences";
import { planBindings } from "./AgentPlanBindings";
import { arePlanNodesOrdered, planSteps } from "./AgentPlanGraph";
import { planStepDirectory } from "./AgentPlanSnapshot";
import { validatePlanWorkingCopies } from "./AgentPlanWorkingCopies";
import {
  hasRemotePlanTarget,
  remotePlanWorkspaceIds,
} from "./AgentPlanExecutionTargets";
import {
  remoteWorkspaceEntry,
  workspaceConflict,
} from "./AgentPlanWorkspaceConflict";

import type {
  AgentPlanRemoteExecution,
  RemotePlanStep,
} from "./AgentPlanRemoteExecution";
import type { AgentPlanRemoteTargets } from "./AgentPlanRemoteTargets";
import type { AgentPlanWorkspaces } from "./AgentPlanWorkspaces";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentProfile } from "@/definition/AgentProfile";
import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentParameterService } from "./AgentParameterService";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type {
  AgentPlanScriptPreparation,
  AgentPlanScriptSnapshot,
} from "./AgentPlanScriptPreparation";
import type { AgentPlanTaskSnapshot } from "./AgentPlanBindings";
import type { PlanAssetService } from "./assets/PlanAssetService";
import type { PlanDecisionModels } from "./branching/PlanDecisionModels";
import type {
  AgentPlanSnapshot,
  AgentPlanStepSnapshot,
} from "./AgentPlanSnapshot";

interface PreparationDependencies {
  readonly workspaceCatalog?: AgentPlanWorkspaces;
  readonly remoteExecution?: AgentPlanRemoteExecution;
  readonly remoteTargets?: AgentPlanRemoteTargets;
  readonly profiles: Pick<AgentProfileService, "catalog" | "resolveDefinition">;
  readonly parameters: Pick<AgentParameterService, "prepare">;
  readonly tasks: Pick<AgentPlanTasks, "snapshot">;
  readonly scripts?: Pick<AgentPlanScriptPreparation, "prepare" | "validate">;
  /** Reads the file of every connected asset node before the run starts. */
  readonly planAssets?: Pick<
    PlanAssetService,
    "describe" | "read" | "isReadable"
  >;
  /** Whether the instance has a decision model for decisions without one of their own. */
  readonly decisionModels?: Pick<PlanDecisionModels, "hasDefault">;
}

interface StepPreparationContext {
  readonly plan: AgentPlan;
  readonly flat: AgentPlan;
  readonly groups: readonly AgentPlanGroup[];
  readonly loops: readonly AgentPlanLoop[];
  readonly tasks: readonly AgentPlanTaskSnapshot[];
  readonly catalog: readonly AgentDefinitionChoice[];
  readonly remoteTargets: readonly AgentPlanRemoteTarget[];
}

/** Freezes the executable path; incomplete node configuration is deferred to dispatch. */
export class AgentPlanPreparation {
  private readonly dependencies: PreparationDependencies;

  public constructor(dependencies: PreparationDependencies) {
    this.dependencies = dependencies;
  }

  /** Checks live script start rights for the existing control panel without executing script content. */
  public async validateScripts(userId: string, plan: AgentPlan): Promise<void> {
    plan = executablePlan(plan);
    if (hasRemotePlanTarget(plan)) {
      await this.prepare(userId, plan);
      return;
    }
    await this.dependencies.scripts?.validate(
      userId,
      withInheritedPlanTarget(plan),
    );
  }

  /**
   * Freezes definitions, values, resource revisions and graph order, while excluding credentials.
   * @remarks
   * Nodes without a target of their own take the plan's target here, so the
   * snapshot names the target of every node and a run keeps it, whatever
   * the plan says later. A node that cannot run on its remote target fails
   * at dispatch; it never runs on the Pages host instead.
   */
  public async prepare(
    userId: string,
    plan: AgentPlan,
  ): Promise<AgentPlanSnapshot> {
    const issues = planStartIssues(plan);
    if (issues.length > 0) throw new AgentPlanValidationError(issues);
    plan = executablePlan(plan);
    await this.requireDecisionModels(plan);
    const failures = new AgentPlanPreparationFailures();
    await this.dependencies.workspaceCatalog?.resolve(userId, plan);
    plan = withInheritedPlanTarget(plan);
    await failures.capture(
      expandPlanLoops(expandPlanGroups(plan))
        .nodes.filter(
          (node) =>
            "executionTarget" in node &&
            node.executionTarget?.kind === "remote",
        )
        .map((node) => node.id),
      () => this.requireRemoteSupport(userId, plan),
    );
    plan = withPortlessPlanGroups(plan);
    const catalog = await this.dependencies.profiles.catalog(
      userId,
      plan.projectId,
    );
    const groups = [
      ...plan.nodes.filter((node) => node.type === "group"),
      ...plan.nodes.flatMap((node) =>
        node.type === "loop" ? planLoopGroups(node) : [],
      ),
    ];
    plan = flattenPlanLoopGroups(expandPlanGroups(plan));
    // The loop stays one node of the snapshot; its members are prepared like any agent.
    const loops = plan.nodes.filter((node) => node.type === "loop");
    const flat = expandPlanLoops(plan);
    const steps = planSteps(flat);
    const { tasks, issues: referenceIssues } = await this.readTasks(
      userId,
      plan,
    );
    const snapshots: AgentPlanStepSnapshot[] = [];
    const remoteSteps = await this.prepareRemote(userId, plan, {
      tasks,
      issues: referenceIssues,
      failures,
    });
    const remoteTargets =
      (await this.dependencies.remoteTargets?.list(userId, plan.projectId)) ??
      [];
    const scripts = [
      ...((await this.prepareScripts(userId, flat, tasks, failures)) ?? []),
      ...remoteScriptSnapshots(remoteSteps, plan),
    ];
    for (const step of steps) {
      if (step.executionTarget?.kind === "remote") {
        const remote = remoteSteps.find((entry) => entry.step.id === step.id);
        if (remote)
          snapshots.push(
            remoteSessionSnapshot(remote, plan, {
              groupId: groups.find((group) =>
                planGroupAgents(group).some((member) => member.id === step.id),
              )?.id,
              ...loopMembership(loops, step),
            }),
          );
        continue;
      }
      const prepared = await failures.capture(step.id, () =>
        this.prepareStep(userId, step, {
          plan,
          flat,
          groups,
          loops,
          tasks,
          catalog,
          remoteTargets,
        }),
      );
      if (prepared) snapshots.push(prepared);
    }
    return this.finish(
      { plan, groups, steps: snapshots, remoteSteps, scripts },
      {
        flat,
        failures,
      },
    );
  }

  private async finish(
    snapshot: AgentPlanSnapshot,
    context: {
      readonly flat: AgentPlan;
      readonly failures: AgentPlanPreparationFailures;
    },
  ): Promise<AgentPlanSnapshot> {
    for (const group of snapshot.groups ?? [])
      await context.failures.capture(group.id, async () =>
        validateGroupRuntimes([group], snapshot.steps),
      );
    await context.failures.capture([], async () =>
      validatePlanWorkingCopies(
        context.flat,
        snapshot.steps.filter((step) => !step.remoteTarget),
        (snapshot.scripts ?? []).filter(
          (script) => script.step.executionTarget?.kind !== "remote",
        ),
      ),
    );
    await context.failures.capture([], async () =>
      validateRemoteWorkingCopies(
        context.flat,
        snapshot.remoteSteps ?? [],
        snapshot.steps,
      ),
    );
    return structuredClone({
      ...snapshot,
      runnerProtocolVersion: 1,
      preparationFailures: context.failures.snapshot(),
    });
  }
  /**
   * A model decision without a model of its own asks the decision model of
   * the instance; without either, the plan does not start and the check
   * names the decision.
   */
  private async requireDecisionModels(plan: AgentPlan): Promise<void> {
    const models = this.dependencies.decisionModels;
    if (!models) return;
    const unset = allPlanDecisions(plan).filter(
      (decision) =>
        planDecisionMode(decision) === "model" && decision.model === undefined,
    );
    if (unset.length === 0 || (await models.hasDefault())) return;
    throw new AgentPlanValidationError(
      unset.map((decision): AgentPlanIssue => ({
        nodeId: decision.id,
        port: "model",
        reason: "decisionModel",
      })),
    );
  }

  private async requireRemoteSupport(
    userId: string,
    plan: AgentPlan,
  ): Promise<void> {
    if (!hasRemotePlanTarget(plan)) return;
    if (!this.dependencies.remoteExecution)
      throw new AgentError("plan_remote_unavailable");
    const sources = await this.dependencies.remoteExecution.sources(
      userId,
      plan.projectId,
      remotePlanWorkspaceIds(plan),
    );
    const issues = planTargetIssues(plan, sources.statuses).map((issue) => ({
      nodeId: issue.nodeId,
      port: issue.port ?? null,
      reason: issue.problem,
    }));
    if (issues.length) throw new AgentPlanValidationError(issues);
  }

  private async readTasks(
    userId: string,
    plan: AgentPlan,
  ): Promise<{
    readonly tasks: readonly AgentPlanTaskSnapshot[];
    readonly issues: readonly AgentPlanIssue[];
  }> {
    const issues: AgentPlanIssue[] = [];
    const tasks = await Promise.all(
      planTaskNodes(plan).flatMap((node) =>
        node.type === "task"
          ? [
              this.dependencies.tasks
                .snapshot(userId, plan.projectId, node.taskId)
                .catch((error: unknown) => {
                  const referenceIssues = remoteReferenceIssues(
                    plan,
                    node,
                    error,
                  );
                  if (referenceIssues.length === 0) throw error;
                  issues.push(...referenceIssues);
                  return null;
                }),
            ]
          : [],
      ),
    );
    return { tasks: tasks.filter((task) => task !== null), issues };
  }

  private async prepareRemote(
    userId: string,
    plan: AgentPlan,
    context: {
      readonly tasks: readonly AgentPlanTaskSnapshot[];
      readonly issues: readonly AgentPlanIssue[];
      readonly failures: AgentPlanPreparationFailures;
    },
  ): Promise<readonly RemotePlanStep[]> {
    const steps: RemotePlanStep[] = [];
    const issues = [...context.issues];
    for (const node of expandPlanLoops(plan).nodes) {
      if (
        (node.type !== "agent" && node.type !== "script") ||
        (node.type === "script" && node.disabled) ||
        node.executionTarget?.kind !== "remote" ||
        !this.dependencies.remoteExecution
      )
        continue;
      const remoteExecution = this.dependencies.remoteExecution;
      const prepared = await context.failures.capture(node.id, () =>
        remoteExecution.prepare(
          userId,
          { ...plan, nodes: expandPlanLoops(plan).nodes },
          node,
          context.tasks,
        ),
      );
      if (prepared) steps.push(prepared);
    }
    if (issues.length)
      await context.failures.capture([], async () => {
        throw new AgentPlanValidationError(issues);
      });
    return steps;
  }

  private async prepareStep(
    userId: string,
    step: AgentPlanStep,
    context: StepPreparationContext,
  ): Promise<AgentPlanStepSnapshot> {
    const { plan, flat, groups, loops, tasks, catalog, remoteTargets } =
      context;
    const resolved = await this.dependencies.profiles.resolveDefinition(
      userId,
      {
        agentId: step.agentId,
        personalAgentId: step.personalAgentId,
        projectId: plan.projectId,
        configuration: step.configuration,
      },
    );
    const template = planStepTemplate(step, catalog);
    if (!template) throw new AgentError("configuration_invalid");
    const bindings = planBindings(flat, step, tasks, template.parameters);
    const prepared = await this.dependencies.parameters
      .prepare(
        userId,
        {
          agentId: step.agentId,
          personalAgentId: step.personalAgentId,
          workspaceId: plan.workspaceId,
          configuration: step.configuration,
        },
        bindings,
        template,
      )
      .catch((error: unknown) => {
        const issues = remoteReferenceIssues(plan, step, error);
        if (issues.length) throw new AgentPlanValidationError(issues);
        throw error;
      });
    const { provider } = resolved.assignment.connection;
    requirePreparedRuntime(plan, { provider, prepared, template });
    const taskIds = Object.values(step.bindings).flatMap((binding) => {
      if (binding.kind !== "source") return [];
      const node = flat.nodes.find((entry) => entry.id === binding.nodeId);
      return node?.type === "task" ? [node.taskId] : [];
    });
    const target = step.executionTarget;
    const remoteTarget =
      target?.kind === "remote"
        ? remoteTargets.find(
            (entry) => entry.workspaceId === target.workspaceId,
          )
        : undefined;
    if (target?.kind === "remote" && !remoteTarget)
      throw new AgentError("plan_access_denied");
    return {
      ...(remoteTarget ? { remoteTarget } : {}),
      step,
      groupId: groups.find((group) =>
        planGroupAgents(group).some((entry) => entry.id === step.id),
      )?.id,
      ...loopMembership(loops, step),
      connectionId: resolved.assignment.connection.id,
      connectionName: resolved.assignment.connection.name,
      ...stepOrigin(step, resolved.profile),
      template,
      provider: resolved.assignment.connection.provider,
      model: resolved.assignment.model,
      reasoningEffort: resolved.assignment.reasoningEffort,
      prepared,
      taskIds,
      taskVersions: Object.fromEntries(
        tasks
          .filter((task) => taskIds.includes(task.id))
          .map((task) => [task.id, task.version]),
      ),
    };
  }
  private async prepareScripts(
    userId: string,
    plan: AgentPlan,
    tasks: readonly AgentPlanTaskSnapshot[],
    failures: AgentPlanPreparationFailures,
  ): Promise<readonly AgentPlanScriptSnapshot[] | undefined> {
    const scripts: AgentPlanScriptSnapshot[] = [];
    for (const node of plan.nodes.filter(isEnabledScriptRuntimeNode)) {
      const prepared = await failures.capture(node.id, async () => {
        if (!this.dependencies.scripts)
          throw new AgentError("plan_script_interpreter_unavailable");
        return this.dependencies.scripts.prepare(
          userId,
          {
            ...plan,
            nodes: plan.nodes.filter(
              (entry) => entry.type !== "script" || entry.id === node.id,
            ),
          },
          tasks,
        );
      });
      if (prepared) scripts.push(...prepared);
    }
    return scripts;
  }
}

/** A disabled script never starts a process, so it needs no interpreter snapshot. */
function isEnabledScriptRuntimeNode(node: AgentPlan["nodes"][number]): boolean {
  return node.type === "script" && !node.disabled;
}

function requirePreparedRuntime(
  plan: AgentPlan,
  step: Pick<AgentPlanStepSnapshot, "provider" | "prepared" | "template">,
): void {
  if (step.prepared.workspace.projectId !== plan.projectId)
    throw new AgentError("plan_context_changed");
  if (!isAcpProvider(step.provider)) return;
  if (planStepDirectory(step) === null)
    throw new AgentError("plan_directory_required");
  const unsupported = unsupportedRunOption(
    step.provider,
    agentRunOptionsFor(step.provider, step.template.run),
  );
  if (unsupported !== null) throw new AgentError(unsupported);
}

/**
 * The ticket nodes of a plan, the ticket entries of its stacks included.
 * @remarks
 * Every ticket a stack may hand over is read with the executor's rights
 * before the run starts, so a ticket the executor cannot see refuses the
 * start instead of failing a later iteration.
 */
function planTaskNodes(plan: AgentPlan): readonly AgentPlan["nodes"][number][] {
  return plan.nodes.flatMap((node): readonly AgentPlan["nodes"][number][] => {
    if (node.type !== "stack") return [node];
    return node.entries.flatMap((entry) =>
      entry.type === "task"
        ? [{ id: entry.id, type: "task", taskId: entry.taskId, x: 0, y: 0 }]
        : [],
    );
  });
}

/**
 * The plan with the groups inside its loops dissolved into their agents.
 * @remarks
 * The snapshot keeps each loop as one node of agents and scripts with their
 * edges, the edges inside its groups included; which agents share a session
 * is kept in the snapshot's groups, so their members still take turns in one
 * session.
 */
function flattenPlanLoopGroups(plan: AgentPlan): AgentPlan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) =>
      node.type === "loop" && planLoopGroups(node).length > 0
        ? {
            ...node,
            steps: planLoopMembers(node),
            edges: planLoopEdges(node),
            // A decision inside such a group decides in the iteration like one of the loop.
            ...(planLoopDecisions(node).length > 0
              ? { decisions: planLoopDecisions(node) }
              : {}),
          }
        : node,
    ),
  };
}

function loopMembership(
  loops: readonly AgentPlanLoop[],
  step: AgentPlanStep,
): { readonly loopId?: string } {
  const loop = loops.find((entry) =>
    entry.steps.some((member) => member.id === step.id),
  );
  return loop ? { loopId: loop.id } : {};
}

function stepOrigin(
  step: AgentPlanStep,
  profile: AgentProfile,
): { name: string; revision: number } {
  return {
    name: step.configuration?.name ?? profile.name,
    revision: step.configuration?.revision ?? profile.revision ?? 1,
  };
}

/** Rejects unordered remote writers with the same registered connection or pinned host and path. */
export function validateRemoteWorkingCopies(
  plan: AgentPlan,
  steps: readonly RemotePlanStep[],
  agents: readonly AgentPlanStepSnapshot[] = [],
): void {
  for (const first of steps) {
    for (const second of steps) {
      if (
        first.step.id === second.step.id ||
        sameRunnerGroup(first.step.id, second.step.id, agents) ||
        !remoteWorkspaceKeys(first.target).some((key) =>
          remoteWorkspaceKeys(second.target).includes(key),
        )
      )
        continue;
      if (!arePlanNodesOrdered(plan.edges, first.step.id, second.step.id))
        throw new AgentPlanWorkspaceConflictError(
          workspaceConflict("parallel_writers", [
            remoteWorkspaceEntry(first),
            remoteWorkspaceEntry(second),
          ]),
        );
    }
  }
}

function sameRunnerGroup(
  firstId: string,
  secondId: string,
  agents: readonly AgentPlanStepSnapshot[],
): boolean {
  const first = agents.find((entry) => entry.step.id === firstId)?.groupId;
  return (
    first !== undefined &&
    first === agents.find((entry) => entry.step.id === secondId)?.groupId
  );
}

function remoteScriptSnapshots(
  remoteSteps: readonly RemotePlanStep[],
  plan: AgentPlan,
): AgentPlanScriptSnapshot[] {
  const scripts: AgentPlanScriptSnapshot[] = [];
  for (const remote of remoteSteps) {
    if (
      remote.step.type !== "script" ||
      remote.command.program.kind !== "script"
    )
      continue;
    scripts.push({
      step: remote.step,
      interpreter: remote.command.program.interpreter,
      workspace: {
        id: remote.target.workspaceId,
        path: remote.target.path,
        revision: remote.target.workspaceRevision,
        directoryIdentity: `${remote.target.connectionId}:${remote.target.workspaceRevision}`,
        projectId: plan.projectId,
        github: null,
      },
      inputs: remote.inputs,
      taskIds: [],
    });
  }
  return scripts;
}
