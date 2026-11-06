import { withReadScope } from "@/backend/database/ReadScope";

import { isPlanHistoryReadFailure } from "./AgentPlanControlAccess";
import { requirePlanRunResourceAccess } from "./AgentPlanRunReader";

import type { PlanRunReadDependencies } from "./AgentPlanRunReader";
import type { AgentPlanRunVisibilityBasis } from "@/backend/database/repositories/agent/AgentPlanRunVisibilityRepository";
import type { AgentPlanRunSummary } from "@/definition/AgentPlan";
import type { AgentTicketAsset } from "@/definition/AgentTicketParameter";

/** The assets a run used, as reading the run checks them: pinned ones first, each once. */
function usedAssets(
  used: NonNullable<AgentPlanRunVisibilityBasis["used"]>,
): readonly AgentTicketAsset[] {
  const assets = new Map<string, AgentTicketAsset>();
  for (const asset of [
    ...(used.resources.ticketAssets ?? []),
    ...used.viewAssets,
  ])
    assets.set(`${asset.source}:${asset.id}`, asset);
  return [...assets.values()];
}

/**
 * Lists the executor's runs of a plan whose content the person may read now, by start and status only.
 *
 * @remarks
 * A run is listed exactly when reading it in full would pass the same
 * resource checks: its agents and connections, remote target, workspaces,
 * tickets, wiki pages and file assets. Runs that use the same resources are
 * checked once, and no snapshot or result is loaded for the decision.
 *
 * @throws {AgentError} `plan_access_denied` for a plan the person cannot read.
 */
export async function readVisiblePlanRuns(
  dependencies: PlanRunReadDependencies,
  userId: string,
  planId: string,
): Promise<readonly AgentPlanRunSummary[]> {
  return withReadScope(async () => {
    await dependencies.access.require(userId, planId);
    const bases = await dependencies.runs.visibilityBases(userId, planId);
    const decided = new Map<string, boolean>();
    const visible: AgentPlanRunSummary[] = [];
    for (const basis of bases) {
      if (!basis.used) continue;
      const used = {
        resources: basis.used.resources,
        ticketAssets: usedAssets(basis.used),
      };
      const key = JSON.stringify(used);
      let isReadable = decided.get(key);
      if (isReadable === undefined) {
        isReadable = await mayRead(dependencies, userId, used);
        decided.set(key, isReadable);
      }
      if (isReadable)
        visible.push({
          id: basis.id,
          startedAt: basis.startedAt,
          status: basis.status,
        });
    }
    return visible;
  });
}

async function mayRead(
  dependencies: PlanRunReadDependencies,
  userId: string,
  used: Parameters<typeof requirePlanRunResourceAccess>[2],
): Promise<boolean> {
  try {
    await requirePlanRunResourceAccess(dependencies, userId, used);
    return true;
  } catch (error: unknown) {
    if (!isPlanHistoryReadFailure(error)) throw error;
    return false;
  }
}

/** The run history of the plan page: the runs the person may read, without their content. */
export class AgentPlanRunHistoryService {
  private readonly dependencies: PlanRunReadDependencies;

  /**
   * Creates the history over the read dependencies of the plan service.
   *
   * @param dependencies - Plan rights, run storage and the checks of a run.
   */
  public constructor(dependencies: PlanRunReadDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Lists the executor's readable runs of a plan, newest first, by start and status.
   *
   * @throws {AgentError} `plan_access_denied` for a plan the person cannot read.
   */
  public async visibleRuns(
    userId: string,
    planId: string,
  ): Promise<readonly AgentPlanRunSummary[]> {
    return readVisiblePlanRuns(this.dependencies, userId, planId);
  }
}
