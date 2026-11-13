import { withReadScope } from "@/backend/database/ReadScope";
import { AgentError } from "@/backend/error/AgentErrors";
import { allRunAssetReferences } from "@/backend/agents/AgentPlanRunResources";
import { isPlanAdministrator } from "@/definition/AgentPlanTeam";

import { withRunCommand } from "./runs/RunCommandView";
import { withAgentTodos } from "./AgentPlanAgentTodoService";
import { withPlanProgress } from "./AgentPlanProgressView";
import { requirePlanModelResources } from "./AgentPlanModel";

import type { PlanRunEnginePort } from "./runs/PlanRunEnginePort";
import type { PlanDependencies } from "./AgentPlanService";
import type { AgentPlanRun, AgentPlanView } from "@/definition/AgentPlan";
import type { AgentPlanRunResources } from "@/backend/agents/AgentPlanRunResources";
import type { AgentTicketAsset } from "@/definition/AgentTicketParameter";

/** Read-only dependencies also used by the isolated notification consumer. No execution engine is needed. */
export type PlanRunReadDependencies = Pick<
  PlanDependencies,
  | "runs"
  | "access"
  | "profiles"
  | "workspaces"
  | "workspaceCatalog"
  | "tasks"
  | "parameters"
  | "workGate"
  | "stepProgress"
  | "agentTodos"
> & {
  readonly engine?: Pick<PlanRunEnginePort, "commandReceipt">;
  readonly remoteExecution?: Pick<
    NonNullable<PlanDependencies["remoteExecution"]>,
    "requireRead"
  > &
    Partial<
      Pick<NonNullable<PlanDependencies["remoteExecution"]>, "withProgress">
    >;
};

/**
 * Current content permissions are checked separately from ownership-only stop/reset permissions.
 *
 * @remarks
 * Every check reads the person, the plan and the resources it names; what
 * several checks ask for is answered once.
 */
export async function readAuthorizedPlanRun(
  dependencies: PlanRunReadDependencies,
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

/**
 * Requires that the person may read the run: its owner, an administrator or a reader of all runs.
 *
 * @param userId - The person who reads.
 * @param run - The stored run.
 * @param plan - The plan of the run, as the person sees it.
 * @throws {AgentError} `plan_access_denied` for anyone else.
 */
function requireRunReadPermission(
  userId: string,
  run: AgentPlanRun,
  plan: AgentPlanView,
): void {
  // An administrator reads and controls every run of a plan (PAGE-329).
  if (
    run.userId !== userId &&
    !isPlanAdministrator(plan) &&
    !plan.rights?.canReadAllRuns
  )
    throw new AgentError("plan_access_denied");
}

/**
 * Adds the live progress, the work scope, the agent todos and the command view to a run.
 *
 * @param dependencies - The read dependencies of the plan service.
 * @param run - The stored run.
 * @param resources - The resources the run used.
 * @returns The run as the person may read it.
 */
async function withRunViews(
  dependencies: PlanRunReadDependencies,
  run: AgentPlanRun,
  resources: AgentPlanRunResources,
): Promise<AgentPlanRun> {
  const progress = await withPlanProgress(run, {
    projectId: resources.projectId,
    tasks: dependencies.tasks,
    stepTickets: resources.stepTickets,
    live: await dependencies.stepProgress?.listForRun(run.id),
  });
  const scoped =
    (await dependencies.workGate?.withProgress(progress)) ?? progress;
  const progressView =
    (await dependencies.remoteExecution?.withProgress?.(scoped)) ?? scoped;
  const withTodos = withAgentTodos(
    progressView,
    (await dependencies.agentTodos?.listForRun(run.id)) ?? new Map(),
  );
  return withRunCommand(dependencies.engine, withTodos);
}

async function loadAuthorizedPlanRun(
  dependencies: PlanRunReadDependencies,
  userId: string,
  id: string,
): Promise<AgentPlanRun> {
  const run = await findPlanRun(dependencies, userId, id);
  if (!run) throw new AgentError("plan_access_denied");
  const plan = await dependencies.access.require(userId, run.planId);
  requireRunReadPermission(userId, run, plan);
  const resources = await dependencies.runs.resources(id);
  if (!plan.rights?.canReadAllRuns)
    await requirePlanRunResourceAccess(dependencies, userId, {
      resources,
      ticketAssets: allRunAssetReferences(run, resources.ticketAssets),
    });
  return withRunViews(dependencies, run, resources);
}

/**
 * Requires the current access to everything a run used, as reading its content does.
 *
 * @param dependencies - The read dependencies of the plan service.
 * @param userId - The person who reads.
 * @param used - The resources of the run and every file or ticket asset it named.
 * @throws {AgentError} The refusal of the first resource the person cannot use now.
 */
export async function requirePlanRunResourceAccess(
  dependencies: PlanRunReadDependencies,
  userId: string,
  used: {
    readonly resources: AgentPlanRunResources;
    readonly ticketAssets: readonly AgentTicketAsset[];
  },
): Promise<void> {
  const { resources, ticketAssets } = used;
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
  if (ticketAssets.length)
    await dependencies.parameters.requireTicketAssets(userId, ticketAssets);
}

async function requireRemoteRead(
  dependencies: PlanRunReadDependencies,
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
