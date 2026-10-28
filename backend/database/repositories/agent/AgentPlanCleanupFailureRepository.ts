import { readCleanupFailureRecord } from "@/backend/agents/AgentPlanCleanupFailureInput";
import { readTextColumn } from "@/backend/database/RowValue";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanCleanupFailureRecord } from "@/definition/AgentPlanCleanupResource";

/** Append-only cleanup failures, separate from immutable run results and release decisions. */
export class AgentPlanCleanupFailureRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Stores one authorized failed cleanup observation without changing or releasing the run. */
  public async append(
    userId: string,
    entry: AgentPlanCleanupFailureRecord,
  ): Promise<void> {
    const validated = readCleanupFailureRecord(entry);
    await this.database.execute(
      `
      INSERT INTO agent_plan_cleanup_failures (
          id, run_id, user_id, failure_json
      ) VALUES ($id, $run_id, $user_id, $failure_json);
    `,
      {
        id: validated.id,
        run_id: validated.runId,
        user_id: userId,
        failure_json: JSON.stringify(validated),
      },
    );
  }

  /** Reads the latest observation of this executor after the service's current-rights check. */
  public async latest(
    userId: string,
    runId: string,
  ): Promise<AgentPlanCleanupFailureRecord | null> {
    const [row] = await this.database.query(
      `
      SELECT failure_json
      FROM agent_plan_cleanup_failures
      WHERE run_id = $run_id
          AND user_id = $user_id
      ORDER BY sequence_number DESC
      LIMIT 1;
    `,
      { run_id: runId, user_id: userId },
    );
    if (!row) return null;
    const entry = readCleanupFailureRecord(
      JSON.parse(readTextColumn(row, 0, "failure_json")),
    );
    if (entry.runId !== runId)
      throw new AgentPlanRecoveryError("diagnostic_unavailable");
    return entry;
  }
}
