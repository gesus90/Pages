import { withPortlessPlanGroups } from "@/definition/AgentPlanGroupUpgrade";
import { expandPlanGroups } from "@/definition/AgentPlanGroup";
import { expandPlanLoops } from "@/definition/AgentPlanLoop";
import { unsupportedRunOption } from "@/backend/agents/cli/CliSessionPlans";
import { planStepTemplate } from "@/definition/AgentPlanConfiguration";
import { AgentError } from "@/backend/error/AgentErrors";
import { agentRunOptionsFor } from "@/definition/AgentConfiguration";
import { isApiProvider } from "@/definition/AgentConnection";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { validateGroupRuntimes } from "./AgentPlanGroupRuntime";
import { planBindings } from "./AgentPlanBindings";
import { hasPlanPath, planSteps } from "./AgentPlanGraph";
import { planStepDirectory } from "./AgentPlanSnapshot";
import { overlapsWorkspacePath } from "./AgentWorkspacePath";
import { hasRemotePlanTarget } from "./AgentPlanExecutionTargets";
import {
  planTargetIssues,
  withInheritedPlanTarget,
} from "@/definition/AgentPlanTarget";
import type {
  AgentPlanRemoteExecution,
  RemotePlanStep,
} from "./AgentPlanRemoteExecution";
import type { AgentPlanRemoteTargets } from "./AgentPlanRemoteTargets";
import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentProfile } from "@/definition/AgentProfile";
import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentParameterService } from "./AgentParameterService";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type {
  AgentPlanScriptPreparation,
  AgentPlanScriptSnapshot,
} from "./AgentPlanScriptPreparation";
import type { AgentPlanTaskSnapshot } from "./AgentPlanBindings";
import type {
  AgentPlanSnapshot,
  AgentPlanStepSnapshot,
} from "./AgentPlanSnapshot";

interface PreparationDependencies {
  readonly remoteExecution?: AgentPlanRemoteExecution;
  readonly remoteTargets?: AgentPlanRemoteTargets;
  readonly profiles: Pick<AgentProfileService, "catalog" | "resolveDefinition">;
  readonly parameters: Pick<AgentParameterService, "prepare">;
  readonly tasks: Pick<AgentPlanTasks, "snapshot">;
  readonly scripts?: Pick<AgentPlanScriptPreparation, "prepare" | "validate">;
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

/** Completes every validation before reserving directories or starting provider work. */
export class AgentPlanPreparation {
  private readonly dependencies: PreparationDependencies;

  public constructor(dependencies: PreparationDependencies) {
    this.dependencies = dependencies;
  }

