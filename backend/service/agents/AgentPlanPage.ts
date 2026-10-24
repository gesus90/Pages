import { AgentError } from "@/backend/error/AgentErrors";

import { readPlanHistory } from "./AgentPlanHistory";

import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { AgentPlanRemoteTargets } from "./AgentPlanRemoteTargets";
import type { AgentPlanService } from "./AgentPlanService";

/** Loads authorized editor context, including a repairable plan whose registration is gone. */
export async function readPlanPage(
  dependencies: {
    readonly service: AgentPlanService;
    readonly runs: AgentPlanRunRepository;
    readonly remoteTargets?: AgentPlanRemoteTargets;
  },
  userId: string,
  selection: {
    readonly planId: string | null;
    readonly workspaceId: string | null;
  },
): Promise<AgentPlanPage> {
  const { service } = dependencies;
  const [plans, workspaces] = await Promise.all([
    service.visible(userId),
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
    runs: selected
      ? await readPlanHistory(service, dependencies.runs, userId, selected.id)
      : [],
    control: selected ? await service.control(userId, selected.id) : undefined,
    directory: await service.directory(userId),
  };
}
