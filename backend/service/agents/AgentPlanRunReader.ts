import { AgentError } from "@/backend/error/AgentErrors";
import { allRunAssetReferences } from "@/backend/agents/AgentPlanRunResources";
import { withPlanProgress } from "./AgentPlanProgressView";
import { requirePlanModelResources } from "./AgentPlanModel";
import type { PlanDependencies } from "./AgentPlanService";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanRunResources } from "@/backend/agents/AgentPlanRunResources";

/** Current content permissions are checked separately from ownership-only stop/reset permissions. */
export async function readAuthorizedPlanRun(
  dependencies: PlanDependencies,
  userId: string,
  id: string,
): Promise<AgentPlanRun> {
  const run = await dependencies.runs.find(id);
  if (!run || run.userId !== userId) throw new AgentError("plan_access_denied");
  await dependencies.access.require(userId, run.planId);
  const resources = await dependencies.runs.resources(id);
  await requirePlanModelResources(dependencies.profiles, userId, resources);
  await requireRemoteRead(dependencies, userId, resources);
  // Access only: a run that started must stay readable and stoppable after its directory or link is gone.
  for (const workspaceId of resources.workspaceIds)
    await (
      dependencies.workspaceCatalog ?? dependencies.workspaces
    ).requireAccess(userId, workspaceId, resources.projectId);
  for (const taskId of resources.taskIds)
    await dependencies.tasks.snapshot(userId, resources.projectId, taskId);
  for (const pageId of resources.wikiIds)
    await dependencies.parameters.requireWiki(userId, pageId);
  for (const ticketId of resources.ticketIds)
    await dependencies.parameters.requireTicket(userId, ticketId);
  const ticketAssets = allRunAssetReferences(run, resources.ticketAssets);
  if (ticketAssets.length)
    await dependencies.parameters.requireTicketAssets(userId, ticketAssets);
  const progress = await withPlanProgress(run, {
    projectId: resources.projectId,
    tasks: dependencies.tasks,
    stepTickets: resources.stepTickets,
  });
  const scoped =
    (await dependencies.workGate?.withProgress(progress)) ?? progress;
  return dependencies.remoteExecution?.withProgress(scoped) ?? scoped;
}

async function requireRemoteRead(
  dependencies: PlanDependencies,
  userId: string,
  resources: AgentPlanRunResources,
): Promise<void> {
  const registered = await dependencies.workspaceCatalog?.registeredIds();
  await dependencies.remoteExecution?.requireRead(userId, {
    ...resources,
    remoteWorkspaceIds: resources.remoteWorkspaceIds?.filter(
      (workspaceId) => !registered || registered.has(workspaceId),
    ),
  });
}
