import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import { AgentPlanProgressRepository } from "../agent/AgentPlanProgressRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanCheckpointInput } from "@/definition/AgentPlanRecovery";
import type { RunnerMessage } from "@/definition/RunnerProtocol";

interface RunnerEventReceipt {
  readonly connectionId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly digest: string;
}

type PlanEvent = Extract<RunnerMessage, { type: "event" }>;

/** Atomic runner receipts and existing plan progress, without a second run store. */
export class RunnerPlanEventRepository {
  private readonly database: Database;
  private readonly progress: AgentPlanProgressRepository;

  public constructor(database: Database) {
    this.database = database;
    this.progress = new AgentPlanProgressRepository(database);
  }

  /** Looks up all acknowledged events, including duplicates older than the latest sequence. */
  public async receipt(eventId: string): Promise<RunnerEventReceipt | null> {
    const [row] = await this.database.query(
      `
      SELECT
          connection_id,
          session_id,
          sequence,
          event_digest
      FROM runner_plan_events
      WHERE event_id = $event_id;
    `,
      { event_id: eventId },
    );
    return row
      ? {
          connectionId: readTextColumn(row, 0, "connection_id"),
          sessionId: readTextColumn(row, 1, "session_id"),
          sequence: readCountColumn(row, 2, "sequence"),
          digest: readTextColumn(row, 3, "event_digest"),
        }
      : null;
  }

  /** Records the validated digest in the transaction that writes the run and runner checkpoint. */
  public async append(
    transaction: DatabaseTransaction,
    connectionId: string,
    input: { readonly event: PlanEvent; readonly digest: string },
  ): Promise<void> {
    await transaction.execute(
      `
      INSERT INTO runner_plan_events (
          connection_id,
          session_id,
          sequence,
          event_id,
          event_digest
      ) VALUES ($connection_id, $session_id, $sequence, $event_id, $event_digest);
    `,
      {
        connection_id: connectionId,
        session_id: input.event.sessionId,
        sequence: input.event.sequence,
        event_id: input.event.eventId,
        event_digest: input.digest,
      },
    );
  }

  /** Loads the original immutable basis and updates only its public progress. */
  public async apply(
    transaction: DatabaseTransaction,
    runId: string,
    reduce: (
      run: AgentPlanRun,
      snapshot: unknown,
    ) => {
      readonly run: AgentPlanRun;
      readonly checkpoint?: AgentPlanCheckpointInput;
    },
  ): Promise<void> {
    const [row] = await transaction.query(
      `
      SELECT
          view_json,
          snapshot_json
      FROM agent_plan_runs
      WHERE id = $run_id;
    `,
      { run_id: runId },
    );
    if (!row) throw new Error("Unknown runner plan run");
    const result = reduce(
      readPlanRun(JSON.parse(readTextColumn(row, 0, "view_json"))),
      JSON.parse(readTextColumn(row, 1, "snapshot_json")),
    );
    await this.progress.persist(transaction, result.run, result.checkpoint);
  }
}
