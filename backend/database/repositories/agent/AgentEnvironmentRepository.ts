import { purgeObsoletePlanRuns } from "./AgentPlanRunPurge";
import { SETTLED_PLAN_RUN } from "./AgentPlanRunRetention";

import type { Database } from "@/backend/database/Database";

/** Whether a plan's transcript directories can be emptied or removed. */
export type PlanHomeDisposition = "keep" | "empty" | "remove";

/** Persistence decisions for maintenance; nonterminal sessions and outstanding resources stay protected. */
export class AgentEnvironmentRepository {
  private readonly database: Pick<Database, "transaction" | "query">;

  public constructor(database: Pick<Database, "transaction" | "query">) {
    this.database = database;
  }

  /** Removes one bounded batch of settled runs whose plan is gone or which have a newer run. */
  public async purgeObsoleteRuns(): Promise<void> {
    await purgeObsoletePlanRuns(this.database);
  }

  /** Includes durable owners and chat sessions in other Pages processes. */
  public async hasActiveWorkers(): Promise<boolean> {
    const rows = await this.database.query(
      "SELECT instance_id FROM acp_resource_leases LIMIT 1;",
    );
    return rows.length > 0;
  }

  /** Holds the plan lock through deletion, excluding a concurrent new run. */
  public async maintainPlan(
    planId: string,
    maintain: (disposition: PlanHomeDisposition) => Promise<void>,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const plans = await transaction.query(
        "SELECT id FROM agent_plans WHERE id = $plan_id FOR UPDATE;",
        { plan_id: planId },
      );
      const busy = await transaction.query(
        `
        SELECT runs.id
        FROM agent_plan_runs AS runs
        WHERE runs.plan_id = $plan_id
            AND (
                NOT (${SETTLED_PLAN_RUN})
            );
      `,
        { plan_id: planId },
      );
      if (busy.length > 0) return;
      await maintain(plans.length === 0 ? "remove" : "empty");
    });
  }

  /** A legacy run folder is removable only after the run is terminal and its resources have settled. */
  public async canRemoveRun(runId: string): Promise<boolean> {
    const rows = await this.database.query(
      `
      SELECT runs.id
      FROM agent_plan_runs AS runs
      WHERE runs.id = $run_id
          AND NOT (${SETTLED_PLAN_RUN})
      UNION ALL
      SELECT run_id FROM acp_resource_leases WHERE run_id = $run_id
      UNION ALL
      SELECT run_id FROM agent_local_session_owners WHERE run_id = $run_id AND released_at IS NULL
      UNION ALL
      SELECT run_id FROM agent_plan_workspace_locks WHERE run_id = $run_id
      UNION ALL
      SELECT run_id FROM agent_workspace_cleanup WHERE run_id = $run_id AND state = 'pending'
      UNION ALL
      SELECT run_id FROM plan_run_api_cleanup WHERE run_id = $run_id
      UNION ALL
      SELECT run_id FROM plan_run_commands WHERE run_id = $run_id AND status = 'accepted';
    `,
      { run_id: runId },
    );
    return rows.length === 0;
  }
}
