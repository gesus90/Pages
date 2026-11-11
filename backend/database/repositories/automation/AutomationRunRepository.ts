import {
  readBooleanColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import {
  AUTOMATION_EVENT_TYPES,
  AUTOMATION_RUN_OUTCOMES,
  AUTOMATION_RUN_STATUSES,
  AUTOMATION_TRIGGER_TYPES,
} from "@/definition/Automation";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type {
  AutomationEventType,
  AutomationRunOutcome,
  AutomationRunStatus,
  AutomationTriggerType,
} from "@/definition/Automation";

/** One stored run. */
export interface StoredAutomationRun {
  readonly id: string;
  readonly sequence: number;
  readonly automationId: string;
  readonly triggerKind: AutomationTriggerType;
  readonly eventType: AutomationEventType | null;
  readonly triggerSubject: string | null;
  /** The JSON the trigger hands to the action. */
  readonly triggerData: string | null;
  readonly requestedBy: string | null;
  readonly status: AutomationRunStatus;
  readonly outcome: AutomationRunOutcome | null;
  readonly exitCode: number | null;
  readonly forwardState: "woken" | "not_woken" | null;
  readonly planRunId: string | null;
  readonly planRunStatus: string | null;
  readonly paused: boolean;
  readonly errorCode: string | null;
  readonly summary: string | null;
  readonly answer: string | null;
  readonly output: string | null;
  readonly error: string | null;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
}

/** A new run that waits for its turn. */
export interface AutomationRunRequest {
  readonly id: string;
  readonly automationId: string;
  readonly triggerKind: AutomationTriggerType;
  readonly eventType: AutomationEventType | null;
  readonly triggerSubject: string | null;
  readonly triggerData: string | null;
  readonly requestedBy: string | null;
  readonly queuedAt: string;
}

/** What a finished run stores. */
export interface AutomationRunEnding {
  readonly status: "completed" | "failed";
  readonly outcome: AutomationRunOutcome;
  readonly exitCode?: number | null;
  readonly forwardState?: "woken" | "not_woken" | null;
  readonly planRunStatus?: string | null;
  readonly paused?: boolean;
  readonly errorCode?: string | null;
  readonly summary?: string | null;
  readonly answer?: string | null;
  readonly output?: string | null;
  readonly error?: string | null;
  readonly endedAt: string;
}

type Executor = Pick<Database, "query" | "execute"> | DatabaseTransaction;

const COLUMNS = `
    automation_runs.id,
    automation_runs.sequence,
    automation_runs.automation_id,
    automation_runs.trigger_kind,
    automation_runs.event_type,
    automation_runs.trigger_subject,
    automation_runs.trigger_data,
    automation_runs.requested_by,
    automation_runs.status,
    automation_runs.outcome,
    automation_runs.exit_code,
    automation_runs.forward_state,
    automation_runs.started_plan_run_id,
    automation_runs.plan_run_status,
    automation_runs.paused,
    automation_runs.error_code,
    automation_runs.summary,
    automation_runs.answer,
    automation_runs.output,
    automation_runs.error,
    automation_runs.queued_at,
    automation_runs.started_at,
    automation_runs.ended_at`;

function pick<Value extends string>(
  values: readonly Value[],
  candidate: string | null,
): Value | null {
  return values.find((value) => value === candidate) ?? null;
}

function readNumber(value: DatabaseValue | undefined): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return null;
}

function readForward(value: string | null): "woken" | "not_woken" | null {
  return value === "woken" || value === "not_woken" ? value : null;
}

