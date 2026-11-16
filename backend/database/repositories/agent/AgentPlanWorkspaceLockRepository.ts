import { localOwnerProofSchema } from "@/backend/agents/local/LocalSessionContracts";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { readTextColumn } from "@/backend/database/RowValue";

import { AcpResourceRepository } from "./AcpResourceRepository";
import { releaseAcpLease } from "./AcpLeaseRelease";
import { releaseCheckedWorkspaceLocks } from "./AgentPlanWorkspaceLockRelease";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AcpResourceRecord } from "@/definition/AcpResource";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { LocalOwnerProof } from "@/backend/agents/local/LocalSessionContracts";

/** A retained lock with the historical run used only inside the server. */
export interface StoredPlanWorkspaceLock {
  readonly resource: string;
  readonly acquiredAt: string;
  readonly run: AgentPlanRun;
}

interface NativePlanLockOwner {
  readonly instanceId: string;
  readonly proof: LocalOwnerProof | null;
}

function lockTimestamp(timestamp: string): string {
  return timestamp.includes("T")
    ? timestamp
    : `${timestamp.replace(" ", "T")}Z`;
}

/** Persistence boundary of startup, periodic and explicit workspace release. */
export class AgentPlanWorkspaceLockRepository {
  private readonly database: Pick<Database, "query" | "transaction">;

  public constructor(database: Pick<Database, "query" | "transaction">) {
    this.database = database;
  }

  /** Reads every retained owner, including older runs hidden from the editor's history. */
  public async list(): Promise<readonly StoredPlanWorkspaceLock[]> {
    const rows = await this.database.query(`
      SELECT
          locks.workspace_id,
          locks.acquired_at,
          runs.view_json
      FROM agent_plan_workspace_locks AS locks
      INNER JOIN agent_plan_runs AS runs ON runs.id = locks.run_id
      ORDER BY locks.creation_order;
    `);
    return rows.map((row) => ({
      resource: readTextColumn(row, 0, "workspace_id"),
      acquiredAt: lockTimestamp(readTextColumn(row, 1, "acquired_at")),
      run: readPlanRun(JSON.parse(readTextColumn(row, 2, "view_json"))),
    }));
  }

  /** Releases a checked unchanged owner and its proven dead native intents atomically. */
  public async release(
    run: AgentPlanRun,
    verify: (transaction: DatabaseTransaction) => Promise<void>,
    reason: string,
    journal?: (transaction: DatabaseTransaction) => Promise<void>,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      // Lock before reading native intents so a concurrent continuation cannot acquire new ownership.
      await transaction.query(
        "SELECT id FROM agent_plan_runs WHERE id = $run_id FOR UPDATE;",
        { run_id: run.id },
      );
      await verify(transaction);
      await transaction.execute(
        `
        UPDATE agent_workspace_cleanup
        SET state = 'completed',
            blocker = 'process_free_files_preserved',
            updated_at = utc_now()
        WHERE run_id = $run_id AND state <> 'completed';
      `,
        { run_id: run.id },
      );
      await releaseCheckedWorkspaceLocks(transaction, run, reason);
      await journal?.(transaction);
    });
  }

  /** Native ownership can outlive or precede the public step's session record. */
  public async owners(
    transaction: DatabaseTransaction,
    runId: string,
  ): Promise<readonly NativePlanLockOwner[]> {
    const rows = await transaction.query(
      `
      SELECT
          instance_id,
          proof
      FROM agent_local_session_owners
      WHERE run_id = $run_id AND released_at IS NULL
      FOR UPDATE;
    `,
      { run_id: runId },
    );
    return rows.map((row) => ({
      instanceId: readTextColumn(row, 0, "instance_id"),
      proof:
        row[1] === null
          ? null
          : localOwnerProofSchema.parse(
              JSON.parse(readTextColumn(row, 1, "proof")),
            ),
    }));
  }

  /** Includes leases that a failed prepare never managed to put into its step view. */
  public async leases(
    transaction: DatabaseTransaction,
    runId: string,
  ): Promise<readonly AcpResourceRecord[]> {
    return (await new AcpResourceRepository(transaction).list()).filter(
      (lease) => lease.runId === runId,
    );
  }

  /** Releases only the uncertain reservation whose writer was independently proven ended. */
  public async releaseLease(
    transaction: DatabaseTransaction,
    lease: AcpResourceRecord,
  ): Promise<void> {
    if (lease.runId === null)
      throw new AgentPlanRecoveryError("cleanup_unconfirmed");
    const result = await releaseAcpLease(transaction, {
      instanceId: lease.instanceId,
      isUncertain: true,
      runId: lease.runId,
      reason: "writer_processes_ended",
    });
    if (result === "changed")
      throw new AgentPlanRecoveryError("cleanup_unconfirmed");
  }

  /** Records an independently proven dead native owner in the release transaction. */
  public async releaseOwner(
    transaction: DatabaseTransaction,
    instanceId: string,
  ): Promise<void> {
    await transaction.execute(
      `
      UPDATE agent_local_session_owners
      SET released_at = utc_now(), importer_token = NULL
      WHERE instance_id = $instance_id AND released_at IS NULL;
    `,
      { instance_id: instanceId },
    );
  }
}
