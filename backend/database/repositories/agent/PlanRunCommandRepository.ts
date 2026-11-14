import { randomUUID } from "node:crypto";

import { readTextColumn } from "@/backend/database/RowValue";
import { requireAgentFiles } from "@/backend/storage/AgentPayloadFileStore";
import { planRunCommandActionSchema } from "@/definition/PagesRuns";
import { readPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type {
  PlanRunCommandAction,
  PlanRunCommandReceipt,
} from "@/definition/PagesRuns";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";

/** Private queue entry; snapshot content never crosses the control socket. */
export interface PendingPlanRunCommand {
  readonly receipt: PlanRunCommandReceipt;
  readonly snapshotFile: string | null;
}

/** Transactional command inbox consumed by the single elected plan engine. */
export class PlanRunCommandRepository {
  private readonly database: Pick<Database, "query" | "execute" | "agentFiles">;

  public constructor(
    database: Pick<Database, "query" | "execute" | "agentFiles">,
  ) {
    this.database = database;
  }

  /** Allocates a stable acknowledgement before its admission transaction. */
  public receipt(
    runId: string,
    action: PlanRunCommandAction,
  ): PlanRunCommandReceipt {
    return {
      id: randomUUID(),
      runId,
      action,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    };
  }

  /** Saves a validated private continuation basis outside the short admission transaction. */
  public async snapshot(
    planId: string,
    snapshot: AgentPlanSnapshot | undefined,
  ): Promise<string | null> {
    return snapshot
      ? requireAgentFiles(this.database).write(planId, JSON.stringify(snapshot))
      : null;
  }

  /** Appends the command in the same transaction as the run or calling operation journal. */
  public async insert(
    transaction: DatabaseTransaction,
    receipt: PlanRunCommandReceipt,
    snapshotFile: string | null = null,
  ): Promise<void> {
    await transaction.execute(
      `
      INSERT INTO plan_run_commands (
          id,
          run_id,
          action,
          accepted_at,
          snapshot_file
      ) VALUES ($id, $run_id, $action, $accepted_at, $snapshot_file);
    `,
      {
        id: receipt.id,
        run_id: receipt.runId,
        action: receipt.action,
        accepted_at: receipt.acceptedAt,
        snapshot_file: snapshotFile,
      },
    );
  }

  /** Reads a bounded ordered batch; outstanding peer deliveries cannot starve newly admitted controls. */
  public async pending(): Promise<readonly PendingPlanRunCommand[]> {
    const rows = await this.database.query(`
      SELECT
          id,
          run_id,
          action,
          accepted_at,
          snapshot_file,
          status
      FROM plan_run_commands
      WHERE NOT delivery_complete
      ORDER BY CASE WHEN status = 'accepted' THEN 0 ELSE 1 END, creation_order
      LIMIT 100;
    `);
    return rows.map((row) => {
      const receipt: PlanRunCommandReceipt = {
        id: readTextColumn(row, 0, "id"),
        runId: readTextColumn(row, 1, "run_id"),
        action: planRunCommandActionSchema.parse(row[2]),
        acceptedAt: readTextColumn(row, 3, "accepted_at"),
        status: row[5] === "applied" ? "applied" : "accepted",
      };
      return {
        receipt,
        snapshotFile:
          row[4] === null ? null : readTextColumn(row, 4, "snapshot_file"),
      };
    });
  }

  /** Loads the private basis only inside the individual command's failure boundary. */
  public async readSnapshot(
    reference: string | null,
  ): Promise<AgentPlanSnapshot | undefined> {
    return reference
      ? readPlanSnapshot(
          JSON.parse(await requireAgentFiles(this.database).read(reference)),
        )
      : undefined;
  }

  /** Startup must apply every admitted state transition before releasing fresh dispatch. */
  public async hasAccepted(): Promise<boolean> {
    const rows = await this.database.query(
      "SELECT id FROM plan_run_commands WHERE status = 'accepted' LIMIT 1;",
    );
    return rows.length > 0;
  }

  /** Commits completion with the engine state transition, so a crash cannot repeat it. */
  public async applied(
    transaction: DatabaseTransaction,
    id: string,
  ): Promise<void> {
    await transaction.execute(
      `
      UPDATE plan_run_commands
      SET status = 'applied', completed_at = $completed_at
      WHERE id = $id AND status = 'accepted';
    `,
      { id, completed_at: new Date().toISOString() },
    );
  }

  /** Makes a rejected command inspectable without retrying a permanent refusal forever. */
  public async failed(id: string, error: string): Promise<void> {
    await this.database.execute(
      `
      UPDATE plan_run_commands
      SET status = 'failed', error = $error, completed_at = $completed_at, delivery_complete = TRUE
      WHERE id = $id AND status = 'accepted';
    `,
      { id, error, completed_at: new Date().toISOString() },
    );
  }

  /** Confirms idempotent peer delivery after the state transaction is already durable. */
  public async delivered(id: string): Promise<void> {
    await this.database.execute(
      "UPDATE plan_run_commands SET delivery_complete = TRUE WHERE id = $id AND status = 'applied';",
      { id },
    );
  }

  /** Reads the last acknowledgement after the caller has authorized access to the run. */
  public async latest(runId: string): Promise<PlanRunCommandReceipt | null> {
    const [row] = await this.database.query(
      `
      SELECT
          id,
          action,
          status,
          accepted_at,
          error
      FROM plan_run_commands
      WHERE run_id = $run_id
      ORDER BY creation_order DESC
      LIMIT 1;
    `,
      { run_id: runId },
    );
    if (!row) return null;
    const status = readTextColumn(row, 2, "status");
    if (status !== "accepted" && status !== "applied" && status !== "failed")
      throw new Error("Invalid run command status");
    return {
      id: readTextColumn(row, 0, "id"),
      runId,
      action: planRunCommandActionSchema.parse(row[1]),
      status,
      acceptedAt: readTextColumn(row, 3, "accepted_at"),
      ...(row[4] === null ? {} : { error: readTextColumn(row, 4, "error") }),
    };
  }
}