function readRunRow(row: readonly DatabaseValue[]): StoredAutomationRun {
  const text = (index: number, name: string): string | null =>
    readNullableTextColumn(row, index, name);
  return {
    id: readTextColumn(row, 0, "id"),
    sequence: readNumber(row[1]) ?? 0,
    automationId: readTextColumn(row, 2, "automation_id"),
    triggerKind:
      pick(AUTOMATION_TRIGGER_TYPES, text(3, "trigger_kind")) ?? "manual",
    eventType: pick(AUTOMATION_EVENT_TYPES, text(4, "event_type")),
    triggerSubject: text(5, "trigger_subject"),
    triggerData: text(6, "trigger_data"),
    requestedBy: text(7, "requested_by"),
    status: pick(AUTOMATION_RUN_STATUSES, text(8, "status")) ?? "failed",
    outcome: pick(AUTOMATION_RUN_OUTCOMES, text(9, "outcome")),
    exitCode: readNumber(row[10]),
    forwardState: readForward(text(11, "forward_state")),
    planRunId: text(12, "started_plan_run_id"),
    planRunStatus: text(13, "plan_run_status"),
    paused: readBooleanColumn(row, 14, "paused"),
    errorCode: text(15, "error_code"),
    summary: text(16, "summary"),
    answer: text(17, "answer"),
    output: text(18, "output"),
    error: text(19, "error"),
    queuedAt: readTextColumn(row, 20, "queued_at"),
    startedAt: text(21, "started_at"),
    endedAt: text(22, "ended_at"),
  };
}

/**
 * Stores the runs of automations (PAGE-297).
 *
 * @remarks
 * Two partial unique indexes allow one running and one waiting run per
 * automation; {@link AutomationRunRepository.enqueue} joins a trigger to the
 * waiting run instead of adding a third.
 */
export class AutomationRunRepository {
  private readonly database: Executor;

  /**
   * Creates the repository.
   *
   * @param database - The database or an open transaction.
   */
  public constructor(database: Executor) {
    this.database = database;
  }

  /** Reads one run of an automation. */
  public async find(
    automationId: string,
    runId: string,
  ): Promise<StoredAutomationRun | null> {
    const [row] = await this.database.query(
      `
      SELECT ${COLUMNS}
      FROM automation_runs
      WHERE automation_runs.id = $id
          AND automation_runs.automation_id = $automation_id;
    `,
      { id: runId, automation_id: automationId },
    );
    return row ? readRunRow(row) : null;
  }

  /** Reads one run by its ID alone. */
  public async findById(runId: string): Promise<StoredAutomationRun | null> {
    const [row] = await this.database.query(
      `SELECT ${COLUMNS} FROM automation_runs WHERE automation_runs.id = $id;`,
      { id: runId },
    );
    return row ? readRunRow(row) : null;
  }

  /**
   * Adds a waiting run, or returns the run that already waits.
   *
   * @returns The waiting run and whether the trigger joined it.
   */
  public async enqueue(request: AutomationRunRequest): Promise<{
    readonly run: StoredAutomationRun;
    readonly isCoalesced: boolean;
  }> {
    const inserted = await this.database.query(
      `
      INSERT INTO automation_runs (
          id,
          automation_id,
          trigger_kind,
          event_type,
          trigger_subject,
          trigger_data,
          requested_by,
          status,
          queued_at
      )
      VALUES (
          $id,
          $automation_id,
          $trigger_kind,
          $event_type,
          $trigger_subject,
          $trigger_data,
          $requested_by,
          'queued',
          $queued_at
      )
      ON CONFLICT (automation_id) WHERE status = 'queued' DO NOTHING
      RETURNING ${COLUMNS};
    `,
      {
        id: request.id,
        automation_id: request.automationId,
        trigger_kind: request.triggerKind,
        event_type: request.eventType,
        trigger_subject: request.triggerSubject,
        trigger_data: request.triggerData,
        requested_by: request.requestedBy,
        queued_at: request.queuedAt,
      },
    );
    if (inserted[0])
      return { run: readRunRow(inserted[0]), isCoalesced: false };
    const [waiting] = await this.database.query(
      `
      SELECT ${COLUMNS}
      FROM automation_runs
      WHERE automation_runs.automation_id = $automation_id
          AND automation_runs.status = 'queued';
    `,
      { automation_id: request.automationId },
    );
    if (!waiting) throw new Error("The waiting run vanished.");
    return { run: readRunRow(waiting), isCoalesced: true };
  }

