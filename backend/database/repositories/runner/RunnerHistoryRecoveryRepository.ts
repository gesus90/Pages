import { readTextColumn } from "@/backend/database/RowValue";
import { RUNNER_TOOL_PROVIDERS } from "@/definition/RunnerExecution";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import {
  runnerJobSchema,
  runnerMessageSchema,
} from "@/definition/RunnerProtocol";
import {
  reportRunnerSchemaIssues,
  runnerSchemaIssues,
} from "@/backend/service/runner/RunnerSchemaDiagnosis";

import { appendRunnerSessionEvents } from "./RunnerSessionEvents";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { RunnerJob, RunnerMessage } from "@/definition/RunnerProtocol";

type PlanEvent = Extract<RunnerMessage, { type: "event" }>;

/** Durable custody of history is independent of control and result projection. */
export class RunnerHistoryRecoveryRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Restarts retained work even when the runner never reconnects. */
  public async pendingConnections(): Promise<readonly string[]> {
    const rows = await this.database.query(
      `
      SELECT DISTINCT connection_id
      FROM runner_history_recovery
      WHERE restored_at IS NULL;
    `,
    );
    return rows.map((row) => readTextColumn(row, 0, "connection_id"));
  }

  /** Retains the complete validated packet before transport progress can be confirmed. */
  public async retain(
    transaction: DatabaseTransaction,
    connectionId: string,
    event: PlanEvent,
  ): Promise<void> {
    if (!event.history?.length) return;
    await transaction.execute(
      `
      INSERT INTO runner_history_recovery (
          event_id,
          connection_id,
          job_id,
          sequence,
          packet_json
      ) VALUES (
          $event_id,
          $connection_id,
          $job_id,
          $sequence,
          $packet_json
      );
    `,
      {
        event_id: event.eventId,
        connection_id: connectionId,
        job_id: event.job.jobId,
        sequence: event.sequence,
        packet_json: JSON.stringify(event),
      },
    );
  }

  /** Retries bounded, ordered work per job; a broken archive cannot starve another job. */
  public async restore(connectionId: string): Promise<number> {
    const rows = await this.database.query(
      `
      SELECT
          event_id,
          job_id,
          packet_json
      FROM (
          SELECT
              event_id,
              job_id,
              packet_json,
              sequence,
              last_attempt_at,
              ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY sequence) AS job_position
          FROM runner_history_recovery
          WHERE connection_id = $connection_id
              AND restored_at IS NULL
      ) AS pending
      WHERE job_position = 1
          AND (
              last_attempt_at IS NULL
              OR last_attempt_at < utc_after(INTERVAL '-30 seconds')
          )
      ORDER BY sequence
      LIMIT 32;
    `,
      { connection_id: connectionId },
    );
    const blocked = new Set<string>();
    let restored = 0;
    for (const row of rows) {
      const jobId = readTextColumn(row, 1, "job_id");
      if (blocked.has(jobId)) continue;
      const eventId = readTextColumn(row, 0, "event_id");
      try {
        await this.database.transaction(async (transaction) => {
          const message = runnerMessageSchema.parse(
            JSON.parse(readTextColumn(row, 2, "packet_json")),
          );
          if (message.type !== "event" || !message.job.plan)
            throw new Error("History recovery binding missing");
          const job = await this.currentJob(transaction, connectionId, jobId);
          await this.initializeAttempt(transaction, job);
          await appendRunnerSessionEvents(transaction, {
            binding: message.job.plan,
            jobId,
            launchId: message.job.launch?.id,
            events: message.history ?? [],
          });
          await transaction.execute(
            `
            UPDATE runner_history_recovery
            SET restored_at = utc_now(), diagnosis_json = NULL
            WHERE event_id = $event_id;
          `,
            { event_id: eventId },
          );
        });
        restored += 1;
      } catch (error: unknown) {
        blocked.add(jobId);
        const issues = runnerSchemaIssues(error);
        await this.database.execute(
          `
          UPDATE runner_history_recovery
          SET diagnosis_json = $diagnosis_json, last_attempt_at = utc_now()
          WHERE event_id = $event_id;
        `,
          { event_id: eventId, diagnosis_json: JSON.stringify(issues) },
        );
        const message = runnerMessageSchema.safeParse(
          JSON.parse(readTextColumn(row, 2, "packet_json")),
        );
        const binding =
          message.success && message.data.type === "event"
            ? message.data.job.plan
            : undefined;
        reportRunnerSchemaIssues(issues, {
          jobId,
          runId: binding?.runId,
          attemptId: binding?.attemptId,
        });
      }
    }
    return restored;
  }

  /** Keeps background recovery alive until every retained packet has entered its archive. */
  public async hasPending(connectionId: string): Promise<boolean> {
    const rows = await this.database.query(
      `
      SELECT event_id
      FROM runner_history_recovery
      WHERE connection_id = $connection_id
          AND restored_at IS NULL
      LIMIT 1;
    `,
      { connection_id: connectionId },
    );
    return rows.length > 0;
  }

  /** Distinguishes a durable deferred packet from an imported archive on every replay. */
  public async isPending(eventId: string): Promise<boolean> {
    const rows = await this.database.query(
      `
      SELECT event_id
      FROM runner_history_recovery
      WHERE event_id = $event_id
          AND restored_at IS NULL;
    `,
      { event_id: eventId },
    );
    return rows.length > 0;
  }

  /** Public recovery health contains counters only, never the retained packet. */
  public async pendingCount(jobId: string): Promise<number> {
    const [row] = await this.database.query(
      `
      SELECT COUNT(event_id)
      FROM runner_history_recovery
      WHERE job_id = $job_id
          AND restored_at IS NULL;
    `,
      { job_id: jobId },
    );
    return Number(row?.[0] ?? 0);
  }

  private async currentJob(
    transaction: DatabaseTransaction,
    connectionId: string,
    jobId: string,
  ): Promise<RunnerJob> {
    const [row] = await transaction.query(
      "SELECT state_json FROM pages_runners WHERE connection_id = $connection_id;",
      { connection_id: connectionId },
    );
    const state: unknown = JSON.parse(
      readTextColumn(row ?? [], 0, "state_json"),
    );
    if (
      typeof state !== "object" ||
      state === null ||
      !("jobs" in state) ||
      !Array.isArray(state.jobs)
    )
      throw new Error("History recovery runner missing");
    const job = state.jobs
      .map((entry: unknown) => runnerJobSchema.parse(entry))
      .find((entry) => entry.jobId === jobId);
    if (!job) throw new Error("History recovery job missing");
    return job;
  }

  private async initializeAttempt(
    transaction: DatabaseTransaction,
    job: RunnerJob,
  ): Promise<void> {
    if (!job.plan) throw new Error("History recovery plan missing");
    const [row] = await transaction.query(
      "SELECT view_json FROM agent_plan_runs WHERE id = $run_id;",
      { run_id: job.plan.runId },
    );
    const run = readPlanRun(
      JSON.parse(readTextColumn(row ?? [], 0, "view_json")),
    );
    const step = run.steps.find((entry) => entry.id === job.plan?.stepId);
    const tool =
      job.execution?.program.kind === "cli"
        ? job.execution.program.route.tool
        : undefined;
    if (
      run.planId !== job.plan.planId ||
      step?.execution?.attemptId !== job.plan.attemptId ||
      !tool
    )
      throw new Error("History recovery attempt mismatch");
    // A late packet can arrive after Stop settled the step before its first
    // session projection. Its immutable claim still owns this archive.
    await transaction.execute(
      `
      INSERT INTO agent_session_attempts (
          attempt_id,
          plan_id,
          run_id,
          step_id,
          user_id,
          provider,
          instance_id,
          state,
          next_sequence,
          updated_at
      ) VALUES (
          $attempt_id,
          $plan_id,
          $run_id,
          $step_id,
          $user_id,
          $provider,
          $instance_id,
          $state,
          1,
          utc_now()
      )
      ON CONFLICT (attempt_id) DO NOTHING;
    `,
      {
        attempt_id: job.plan.attemptId,
        plan_id: run.planId,
        run_id: run.id,
        step_id: job.plan.stepId,
        user_id: run.userId,
        provider: RUNNER_TOOL_PROVIDERS[tool],
        instance_id: job.jobId,
        state: step.status === "succeeded" ? "ended" : step.status,
      },
    );
  }
}
