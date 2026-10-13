import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import {
  readArchiveSteps,
  readPageAgentRecord,
} from "@/backend/agents/PageAgentRecordInput";
import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";
import type { PageAgentRunRecord } from "@/definition/PageAgent";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { ArchiveAgentStep } from "@/backend/agents/PageAgentRecordInput";

/** Durable, idempotent outbox; file failures are recoverable without rerunning a model. */
export class PageAgentRunRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Pins the fully rendered input before any provider starts. */
  public async input(
    planRunId: string,
    stepId: string,
    prompt: string,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO page_agent_run_inputs (plan_run_id, step_id, prompt)
      VALUES ($plan_run_id, $step_id, $prompt)
      ON CONFLICT DO NOTHING;
    `,
      { plan_run_id: planRunId, step_id: stepId, prompt },
    );
  }

  /** Recovery uses the exact dispatched prompt when execution reached the start boundary. */
  public async prompt(
    planRunId: string,
    stepId: string,
  ): Promise<string | null> {
    const [row] = await this.database.query(
      `
      SELECT prompt FROM page_agent_run_inputs
      WHERE plan_run_id = $plan_run_id
          AND step_id = $step_id;
    `,
      { plan_run_id: planRunId, step_id: stepId },
    );
    return row ? readTextColumn(row, 0, "prompt") : null;
  }

  /** First completion wins, including its timestamp; repeated callbacks cannot change the result. */
  public async save(record: PageAgentRunRecord): Promise<PageAgentRunRecord> {
    await this.database.execute(
      `
      INSERT INTO page_agent_run_records (agent_id, run_id, record_json)
      VALUES ($agent_id, $run_id, $record_json)
      ON CONFLICT DO NOTHING;
    `,
      {
        agent_id: record.agentId,
        run_id: record.runId,
        record_json: JSON.stringify(record),
      },
    );
    const persisted = await this.find(record.agentId, record.runId);
    if (!persisted) throw new Error("Agent run record was not persisted.");
    return persisted;
  }

  /** Retrieves one private record for service authorization. */
  public async find(
    agentId: string,
    runId: string,
  ): Promise<PageAgentRunRecord | null> {
    const [row] = await this.database.query(
      `
      SELECT record_json FROM page_agent_run_records
      WHERE agent_id = $agent_id
          AND run_id = $run_id;
    `,
      { agent_id: agentId, run_id: runId },
    );
    const input: unknown = row
      ? JSON.parse(readTextColumn(row, 0, "record_json"))
      : null;
    return input === null ? null : readPageAgentRecord(input);
  }

  /** Terminal plan history supplies missing outbox entries after a crash or file-write failure. */
  public async terminalPlans(): Promise<
    readonly {
      readonly run: AgentPlanRun;
      readonly steps: readonly ArchiveAgentStep[];
    }[]
  > {
    const rows = await this.database.query(`
      SELECT view_json, snapshot_json
      FROM agent_plan_runs
      WHERE status <> 'running';
    `);
    return rows.map((row) => {
      const view: unknown = JSON.parse(readTextColumn(row, 0, "view_json"));
      const snapshot: unknown = JSON.parse(
        readTextColumn(row, 1, "snapshot_json"),
      );
      return { run: readPlanRun(view), steps: readArchiveSteps(snapshot) };
    });
  }
}
