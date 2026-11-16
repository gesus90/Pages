import { LOCAL_RUNNER_CONNECTION_ID } from "@/backend/service/runner/LocalRunnerIdentity";
import { withPlanReadOrigin } from "@/backend/error/AgentPlanReadDenied";

import type { AgentPlanRemoteExecution } from "./AgentPlanRemoteExecution";
import type { AgentPlanSources } from "@/definition/AgentPlan";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentPlanRemoteTargets } from "./AgentPlanRemoteTargets";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type { AgentPlanPhases } from "./AgentPlanPhases";
import type { AgentPlanScripts } from "./AgentPlanScripts";
import type { PlanDecisionModels } from "./branching/PlanDecisionModels";

interface SourceDependencies {
  readonly remoteExecution?: AgentPlanRemoteExecution;
  readonly profiles: AgentProfileService;
  readonly tasks: AgentPlanTasks;
  readonly phases: AgentPlanPhases;
  readonly scripts: AgentPlanScripts;
  readonly remoteTargets?: AgentPlanRemoteTargets;
  readonly decisionModels?: Pick<PlanDecisionModels, "list" | "defaultName">;
}

/** Reads authorized editor and tool choices without executing agents or connecting to remote hosts. */
export async function readPlanSources(
  dependencies: SourceDependencies,
  userId: string,
  workspace: AgentWorkspaceChoice,
): Promise<AgentPlanSources> {
  const [agents, tasks, phases, models, interpreters, remoteTargets] =
    await Promise.all([
      withPlanReadOrigin("source_agents", () =>
        dependencies.profiles.catalog(userId, workspace.projectId),
      ),
      withPlanReadOrigin("source_tasks", () =>
        dependencies.tasks.list(userId, workspace.projectId),
      ),
      withPlanReadOrigin("source_phases", () =>
        dependencies.phases.list(userId, workspace.projectId),
      ),
      withPlanReadOrigin("source_models", () =>
        dependencies.profiles.planModels(userId, workspace.projectId),
      ),
      dependencies.scripts.interpreters(),
      withPlanReadOrigin("source_remote_targets", async () =>
        dependencies.remoteTargets?.list(userId, workspace.projectId),
      ),
    ]);
  const remote = await withPlanReadOrigin("source_remote_execution", async () =>
    dependencies.remoteExecution?.sources(userId, workspace.projectId),
  );
  const decisions = await withPlanReadOrigin("source_models", async () =>
    readDecisionModels(dependencies, userId),
  );
  return {
    agents,
    tasks,
    phases,
    models: [...models, ...(remote?.models ?? [])],
    interpreters: [...interpreters, ...(remote?.interpreters ?? [])],
    remoteTargets: remoteTargets?.filter(
      (target) => target.connectionId !== LOCAL_RUNNER_CONNECTION_ID,
    ),
    remoteStatus: remote?.statuses,
    ...decisions,
  };
}

/** The decision models a model decision may choose and the name of the default of the instance. */
async function readDecisionModels(
  dependencies: SourceDependencies,
  userId: string,
): Promise<Pick<AgentPlanSources, "decisionModels" | "defaultDecisionModel">> {
  const models = dependencies.decisionModels;
  if (!models) return {};
  const [decisionModels, defaultDecisionModel] = await Promise.all([
    models.list(userId),
    models.defaultName(),
  ]);
  return { decisionModels, defaultDecisionModel };
}
