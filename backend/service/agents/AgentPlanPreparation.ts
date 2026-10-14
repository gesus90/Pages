import { unsupportedRunOption } from "@/backend/agents/cli/CliSessionPlans";
import { AgentError } from "@/backend/error/AgentErrors";
import { agentRunOptionsFor } from "@/definition/AgentConfiguration";
import { isApiProvider } from "@/definition/AgentConnection";
import { planExecutionIssues } from "@/definition/AgentPlanGraph";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";

import { planBindings } from "./AgentPlanBindings";
import { hasPlanPath, planSteps } from "./AgentPlanGraph";
import { planStepDirectory } from "./AgentPlanSnapshot";

import type { AgentPlan } from "@/definition/AgentPlan";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentParameterService } from "./AgentParameterService";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type {
  AgentPlanSnapshot,
  AgentPlanStepSnapshot,
} from "./AgentPlanSnapshot";

interface PreparationDependencies {
  readonly profiles: AgentProfileService;
  readonly parameters: AgentParameterService;
  readonly tasks: AgentPlanTasks;
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
    const issues = planExecutionIssues(
      plan,
      await this.dependencies.profiles.catalog(userId, plan.projectId),
    );
    if (issues.length > 0) throw new AgentPlanValidationError(issues);
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
        },
      );
      const configuration = resolved.profile.configuration;
      if (!configuration) throw new AgentError("configuration_invalid");
      const template = {
        markdown: configuration.markdown,
        parameters: configuration.parameters,
        directoryParameter: configuration.directoryParameter,
        ...(configuration.run === undefined ? {} : { run: configuration.run }),
      };
      const bindings = planBindings(
        plan,
        step,
        tasks,
        configuration.parameters,
      );
      const prepared = await this.dependencies.parameters.prepare(
        userId,
        {
          agentId: step.agentId,
          personalAgentId: step.personalAgentId,
          workspaceId: plan.workspaceId,
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
            agentRunOptionsFor(provider, configuration.run),
          );
      if (unsupported !== null) throw new AgentError(unsupported);
      const taskIds = Object.values(step.bindings).flatMap((binding) => {
        if (binding.kind !== "source") return [];
        const node = plan.nodes.find((entry) => entry.id === binding.nodeId);
        return node?.type === "task" ? [node.taskId] : [];
      });
      snapshots.push({
        step,
        name: resolved.profile.name,
        revision: resolved.profile.revision ?? 1,
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
    validateWorkingCopies(plan, snapshots);
    return { plan: structuredClone(plan), steps: structuredClone(snapshots) };
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
