import { AgentError } from "@/backend/error/AgentErrors";

import { findPlanRun } from "../AgentPlanRunReader";

import type { AgentPlanTeamRunEntry } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentRunStarter } from "@/definition/AgentRunDiagnosis";
import type { PlanDependencies } from "../AgentPlanDependencies";
import type { AgentPlanRunTeamReader } from "./AgentPlanRunTeamReader";

/**
 * The runs of a plan for everybody who may see the plan, whoever started them (PAGE-307).
 *
 * @remarks
 * Lists only; reading one run is {@link AgentPlanRunTeamReader}. Plan access
 * is checked through the same rules as the plan page.
 */
export class AgentPlanTeamRuns {
  private readonly dependencies: Pick<
    PlanDependencies,
    "access" | "runs" | "plans"
  >;
  private readonly reader: AgentPlanRunTeamReader;

  public constructor(
    dependencies: Pick<PlanDependencies, "access" | "runs" | "plans">,
    reader: AgentPlanRunTeamReader,
  ) {
    this.dependencies = dependencies;
    this.reader = reader;
  }

  /**
   * Lists every run of a plan the person may read, ordered by start.
   *
   * @throws {AgentError} `plan_access_denied` for a plan the person cannot read.
   */
  public async entries(
    userId: string,
    planId: string,
    order: "newest" | "oldest",
  ): Promise<readonly AgentPlanTeamRunEntry[]> {
    await this.dependencies.access.require(userId, planId);
    return this.dependencies.runs.teamEntries(planId, order);
  }

  /**
   * Lists the runs of each named plan the person may read, newest first.
   *
   * @remarks
   * A plan the person cannot read is left out of the result.
   */
  public async overview(
    userId: string,
    planIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly AgentPlanTeamRunEntry[]>> {
    const visible = new Set(
      (await this.dependencies.access.summaries(userId)).map((plan) => plan.id),
    );
    const overview = new Map<string, readonly AgentPlanTeamRunEntry[]>();
    for (const planId of planIds)
      if (visible.has(planId))
        overview.set(
          planId,
          await this.dependencies.runs.teamEntries(planId, "newest"),
        );
    return overview;
  }

  /** Names the people who started runs. */
  public async starters(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, AgentRunStarter>> {
    const named = await Promise.all(
      [...new Set(userIds)].map((id) => this.reader.describeStarter(id)),
    );
    return new Map(named.map((starter) => [starter.id, starter]));
  }

  /**
   * Names the plan of a run the person may see, so a client needs only the run.
   *
   * @throws {AgentError} `plan_access_denied` for a missing run and for a plan the person cannot see.
   */
  public async planOf(userId: string, runId: string): Promise<string> {
    const run = await findPlanRun(this.dependencies, userId, runId);
    if (!run) throw new AgentError("plan_access_denied");
    await this.dependencies.access.require(userId, run.planId);
    return run.planId;
  }
}
