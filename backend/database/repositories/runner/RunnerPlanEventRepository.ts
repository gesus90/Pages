import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import { AgentPlanProgressRepository } from "../agent/AgentPlanProgressRepository";
import { CURRENT_PLAN_SNAPSHOT } from "../agent/AgentPlanContinuationRepository";
import {
  persistRunnerSessionEvents,
  appendRunnerSessionEvents,
} from "./RunnerSessionEvents";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanCheckpointInput } from "@/definition/AgentPlanRecovery";
import type { RunnerMessage, RunnerJob } from "@/definition/RunnerProtocol";
import type { RunnerLiveEvent } from "@/definition/RunnerLiveHistory";

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

  /** Stores a terminal job's remaining diagnostics in its bound journal, leaving the completed plan untouched. */
  public async appendHistory(
    transaction: DatabaseTransaction,
    job: RunnerJob,
    events: readonly RunnerLiveEvent[],
  ): Promise<void> {
    if (!job.plan) throw new Error("Runner session binding missing");
    await appendRunnerSessionEvents(transaction, {
      binding: job.plan,
      jobId: job.jobId,
      ...(job.outputJournalVersion === 2 ? { launchId: job.launch?.id } : {}),
      events,
    });
  }

  /**
   * Loads the current immutable continuation basis and updates only its public progress.
   *
   * @remarks
   * A reducer that returns the loaded run object itself writes nothing.
   */
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
    history?: {
      readonly stepId: string;
      readonly events: readonly RunnerLiveEvent[];
    },
  ): Promise<void> {
    const [row] = await transaction.query(
      `
      SELECT
          view_json,
          ${CURRENT_PLAN_SNAPSHOT} AS snapshot_json
      FROM agent_plan_runs
      WHERE id = $run_id;
    `,
      { run_id: runId },
    );
    if (!row) throw new Error("Unknown runner plan run");
    const current = readPlanRun(
      JSON.parse(readTextColumn(row, 0, "view_json")),
    );
    const result = reduce(
      current,
      JSON.parse(readTextColumn(row, 1, "snapshot_json")),
    );
    // An unchanged settled run keeps its recovery revision for concurrent recovery commands.
    if (result.run === current) return;
    await this.progress.persist(transaction, result.run, result.checkpoint);
    if (history)
      await persistRunnerSessionEvents(transaction, result.run, history);
  }
}
