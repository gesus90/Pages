import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";

interface RunRow {
  readonly id: string;
  readonly planId: string;
  readonly userId: string;
  readonly snapshot: string;
  view: string;
  revision: number;
  status: string;
}

interface CheckpointRow {
  readonly runId: string;
  readonly stepId: string;
  readonly version: number;
  readonly json: string;
}

interface AttemptRow {
  readonly runId: string;
  readonly key: string;
  readonly digest: string;
  readonly revision: number;
  readonly json: string;
  readonly result: string;
}

interface RecoveryRows {
  readonly runs: Map<string, RunRow>;
  readonly checkpoints: CheckpointRow[];
  readonly attempts: AttemptRow[];
  readonly locks: Map<string, string>;
}

function requiredText(parameters: SqlParameters, name: string): string {
  const text = parameters[name];
  if (typeof text !== "string")
    throw new Error(`Missing synthetic SQL parameter ${name}`);
  return text;
}

function requiredNumber(parameters: SqlParameters, name: string): number {
  const number = parameters[name];
  if (typeof number !== "number")
    throw new Error(`Missing synthetic SQL number ${name}`);
  return number;
}

/** In-memory transaction boundary with rollback and controlled storage faults; no SQL engine or process. */
export class RecoveryDatabase {
  private readonly plan: AgentPlanSnapshot;
  private readonly queue = new SerialQueue();
  private rows: RecoveryRows = {
    runs: new Map(),
    checkpoints: [],
    attempts: [],
    locks: new Map(),
  };
  private fault: "checkpoint" | "progress" | "attempt" | null = null;

  public constructor(snapshot: AgentPlanSnapshot, run?: AgentPlanRun) {
    this.plan = snapshot;
    if (run) {
      this.rows.runs.set(run.id, {
        id: run.id,
        planId: run.planId,
        userId: run.userId,
        status: run.status,
        view: JSON.stringify(run),
        revision: 0,
        snapshot: JSON.stringify(snapshot),
      });
      this.rows.locks.set(snapshot.plan.workspaceId, run.id);
    }
  }

  /** Structural database access for the real repositories under test. */
  public asDatabase(): Pick<Database, "query" | "execute" | "transaction"> {
    return {
      query: async (statement, parameters = {}) =>
        this.query(statement, parameters),
      execute: async (statement, parameters = {}) =>
        this.execute(statement, parameters),
      transaction: async (work) =>
        this.queue.run(async () => {
          const before = structuredClone(this.rows);
          const transaction: DatabaseTransaction = {
            query: async (statement, parameters = {}) =>
              this.query(statement, parameters),
            execute: async (statement, parameters = {}) =>
              this.execute(statement, parameters),
          };
          try {
            return await work(transaction);
          } catch (error: unknown) {
            this.rows = before;
            throw error;
          }
        }),
    };
  }

  /** Injects one failure at a durable boundary, including after a checkpoint insert. */
  public failNext(fault: "checkpoint" | "progress" | "attempt"): void {
    this.fault = fault;
  }

  /** Returns copied durable rows, so callers cannot change them outside a transaction. */
  public stored(): RecoveryRows {
    return structuredClone(this.rows);
  }

  /** Reads the stored view independently of a running engine's in-memory state. */
  public run(id: string): AgentPlanRun {
    const row = this.rows.runs.get(id);
    if (!row) throw new Error("Missing synthetic run");
    return readPlanRun(JSON.parse(row.view));
  }

  private query(
    statement: string,
    parameters: SqlParameters,
  ): DatabaseValue[][] {
    if (statement.includes("FROM agent_plan_checkpoints"))
      return this.checkpointRows(statement, parameters);
    if (statement.includes("FROM agent_plan_repair_attempts"))
      return this.attemptRows(statement, parameters);
    if (statement.includes("FROM agent_plan_runs"))
      return this.runRows(statement, parameters);
    if (statement.includes("FROM agent_plans"))
      return [[this.plan.plan.revision]];
    if (statement.includes("FROM agent_plan_workspace_locks")) {
      const lock = this.rows.locks.get(requiredText(parameters, "id"));
      return lock ? [[lock]] : [];
    }
    throw new Error(`Unexpected synthetic query ${statement}`);
  }

  private checkpointRows(
    statement: string,
    parameters: SqlParameters,
  ): DatabaseValue[][] {
    const rows = this.rows.checkpoints.filter(
      (row) => row.runId === requiredText(parameters, "run_id"),
    );
    if (statement.includes("MAX(version)"))
      return [[Math.max(0, ...rows.map((row) => row.version))]];
    const matching = rows.filter(
      (row) =>
        (parameters.step_id === undefined ||
          row.stepId === parameters.step_id) &&
        (parameters.version === null ||
          parameters.version === undefined ||
          row.version === parameters.version),
    );
    const newest = matching.toSorted(
      (first, second) => second.version - first.version,
    )[0];
    return newest ? [[newest.json]] : [];
  }

