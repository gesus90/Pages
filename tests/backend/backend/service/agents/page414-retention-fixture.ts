import type {
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";
import type { GarbageDatabase } from "@/backend/storage/AgentDeferredGarbage";

interface RetentionRun {
  readonly id: string;
  readonly planId: string;
  readonly startedAt: string;
  status: string;
  protection?: string;
}

interface RetentionOwner {
  readonly runId: string;
  readonly released: boolean;
}

/** Stateful database boundary; deletions emulate only the existing garbage triggers. */
export class RetentionDatabase implements GarbageDatabase {
  public readonly plans = new Set<string>();
  public readonly runs = new Map<string, RetentionRun>();
  public readonly owners = new Map<string, RetentionOwner>();
  public readonly garbage = new Set<string>();
  public readonly queries: string[] = [];
  public readonly deletes: string[] = [];
  public beforeLock: (() => void) | undefined;

  /** Provides independent transactions without opening a database. */
  public async transaction<Result>(
    work: (transaction: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> {
    return work(this);
  }

  /** Supplies selected records and records the SQL contract for separate assertions. */
  public async query(
    statement: string,
    parameters: SqlParameters = {},
  ): Promise<readonly DatabaseValue[][]> {
    this.queries.push(statement);
    if (statement.includes("agent_payload_garbage"))
      return [...this.garbage]
        .filter((name) =>
          statement.includes("NOT LIKE")
            ? !name.startsWith("agent-payloads/")
            : name.startsWith("agent-payloads/"),
        )
        .filter((name) => name > String(parameters.after ?? ""))
        .sort()
        .slice(0, 64)
        .map((name) => [name]);
    if (statement.includes("UNION ALL"))
      return this.isProtected(String(parameters.run_id)) ? [["busy"]] : [];
    if (statement.includes("FOR UPDATE")) {
      this.beforeLock?.();
      this.beforeLock = undefined;
      const id = String(parameters.run_id);
      return this.runs.has(id) && !this.isProtected(id) ? [[id]] : [];
    }
    if (statement.includes("AS earlier")) {
      const kept = this.runs.get(String(parameters.kept_run_id));
      return this.orderedRuns()
        .filter(
          (run) =>
            kept && run.planId === kept.planId && this.isOlder(run, kept),
        )
        .slice(0, 64)
        .map((run) => [run.id]);
    }
    if (statement.includes("AS newer"))
      return this.orderedRuns()
        .filter((run) => !this.isProtected(run.id) && this.isObsolete(run))
        .slice(0, 64)
        .map((run) => [run.id]);
    if (statement.includes("WHERE plan_id = $plan_id"))
      return this.orderedRuns()
        .filter((run) => run.planId === parameters.plan_id)
        .map((run) => [run.id]);
    throw new Error(`Unexpected synthetic query: ${statement}`);
  }

  /** Applies observable row deletion and queues the file intents those rows own. */
  public async execute(
    statement: string,
    parameters: SqlParameters = {},
  ): Promise<void> {
    this.deletes.push(statement);
    const runId = String(parameters.run_id);
    if (statement.startsWith("DELETE FROM agent_local_session_owners")) {
      for (const [instanceId, owner] of this.owners) {
        if (owner.runId !== runId) continue;
        this.owners.delete(instanceId);
        this.garbage.add(`local-sessions/${instanceId}/`);
      }
    }
    if (statement === "DELETE FROM agent_plan_runs WHERE id = $run_id;") {
      this.runs.delete(runId);
      this.garbage.add(`plan-sessions/${runId}/`);
    }
    if (statement.startsWith("DELETE FROM agent_payload_garbage"))
      this.garbage.delete(String(parameters.storage_name));
  }

  private orderedRuns(): RetentionRun[] {
    return [...this.runs.values()].sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) ||
        left.id.localeCompare(right.id),
    );
  }

  private isOlder(left: RetentionRun, right: RetentionRun): boolean {
    return (
      left.startedAt < right.startedAt ||
      (left.startedAt === right.startedAt && left.id < right.id)
    );
  }

  private isObsolete(run: RetentionRun): boolean {
    return (
      !this.plans.has(run.planId) ||
      [...this.runs.values()].some(
        (newer) => newer.planId === run.planId && this.isOlder(run, newer),
      )
    );
  }

  private isProtected(runId: string): boolean {
    const run = this.runs.get(runId);
    if (
      run &&
      (![
        "succeeded",
        "failed",
        "cancelled",
        "work_done_closeout_open",
      ].includes(run.status) ||
        run.protection)
    )
      return true;
    return [...this.owners.values()].some(
      (owner) => owner.runId === runId && !owner.released,
    );
  }
}