  /** The waiting runs whose automation has no running run, oldest first. */
  public async startable(
    limit: number,
  ): Promise<readonly StoredAutomationRun[]> {
    const rows = await this.database.query(
      `
      SELECT ${COLUMNS}
      FROM automation_runs
      WHERE automation_runs.status = 'queued'
          AND NOT EXISTS (
              SELECT 1
              FROM automation_runs AS running
              WHERE running.automation_id = automation_runs.automation_id
                  AND running.status IN ('accepted', 'delivered')
          )
      ORDER BY automation_runs.sequence
      LIMIT $limit;
    `,
      { limit },
    );
    return rows.map(readRunRow);
  }

  /** Every run that has not ended yet. */
  public async open(): Promise<readonly StoredAutomationRun[]> {
    const rows = await this.database.query(
      `
      SELECT ${COLUMNS}
      FROM automation_runs
      WHERE automation_runs.status IN ('accepted', 'delivered')
      ORDER BY automation_runs.sequence;
    `,
    );
    return rows.map(readRunRow);
  }

  /**
   * Claims a waiting run for its start.
   *
   * @returns Whether this caller claimed it; another claim or a running run refuses.
   */
  public async claim(runId: string, startedAt: string): Promise<boolean> {
    const rows = await this.database.query(
      `
      UPDATE automation_runs
      SET
          status = 'accepted',
          started_at = $started_at
      WHERE id = $id
          AND status = 'queued'
      RETURNING id;
    `,
      { id: runId, started_at: startedAt },
    );
    return rows.length > 0;
  }

  /** Marks a claimed run as started, with the plan run it started. */
  public async deliver(runId: string, planRunId: string | null): Promise<void> {
    await this.database.execute(
      `
      UPDATE automation_runs
      SET
          status = 'delivered',
          started_plan_run_id = COALESCE($started_plan_run_id, started_plan_run_id)
      WHERE id = $id
          AND status IN ('accepted', 'delivered');
    `,
      { id: runId, started_plan_run_id: planRunId },
    );
  }