  private attemptRows(
    statement: string,
    parameters: SqlParameters,
  ): DatabaseValue[][] {
    const rows = this.rows.attempts.filter(
      (row) => row.runId === requiredText(parameters, "run_id"),
    );
    if (statement.includes("idempotency_key =")) {
      const row = rows.find(
        (entry) => entry.key === parameters.idempotency_key,
      );
      return row ? [[row.digest, row.result]] : [];
    }
    return rows
      .toSorted((first, second) => second.revision - first.revision)
      .slice(0, 100)
      .map((row) => [row.json]);
  }

  private runRows(
    statement: string,
    parameters: SqlParameters,
  ): DatabaseValue[][] {
    const rows = [...this.rows.runs.values()];
    if (statement.includes("status NOT IN"))
      return rows
        .filter(
          (row) =>
            row.status !== "running" &&
            row.status !== "paused" &&
            [...this.rows.locks.values()].includes(row.id),
        )
        .map((row) => [row.view]);
    if (parameters.plan_id !== undefined)
      return rows
        .filter(
          (row) =>
            row.planId === parameters.plan_id &&
            row.userId === parameters.user_id &&
            (row.status === "running" || row.status === "paused"),
        )
        .map((row) => [row.id]);
    if (parameters.id === undefined)
      return rows
        .filter((row) => row.status === "running" || row.status === "paused")
        .map((row) => [row.view]);
    const row = rows.find((entry) => entry.id === parameters.id);
    if (!row) return [];
    if (statement.includes("recovery_revision"))
      return statement.includes("snapshot_json")
        ? [[row.view, row.revision, row.snapshot]]
        : [[row.view, row.revision]];
    if (statement.includes("SELECT snapshot_json")) return [[row.snapshot]];
    return [[row.view]];
  }

  private execute(statement: string, parameters: SqlParameters): void {
    if (statement.includes("INSERT INTO agent_plan_checkpoints")) {
      this.throwFault("checkpoint");
      this.rows.checkpoints.push({
        runId: requiredText(parameters, "run_id"),
        stepId: requiredText(parameters, "step_id"),
        version: requiredNumber(parameters, "version"),
        json: requiredText(parameters, "checkpoint_json"),
      });
      return;
    }
    if (statement.includes("INSERT INTO agent_plan_repair_attempts")) {
      this.throwFault("attempt");
      this.rows.attempts.push({
        runId: requiredText(parameters, "run_id"),
        key: requiredText(parameters, "idempotency_key"),
        digest: requiredText(parameters, "request_digest"),
        revision: requiredNumber(parameters, "result_revision"),
        json: requiredText(parameters, "attempt_json"),
        result: requiredText(parameters, "result_json"),
      });
      return;
    }
    if (statement.includes("UPDATE agent_plan_runs")) {
      this.updateRun(parameters);
      return;
    }
    if (statement.includes("INSERT INTO agent_plan_runs")) {
      this.insertRun(parameters);
      return;
    }
    if (statement.includes("INSERT INTO agent_plan_workspace_locks")) {
      this.rows.locks.set(
        requiredText(parameters, "workspace_id"),
        requiredText(parameters, "run_id"),
      );
      return;
    }
    if (statement.includes("DELETE FROM agent_plan_workspace_locks")) {
      for (const [workspace, runId] of this.rows.locks)
        if (runId === parameters.id) this.rows.locks.delete(workspace);
      return;
    }
    throw new Error(`Unexpected synthetic statement ${statement}`);
  }

  private insertRun(parameters: SqlParameters): void {
    const id = requiredText(parameters, "id");
    this.rows.runs.set(id, {
      id,
      planId: requiredText(parameters, "plan_id"),
      userId: requiredText(parameters, "user_id"),
      status: requiredText(parameters, "status"),
      view: requiredText(parameters, "view_json"),
      snapshot: requiredText(parameters, "snapshot_json"),
      revision: 0,
    });
  }

  private updateRun(parameters: SqlParameters): void {
    this.throwFault("progress");
    const row = this.rows.runs.get(requiredText(parameters, "id"));
    if (!row || row.revision !== parameters.previous_revision)
      throw new Error("Synthetic compare-and-set conflict");
    row.status = requiredText(parameters, "status");
    row.view = requiredText(parameters, "view_json");
    row.revision = requiredNumber(parameters, "revision");
  }

  private throwFault(fault: "checkpoint" | "progress" | "attempt"): void {
    if (this.fault !== fault) return;
    this.fault = null;
    throw new Error(`Synthetic ${fault} storage fault`);
  }
}
