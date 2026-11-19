import { LOCAL_RUNNER_CONNECTION_ID } from "@/backend/service/runner/LocalRunnerIdentity";
import { withPlanReadOrigin } from "@/backend/error/AgentPlanReadDenied";
import {
  planCallableEntries,
  planEntryContract,
} from "@/definition/AgentPlanJump";
import { planStartIssues } from "@/definition/AgentPlanStart";
import { canRunPlan } from "@/definition/AgentPlanTeam";

import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentPlanRemoteExecution } from "./AgentPlanRemoteExecution";
import type { AgentPlanSources } from "@/definition/AgentPlan";
import type {
  AgentPlanCallEntry,
  AgentPlanCallTarget,
} from "@/definition/AgentPlanJump";
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
  /** Reads the plans the person may call; without it no plan is offered as a target. */
  readonly access?: Pick<AgentPlanAccess, "list">;
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
  const { access } = dependencies;
  const callTargets = access
    ? await withPlanReadOrigin("source_plans", () =>
        readCallTargets(access, userId),
      )
    : undefined;
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
    ...(callTargets ? { callTargets } : {}),
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

async function readCallTargets(
  access: Pick<AgentPlanAccess, "list">,
  userId: string,
): Promise<readonly AgentPlanCallTarget[]> {
  const plans = await access.list(userId);
  return plans.filter(canRunPlan).flatMap((plan): AgentPlanCallTarget[] => {
    const entries = planCallableEntries(plan).flatMap(
      (entry): AgentPlanCallEntry[] => {
        const contract = planEntryContract(plan, entry.id);
        if (!contract || planStartIssues(plan, entry.id).length > 0) return [];
        return [
          {
            entryNodeId: entry.id,
            entryName: contract.entryName,
            kind: contract.direction,
            inputs: contract.inputs,
            returns: contract.returns,
            hasReturnConflict: contract.hasReturnConflict,
          },
        ];
      },
    );
    return entries.length === 0
      ? []
      : [
          {
            planId: plan.id,
            planName: plan.name,
            revision: plan.revision,
            entries,
          },
        ];
  });
}
