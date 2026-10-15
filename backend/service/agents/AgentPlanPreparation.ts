import { expandPlanGroups } from "@/definition/AgentPlanGroup";
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

import type { AgentProfile } from "@/definition/AgentProfile";
import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentParameterService } from "./AgentParameterService";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type {
  AgentPlanSnapshot,
  AgentPlanStepSnapshot,
} from "./AgentPlanSnapshot";

interface PreparationDependencies {
  readonly profiles: Pick<AgentProfileService, "catalog" | "resolveDefinition">;
  readonly parameters: Pick<AgentParameterService, "prepare">;
  readonly tasks: Pick<AgentPlanTasks, "snapshot">;
}

/** Completes every validation before reserving directories or starting provider work. */
export class AgentPlanPreparation {
  private readonly dependencies: PreparationDependencies;

  public constructor(dependencies: PreparationDependencies) {
    this.dependencies = dependencies;
  }

  /** Freezes definitions, values, resource revisions and graph order, while excluding credentials. */
  public async prepare(
    userId: string,
    plan: AgentPlan,
  ): Promise<AgentPlanSnapshot> {
    const catalog = await this.dependencies.profiles.catalog(
      userId,
      plan.projectId,
    );
    const issues = planExecutionIssues(plan, catalog);
    if (issues.length > 0) throw new AgentPlanValidationError(issues);
    const groups = plan.nodes.filter((node) => node.type === "group");
    plan = expandPlanGroups(plan);
    const steps = planSteps(plan);
    if (steps.length === 0) throw new AgentError("plan_invalid");
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
    for (const step of steps) {
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
      const bindings = planBindings(plan, step, tasks, template.parameters);
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
      if (prepared.workspace.projectId !== plan.projectId)
        throw new AgentError("plan_context_changed");
      const { provider } = resolved.assignment.connection;
      if (
        !isApiProvider(provider) &&
        planStepDirectory({ provider, prepared }) === null
      )
        throw new AgentError("plan_directory_required");
      // Options the runner cannot enforce stop the whole plan before any node starts.
      const unsupported = isApiProvider(provider)
        ? null
        : unsupportedRunOption(
            provider,
            agentRunOptionsFor(provider, template.run),
          );
      if (unsupported !== null) throw new AgentError(unsupported);
      const taskIds = Object.values(step.bindings).flatMap((binding) => {
        if (binding.kind !== "source") return [];
        const node = plan.nodes.find((entry) => entry.id === binding.nodeId);
        return node?.type === "task" ? [node.taskId] : [];
      });
      snapshots.push({
        step,
        groupId: groups.find((group) =>
          group.steps.some((entry) => entry.id === step.id),
        )?.id,
        connectionId: resolved.assignment.connection.id,
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
      });
    }
    validateGroupRuntimes(groups, snapshots);
    validateWorkingCopies(plan, snapshots);
    return {
      plan: structuredClone(plan),
      groups: structuredClone(groups),
      steps: structuredClone(snapshots),
    };
  }
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
      first.path === second.path)
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
