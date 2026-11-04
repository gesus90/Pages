import { withReadScope } from "@/backend/database/ReadScope";
import { AgentError } from "@/backend/error/AgentErrors";
import { allRunAssetReferences } from "@/backend/agents/AgentPlanRunResources";
import { withPlanProgress } from "./AgentPlanProgressView";
import { requirePlanModelResources } from "./AgentPlanModel";
import type { PlanDependencies } from "./AgentPlanService";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanRunResources } from "@/backend/agents/AgentPlanRunResources";

/**
 * Current content permissions are checked separately from ownership-only stop/reset permissions.
 *
 * @remarks
 * Every check reads the person, the plan and the resources it names; what
 * several checks ask for is answered once.
 */
export async function readAuthorizedPlanRun(
  dependencies: PlanDependencies,
  userId: string,
  id: string,
): Promise<AgentPlanRun> {
  return withReadScope(() => loadAuthorizedPlanRun(dependencies, userId, id));
}

/**
 * Finds a stored run; only who may read the run learns that its record is damaged.
 *
 * @remarks
 * A damaged view cannot name its owner, so its columns decide; anyone else gets
 * the refusal of a hidden run.
 *
 * @throws {AgentError} `plan_run_unreadable` for the owner of a damaged record,
 * `plan_access_denied` for anyone else.
 */
export async function findPlanRun(
  dependencies: Pick<PlanDependencies, "runs" | "access">,
  userId: string,
  id: string,
): Promise<AgentPlanRun | null> {
  try {
    return await dependencies.runs.find(id);
  } catch (error: unknown) {
    if (!(error instanceof AgentError) || error.code !== "plan_run_unreadable")
      throw error;
    const ownership = await dependencies.runs.ownership(id);
    if (ownership?.userId !== userId)
      throw new AgentError("plan_access_denied");
    await dependencies.access.require(userId, ownership.planId);
    throw error;
  }
}

async function loadAuthorizedPlanRun(
  dependencies: PlanDependencies,
  userId: string,
  id: string,
): Promise<AgentPlanRun> {
  const run = await findPlanRun(dependencies, userId, id);
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
  // Access only: the rules for binding a ticket apply when a plan is saved or started, not to its past runs.
  for (const ticketId of new Set([
    ...resources.taskIds,
    ...resources.ticketIds,
  ]))
    await dependencies.tasks.requireReadable(userId, ticketId);
  for (const pageId of resources.wikiIds)
    await dependencies.parameters.requireWiki(userId, pageId);
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
