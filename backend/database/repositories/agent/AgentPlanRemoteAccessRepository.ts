import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";
import type { PlanRemoteAccess } from "@/definition/AgentPlanRemoteAccess";

/** Appends safe remote access evidence to the existing run view, serialized with progress writes. */
export class AgentPlanRemoteAccessRepository {
  private readonly database: Pick<Database, "transaction">;

  public constructor(database: Pick<Database, "transaction">) {
    this.database = database;
  }

  /** Updates only one matching attempt; stale or terminal attempts cannot acquire access again. */
  public async write(
    runId: string,
    attemptId: string,
    update: (previous: PlanRemoteAccess | undefined) => PlanRemoteAccess,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [row] = await transaction.query(
        "SELECT view_json FROM agent_plan_runs WHERE id = $id;",
        { id: runId },
      );
      if (!row) throw new Error("Remote run missing");
      const run = readPlanRun(JSON.parse(readTextColumn(row, 0, "view_json")));
      const steps = run.steps.map((step) =>
        step.execution?.attemptId === attemptId
          ? { ...step, resourceAccess: update(step.resourceAccess) }
          : step,
      );
      await transaction.execute(
        "UPDATE agent_plan_runs SET view_json = $view_json WHERE id = $id;",
        { id: runId, view_json: JSON.stringify({ ...run, steps }) },
      );
    });
  }
}
