import { withReadScope } from "@/backend/database/ReadScope";
import { AgentError } from "@/backend/error/AgentErrors";

import { readPlanHistory } from "./AgentPlanHistory";

import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { AgentPlanRemoteTargets } from "./AgentPlanRemoteTargets";
import type { AgentPlanService } from "./AgentPlanService";

/**
 * The part of the editor page that identifies catalog, access and the selected plan.
 *
 * @remarks
 * Everything except the run history and the control state, which change with
 * every run step and have their own channel.
 */
export type AgentPlanContext = Omit<AgentPlanPage, "runs" | "control">;

/** What the page loaders read beyond the service itself. */
export interface PlanPageDependencies {
  readonly service: AgentPlanService;
  readonly runs: AgentPlanRunRepository;
  readonly remoteTargets?: AgentPlanRemoteTargets;
}

/** The plan and workspace a page is asked for; `null` names none. */
export interface PlanSelection {
  readonly planId: string | null;
  readonly workspaceId: string | null;
}

/**
 * Loads authorized editor context, including a repairable plan whose registration is gone.
 *
 * @remarks
 * Its repeated reads of the person, the access and the catalog are answered once.
 */
export async function readPlanContext(
  dependencies: PlanPageDependencies,
  userId: string,
  selection: PlanSelection,
): Promise<AgentPlanContext> {
  return withReadScope(() => loadPlanContext(dependencies, userId, selection));
}

async function loadPlanContext(
  dependencies: PlanPageDependencies,
  userId: string,
  selection: PlanSelection,
): Promise<AgentPlanContext> {
  const { service } = dependencies;
  const [plans, workspaces] = await Promise.all([
    service.summaries(userId),
    service.workspaces(userId),
  ]);
  const selected =
    selection.planId === null
      ? null
      : await service.view(userId, selection.planId);
  const workspaceId = selected?.workspaceId ?? selection.workspaceId;
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  if (workspaceId !== null && !workspace && !selected?.isWorkspaceMissing)
    throw new AgentError("plan_access_denied");
  return {
    userId,
    teamDepartmentId: (await service.team(userId, null)).departmentId,
    plans,
    workspaces,
    remoteWorkspaces: (await dependencies.remoteTargets?.choices(userId)) ?? [],
    selected,
    sources: workspace
      ? await service.sources(userId, workspace.id)
      : { agents: [], tasks: [] },
    directory: await service.directory(userId),
  };
}

/** Loads the editor context together with the executor's run history and the control state. */
export async function readPlanPage(
  dependencies: PlanPageDependencies,
  userId: string,
  selection: PlanSelection,
): Promise<AgentPlanPage> {
  return withReadScope(async () => {
    const context = await loadPlanContext(dependencies, userId, selection);
    const { selected } = context;
    const { service } = dependencies;
    return {
      ...context,
      runs: selected
        ? await readPlanHistory(service, dependencies.runs, userId, selected.id)
        : [],
      control: selected
        ? await service.control(userId, selected.id)
        : undefined,
    };
  });
}
