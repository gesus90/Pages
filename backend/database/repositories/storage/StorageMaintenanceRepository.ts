import { AgentEnvironmentRepository } from "@/backend/database/repositories/agent/AgentEnvironmentRepository";
import { AutomationEventRepository } from "@/backend/database/repositories/automation/AutomationEventRepository";
import { PagesEventOutboxRepository } from "@/backend/database/repositories/events/PagesEventOutboxRepository";
import { readCountColumn } from "@/backend/database/RowValue";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { StorageUsage } from "@/definition/StorageUsage";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

async function isDue(
  transaction: DatabaseTransaction,
  task: string,
  now: number,
  interval: number,
): Promise<boolean> {
  const [row] = await transaction.query(
    "SELECT last_run_ms FROM pages_storage_maintenance WHERE task = $task;",
    { task },
  );
  return !row || now - readCountColumn(row, 0, "last_run_ms") >= interval;
}

async function markRun(
  transaction: DatabaseTransaction,
  task: string,
  now: number,
): Promise<void> {
  await transaction.execute(
    `
    INSERT INTO pages_storage_maintenance (
        task,
        last_run_ms
    ) VALUES (
        $task,
        $now
    )
    ON CONFLICT (task) DO UPDATE
    SET last_run_ms = EXCLUDED.last_run_ms;
  `,
    { task, now },
  );
}

/** Durable maintenance cadence shared across process lifetimes and the API/runs processes. */
export class StorageMaintenanceRepository {
  private readonly database: Pick<Database, "transaction" | "query">;
  private readonly environments: AgentEnvironmentRepository;

  public constructor(database: Pick<Database, "transaction" | "query">) {
    this.database = database;
    this.environments = new AgentEnvironmentRepository(database);
  }

  /** Holds global worker admission until transcript and legacy-store deletion finishes. */
  public async whileIdle(work: () => Promise<void>): Promise<void> {
    await this.environments.maintainConnectionCaches(work);
  }

  /** Runs daily shared cleanup only while no lease or unreleased local owner exists. */
  public async daily(now: number, work: () => Promise<void>): Promise<void> {
    await this.environments.maintainConnectionCaches(async (transaction) => {
      if (!(await isDue(transaction, "shared-environment", now, DAY))) return;
      await markRun(transaction, "shared-environment", now);
      // The caller logs each failed operation without rolling back this attempt's cadence.
      await work();
    });
  }

  /** Claims the hourly measurement before scanning files, without holding the writer for the scan. */
  public async claimMeasurement(now: number): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      if (!(await isDue(transaction, "measurement", now, HOUR))) return false;
      await markRun(transaction, "measurement", now);
      return true;
    });
  }

  /** Commits one warning and its automation inbox record together, at most once per 24 hours. */
  public async warning(
    now: number,
    usage: StorageUsage,
  ): Promise<PagesEvent | null> {
    return this.database.transaction(async (transaction) => {
      if (!(await isDue(transaction, "warning", now, DAY))) return null;
      const event: PagesEvent = {
        type: "storage.limit_exceeded",
        id: "storage",
        storage: usage,
      };
      await markRun(transaction, "warning", now);
      await new PagesEventOutboxRepository(transaction).append(event);
      await new AutomationEventRepository(transaction).record({
        eventType: "storage.limit_exceeded",
        actorId: null,
        occurredAt: new Date(now).toISOString(),
        payload: JSON.stringify(usage),
      });
      return event;
    });
  }
}
