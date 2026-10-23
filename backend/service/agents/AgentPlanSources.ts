import type { AgentPlanRemoteExecution } from "./AgentPlanRemoteExecution";
import type { AgentPlanSources } from "@/definition/AgentPlan";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentPlanRemoteTargets } from "./AgentPlanRemoteTargets";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type { AgentPlanPhases } from "./AgentPlanPhases";
import type { AgentPlanScripts } from "./AgentPlanScripts";

interface SourceDependencies {
  readonly remoteExecution?: AgentPlanRemoteExecution;
  readonly profiles: AgentProfileService;
  readonly tasks: AgentPlanTasks;
  readonly phases: AgentPlanPhases;
  readonly scripts: AgentPlanScripts;
  readonly remoteTargets?: AgentPlanRemoteTargets;
}

/** Reads authorized editor and tool choices without executing agents or connecting to remote hosts. */
export async function readPlanSources(
  dependencies: SourceDependencies,
  userId: string,
  workspace: AgentWorkspaceChoice,
): Promise<AgentPlanSources> {
  const [agents, tasks, phases, models, interpreters, remoteTargets] =
    await Promise.all([
      dependencies.profiles.catalog(userId, workspace.projectId),
      dependencies.tasks.list(userId, workspace.projectId),
      dependencies.phases.list(userId, workspace.projectId),
      dependencies.profiles.planModels(userId, workspace.projectId),
      dependencies.scripts.interpreters(),
      dependencies.remoteTargets?.list(userId, workspace.projectId),
    ]);
  const remote = await dependencies.remoteExecution?.sources(
    userId,
    workspace.projectId,
  );
  return {
    agents,
    tasks,
    phases,
    models: [...models, ...(remote?.models ?? [])],
    interpreters: [...interpreters, ...(remote?.interpreters ?? [])],
    remoteTargets,
    remoteStatus: remote?.statuses,
  };
}