  /** Checks live script start rights for the existing control panel without executing script content. */
  public async validateScripts(userId: string, plan: AgentPlan): Promise<void> {
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
   *
   * @remarks
   * Nodes without a target of their own take the plan's target here, so the
   * snapshot names the target of every node and a run keeps it, whatever
   * the plan says later. A node that cannot run on its remote target refuses
   * the start; it never runs on the Pages host instead.
   */
  public async prepare(
    userId: string,
    plan: AgentPlan,
  ): Promise<AgentPlanSnapshot> {
    plan = withInheritedPlanTarget(plan);
    this.requireRemoteSupport(plan);
    plan = withPortlessPlanGroups(plan);
    const catalog = await this.dependencies.profiles.catalog(
      userId,
      plan.projectId,
    );
    const issues = planExecutionIssues(plan, catalog);
    if (issues.length > 0) throw new AgentPlanValidationError(issues);
    const groups = plan.nodes.filter((node) => node.type === "group");
    plan = expandPlanGroups(plan);
    // The loop stays one node of the snapshot; its members are prepared like any agent.
    const loops = plan.nodes.filter((node) => node.type === "loop");
    const flat = expandPlanLoops(plan);
    const steps = planSteps(flat);
    if (
      steps.length === 0 &&
      !plan.nodes.some((node) => node.type === "script")
    )
      throw new AgentError("plan_invalid");
    const tasks = await Promise.all(
      plan.nodes.flatMap((node) =>
        node.type === "task"
          ? [
              this.dependencies.tasks.snapshot(
                userId,
                plan.projectId,
                node.taskId,
              ),
            ]
          : [],
      ),
    );
    const snapshots: AgentPlanStepSnapshot[] = [];
    const remoteSteps = await this.prepareRemote(userId, plan, tasks);
    validateRemoteWorkingCopies(plan, remoteSteps);
    const remoteTargets =
      (await this.dependencies.remoteTargets?.list(userId, plan.projectId)) ??
      [];
    const scripts = await this.prepareScripts(userId, plan, tasks);
    for (const step of steps) {
      if (step.executionTarget?.kind === "remote") continue;
      snapshots.push(
        await this.prepareStep(userId, step, {
          plan,
          flat,
          groups,
          loops,
          tasks,
          catalog,
          remoteTargets,
        }),
      );
    }
    validateGroupRuntimes(groups, snapshots);
    validateWorkingCopies(flat, snapshots);
    return structuredClone({
      plan,
      groups,
      steps: snapshots,
      remoteSteps,
      ...(scripts?.length ? { scripts } : {}),
    });
  }
  private requireRemoteSupport(plan: AgentPlan): void {
    if (!hasRemotePlanTarget(plan)) return;
    if (
      !this.dependencies.remoteExecution ||
      plan.nodes.some(
        (node) => node.type === "group" || node.type === "loop",
      ) ||
      planTargetIssues(plan).length > 0
    )
      throw new AgentError("plan_remote_unavailable");
  }

  private async prepareRemote(
    userId: string,
    plan: AgentPlan,
    tasks: readonly AgentPlanTaskSnapshot[],
  ): Promise<readonly RemotePlanStep[]> {
    const steps = [];
    for (const node of plan.nodes) {
      if (
        (node.type === "agent" || node.type === "script") &&
        node.executionTarget?.kind === "remote" &&
        this.dependencies.remoteExecution
      )
        steps.push(
          await this.dependencies.remoteExecution.prepare(
            userId,
            plan,
            node,
            tasks,
          ),
        );
    }
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
    const prepared = await this.dependencies.parameters.prepare(
      userId,
      {
        agentId: step.agentId,
        personalAgentId: step.personalAgentId,
        workspaceId: plan.workspaceId,
        configuration: step.configuration,
      },
      bindings,
      template,
    );
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
        group.steps.some((entry) => entry.id === step.id),
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
  ): Promise<readonly AgentPlanScriptSnapshot[] | undefined> {
    const scripts = await this.dependencies.scripts?.prepare(
      userId,
      plan,
      tasks,
    );
    if (plan.nodes.some((node) => node.type === "script") && !scripts)
      throw new AgentError("plan_script_interpreter_unavailable");
    return scripts;
  }
}

function requirePreparedRuntime(
  plan: AgentPlan,
  step: Pick<AgentPlanStepSnapshot, "provider" | "prepared" | "template">,
): void {
  if (step.prepared.workspace.projectId !== plan.projectId)
    throw new AgentError("plan_context_changed");
  if (isApiProvider(step.provider)) return;
  if (planStepDirectory(step) === null)
    throw new AgentError("plan_directory_required");
  const unsupported = unsupportedRunOption(
    step.provider,
    agentRunOptionsFor(step.provider, step.template.run),
  );
  if (unsupported !== null) throw new AgentError(unsupported);
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

function validateWorkingCopies(
  plan: AgentPlan,
  steps: readonly AgentPlanStepSnapshot[],
): void {
  const writing = steps.filter((step) => !isApiProvider(step.provider));
  for (const first of writing) {
    for (const second of writing) {
      if (
        first.step.id === second.step.id ||
        (first.groupId !== undefined && first.groupId === second.groupId) ||
        (first.loopId !== undefined && first.loopId === second.loopId) ||
        !sameWorkingCopy(planStepDirectory(first), planStepDirectory(second))
      )
        continue;
      if (
        !hasPlanPath(plan.edges, first.step.id, second.step.id) &&
        !hasPlanPath(plan.edges, second.step.id, first.step.id)
      )
        throw new AgentError("plan_workspace_conflict");
    }
  }
}

function sameWorkingCopy(
  first: ResolvedAgentWorkspace | null,
  second: ResolvedAgentWorkspace | null,
): boolean {
  return (
    first !== null &&
    second !== null &&
    (first.id === second.id ||
      first.directoryIdentity === second.directoryIdentity ||
      overlapsWorkspacePath(first.path, second.path))
  );
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

function validateRemoteWorkingCopies(
  plan: AgentPlan,
  steps: readonly RemotePlanStep[],
): void {
  for (const first of steps) {
    for (const second of steps) {
      if (
        first.step.id === second.step.id ||
        first.target.connectionId !== second.target.connectionId ||
        first.target.path !== second.target.path
      )
        continue;
      if (
        !hasPlanPath(plan.edges, first.step.id, second.step.id) &&
        !hasPlanPath(plan.edges, second.step.id, first.step.id)
      )
        throw new AgentError("plan_workspace_conflict");
    }
  }
}