  /**
   * Ends a run that has not ended yet.
   *
   * @returns Whether this caller ended it.
   */
  public async finish(
    runId: string,
    ending: AutomationRunEnding,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
      UPDATE automation_runs
      SET
          status = $status,
          outcome = $outcome,
          exit_code = $exit_code,
          forward_state = $forward_state,
          plan_run_status = COALESCE($plan_run_status, plan_run_status),
          paused = $paused,
          error_code = $error_code,
          summary = $summary,
          answer = $answer,
          output = $output,
          error = $error,
          started_at = COALESCE(started_at, $ended_at),
          ended_at = $ended_at
      WHERE id = $id
          AND status NOT IN ('completed', 'failed')
      RETURNING id;
    `,
      {
        id: runId,
        status: ending.status,
        outcome: ending.outcome,
        exit_code: ending.exitCode ?? null,
        forward_state: ending.forwardState ?? null,
        plan_run_status: ending.planRunStatus ?? null,
        paused: ending.paused ?? false,
        error_code: ending.errorCode ?? null,
        summary: ending.summary ?? null,
        answer: ending.answer ?? null,
        output: ending.output ?? null,
        error: ending.error ?? null,
        ended_at: ending.endedAt,
      },
    );
    return rows.length > 0;
  }

  /** Records that a finished run paused its automation. */
  public async markPaused(runId: string): Promise<void> {
    await this.database.execute(
      "UPDATE automation_runs SET paused = TRUE WHERE id = $id;",
      { id: runId },
    );
  }

  /** Lists the runs of automations, newest first. */
  public async list(query: {
    readonly automationIds: readonly string[];
    readonly beforeSequence: number | null;
    readonly limit: number;
  }): Promise<readonly StoredAutomationRun[]> {
    if (query.automationIds.length === 0) return [];
    const rows = await this.database.query(
      `
      SELECT ${COLUMNS}
      FROM automation_runs
      WHERE automation_runs.automation_id = ANY(string_to_array($automation_ids, ','))
          AND ($before_sequence = 0 OR automation_runs.sequence < $before_sequence)
      ORDER BY automation_runs.sequence DESC
      LIMIT $limit;
    `,
      {
        automation_ids: query.automationIds.join(","),
        before_sequence: query.beforeSequence ?? 0,
        limit: query.limit,
      },
    );
    return rows.map(readRunRow);
  }

  /** The newest run of each automation. */
  public async latest(
    automationIds: readonly string[],
  ): Promise<ReadonlyMap<string, StoredAutomationRun>> {
    if (automationIds.length === 0) return new Map();
    const rows = await this.database.query(
      `
      SELECT DISTINCT ON (automation_runs.automation_id) ${COLUMNS}
      FROM automation_runs
      WHERE automation_runs.automation_id = ANY(string_to_array($automation_ids, ','))
      ORDER BY automation_runs.automation_id, automation_runs.sequence DESC;
    `,
      { automation_ids: automationIds.join(",") },
    );
    return new Map(
      rows.map((row) => {
        const run = readRunRow(row);
        return [run.automationId, run];
      }),
    );
  }

  /** Counts the runs of an automation. */
  public async count(automationId: string): Promise<number> {
    const [row] = await this.database.query(
      "SELECT COUNT(id) FROM automation_runs WHERE automation_id = $automation_id;",
      { automation_id: automationId },
    );
    return readNumber(row?.[0]) ?? 0;
  }

  /** The run of an automation that runs or waits, if any. */
  public async blocking(
    automationId: string,
  ): Promise<StoredAutomationRun | null> {
    const [row] = await this.database.query(
      `
      SELECT ${COLUMNS}
      FROM automation_runs
      WHERE automation_runs.automation_id = $automation_id
          AND automation_runs.status IN ('queued', 'accepted', 'delivered')
      ORDER BY automation_runs.sequence
      LIMIT 1;
    `,
      { automation_id: automationId },
    );
    return row ? readRunRow(row) : null;
  }

  /**
   * Removes the oldest ended runs beyond the kept number.
   *
   * @param automationId - The automation whose runs are removed.
   * @param keep - How many runs of the automation stay.
   */
  public async prune(automationId: string, keep: number): Promise<void> {
    await this.database.execute(
      `
      DELETE FROM automation_runs
      WHERE automation_id = $automation_id
          AND status IN ('completed', 'failed')
          AND id NOT IN (
              SELECT kept.id
              FROM automation_runs AS kept
              WHERE kept.automation_id = $automation_id
              ORDER BY kept.sequence DESC
              LIMIT $keep
          );
    `,
      { automation_id: automationId, keep },
    );
  }

  /** Whether a run of the automation started this plan run. */
  public async startedPlanRun(
    automationId: string,
    planRunId: string,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
      SELECT 1
      FROM automation_runs
      WHERE automation_id = $automation_id
          AND started_plan_run_id = $started_plan_run_id
      LIMIT 1;
    `,
      { automation_id: automationId, started_plan_run_id: planRunId },
    );
    return rows.length > 0;
  }

  /** Counts the runs an event started for an automation since a time. */
  public async countEventRunsSince(
    automationId: string,
    since: string,
  ): Promise<number> {
    const [row] = await this.database.query(
      `
      SELECT COUNT(id)
      FROM automation_runs
      WHERE automation_id = $automation_id
          AND trigger_kind = 'event'
          AND queued_at >= $since;
    `,
      { automation_id: automationId, since },
    );
    return readNumber(row?.[0]) ?? 0;
  }
}
