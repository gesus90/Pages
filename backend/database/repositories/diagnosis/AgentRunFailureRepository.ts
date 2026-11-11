import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { logCaughtError } from "@/backend/logging/Logger";
import { isAgentRunErrorClass } from "@/definition/AgentRunDiagnosis";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type {
  AgentRunErrorClass,
  AgentRunFailureGrouping,
} from "@/definition/AgentRunDiagnosis";

/** A failed step as the index stores it. */
export interface IndexedFailure {
  readonly stepId: string;
  readonly stepLabel: string;
  readonly loopId: string | null;
  readonly iteration: number | null;
  readonly attemptId: string | null;
  readonly errorClass: AgentRunErrorClass;
  readonly errorCode: string;
  readonly occurredAt: string;
}

/** What the index remembers of one run. */
export interface RunFailureIndexEntry {
  readonly runId: string;
  readonly revision: number;
  readonly planId: string;
  readonly planName: string;
  readonly projectId: string;
  readonly startedById: string;
  readonly endedAt: string | null;
  readonly failedStepId: string | null;
  readonly errorClass: AgentRunErrorClass | null;
  readonly errorCode: string | null;
  readonly failures: readonly IndexedFailure[];
}

/** The stored view of a run with the revision it was read at. */
export interface RunToIndex {
  readonly run: AgentPlanRun | null;
  readonly revision: number;
  readonly runId: string;
  readonly planId: string;
  readonly projectId: string;
  readonly startedById: string;
}

/** Narrows a list of runs or failures. */
export interface RunSearchFilters {
  /** The plans the reader may see; nothing outside them is ever returned. */
  readonly planIds: readonly string[];
  readonly projectId: string | null;
  readonly planId: string | null;
  readonly status: string | null;
  readonly stepId: string | null;
  readonly errorClass: AgentRunErrorClass | null;
  readonly startedById: string | null;
  readonly from: string | null;
  readonly to: string | null;
}

/** One row of the run list as stored. */
export interface RunSearchRow {
  readonly runId: string;
  readonly planId: string;
  readonly planName: string;
  readonly projectId: string;
  readonly status: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly startedById: string;
  readonly failedStepId: string | null;
  readonly errorClass: AgentRunErrorClass | null;
  readonly errorCode: string | null;
}

/** One group of the failure overview as stored. */
export interface FailureGroupRow {
  readonly errorClass: AgentRunErrorClass | null;
  readonly planId: string | null;
  readonly planName: string | null;
  readonly stepId: string | null;
  readonly stepLabel: string | null;
  readonly count: number;
  readonly firstAt: string;
  readonly lastAt: string;
  readonly exampleRunIds: readonly string[];
}

interface Statement {
  readonly where: string;
  readonly parameters: Record<string, string | number>;
}

function placeholders(
  prefix: string,
  values: readonly string[],
  parameters: Record<string, string | number>,
): string {
  if (values.length === 0) return "NULL";
  return values
    .map((value, index) => {
      const name = `${prefix}_${String(index)}`;
      parameters[name] = value;
      return `$${name}`;
    })
    .join(", ");
}

/** Builds the filters of the run list over `runs` and its index entry `indexed`. */
function runStatement(filters: RunSearchFilters): Statement {
  const parameters: Record<string, string | number> = {};
  const conditions = [
    `runs.plan_id IN (${placeholders("plan", filters.planIds, parameters)})`,
  ];
  const equals: readonly (readonly [string, string | null, string])[] = [
    ["runs.project_id", filters.projectId, "project_id"],
    ["runs.plan_id", filters.planId, "plan_id_filter"],
    ["runs.status", filters.status, "status"],
    ["runs.user_id", filters.startedById, "started_by_id"],
  ];
  for (const [column, value, name] of equals)
    if (value !== null) {
      conditions.push(`${column} = $${name}`);
      parameters[name] = value;
    }
  if (filters.from !== null) {
    conditions.push("runs.started_at >= $from_at");
    parameters.from_at = filters.from;
  }
  if (filters.to !== null) {
    conditions.push("runs.started_at <= $to_at");
    parameters.to_at = filters.to;
  }
  const failure = failureCondition(filters, parameters);
  if (failure !== null) conditions.push(failure);
  return { where: conditions.join("\n          AND "), parameters };
}

function failureCondition(
  filters: RunSearchFilters,
  parameters: Record<string, string | number>,
): string | null {
  const parts: string[] = [];
  if (filters.stepId !== null) {
    parts.push("failures.step_id = $failure_step_id");
    parameters.failure_step_id = filters.stepId;
  }
  if (filters.errorClass !== null) {
    parts.push("failures.error_class = $failure_class");
    parameters.failure_class = filters.errorClass;
  }
  if (parts.length === 0) return null;
  return `EXISTS (
              SELECT 1
              FROM agent_run_failures AS failures
              WHERE failures.run_id = runs.id
                  AND ${parts.join("\n                  AND ")}
          )`;
}

function readClass(
  row: readonly DatabaseValue[],
  index: number,
): AgentRunErrorClass | null {
  const text = readNullableTextColumn(row, index, "error_class");
  return isAgentRunErrorClass(text) ? text : null;
}

function readRunRow(row: readonly DatabaseValue[]): RunSearchRow {
  return {
    runId: readTextColumn(row, 0, "id"),
    planId: readTextColumn(row, 1, "plan_id"),
    planName: readTextColumn(row, 2, "plan_name"),
    projectId: readTextColumn(row, 3, "project_id"),
    status: readTextColumn(row, 4, "status"),
    startedAt: readTextColumn(row, 5, "started_at"),
    endedAt: readNullableTextColumn(row, 6, "ended_at"),
    startedById: readTextColumn(row, 7, "user_id"),
    failedStepId: readNullableTextColumn(row, 8, "failed_step_id"),
    errorClass: readClass(row, 9),
    errorCode: readNullableTextColumn(row, 10, "error_code"),
  };
}

const UPSERT_INDEX = `
  INSERT INTO agent_run_failure_index (
      run_id,
      indexed_revision,
      plan_id,
      plan_name,
      ended_at,
      failed_step_id,
      error_class,
      error_code
  ) VALUES (
      $run_id,
      $revision,
      $plan_id,
      $plan_name,
      $ended_at,
      $failed_step_id,
      $error_class,
      $error_code
  )
  ON CONFLICT (run_id) DO UPDATE SET
      indexed_revision = EXCLUDED.indexed_revision,
      plan_id = EXCLUDED.plan_id,
      plan_name = EXCLUDED.plan_name,
      ended_at = EXCLUDED.ended_at,
      failed_step_id = EXCLUDED.failed_step_id,
      error_class = EXCLUDED.error_class,
      error_code = EXCLUDED.error_code;
`;

async function insertFailure(
  transaction: DatabaseTransaction,
  entry: RunFailureIndexEntry,
  failure: IndexedFailure,
): Promise<void> {
  await transaction.execute(
    `
    INSERT INTO agent_run_failures (
        run_id,
        failure_key,
        plan_id,
        plan_name,
        project_id,
        started_by_id,
        step_id,
        step_label,
        loop_id,
        iteration,
        attempt_id,
        error_class,
        error_code,
        occurred_at
    ) VALUES (
        $run_id,
        $failure_key,
        $plan_id,
        $plan_name,
        $project_id,
        $started_by_id,
        $step_id,
        $step_label,
        $loop_id,
        $iteration,
        $attempt_id,
        $error_class,
        $error_code,
        $occurred_at
    );
  `,
    {
      run_id: entry.runId,
      failure_key: `${failure.loopId ?? ""}/${String(failure.iteration ?? 0)}/${failure.stepId}`,
      plan_id: entry.planId,
      plan_name: entry.planName,
      project_id: entry.projectId,
      started_by_id: entry.startedById,
      step_id: failure.stepId,
      step_label: failure.stepLabel,
      loop_id: failure.loopId,
      iteration: failure.iteration,
      attempt_id: failure.attemptId,
      error_class: failure.errorClass,
      error_code: failure.errorCode,
      occurred_at: failure.occurredAt,
    },
  );
}

const GROUP_COLUMNS: Readonly<
  Record<
    AgentRunFailureGrouping,
    { readonly select: string; readonly group: string }
  >
> = {
  errorClass: {
    select: "failures.error_class, NULL, NULL, NULL, NULL",
    group: "failures.error_class",
  },
  plan: {
    select: "NULL, failures.plan_id, MAX(failures.plan_name), NULL, NULL",
    group: "failures.plan_id",
  },
  step: {
    select:
      "NULL, failures.plan_id, MAX(failures.plan_name), failures.step_id, MAX(failures.step_label)",
    group: "failures.plan_id, failures.step_id",
  },
};

/** Stores the classified failures of runs and answers the lists over them (PAGE-307). */
export class AgentRunFailureRepository {
  private readonly database: Pick<Database, "query" | "transaction">;

  public constructor(database: Pick<Database, "query" | "transaction">) {
    this.database = database;
  }

  /**
   * Lists runs whose failures were not read at their current revision.
   *
   * @param since - ISO 8601 start time; older runs are left out.
   * @param limit - The most runs returned.
   */
  public async pending(
    since: string,
    limit: number,
  ): Promise<readonly string[]> {
    const rows = await this.database.query(
      `
      SELECT runs.id
      FROM agent_plan_runs AS runs
      LEFT JOIN agent_run_failure_index AS indexed
          ON indexed.run_id = runs.id
      WHERE runs.started_at >= $since
          AND (
              indexed.run_id IS NULL
              OR indexed.indexed_revision <> runs.recovery_revision
          )
      ORDER BY runs.started_at DESC, runs.id DESC
      LIMIT $limit;
    `,
      { since, limit },
    );
    return rows.map((row) => readTextColumn(row, 0, "id"));
  }

  /** Reads the stored view of a run for indexing; a damaged record has no run. */
  public async load(runId: string): Promise<RunToIndex | null> {
    const [row] = await this.database.query(
      `
      SELECT
          view_json,
          recovery_revision,
          plan_id,
          project_id,
          user_id
      FROM agent_plan_runs
      WHERE id = $run_id;
    `,
      { run_id: runId },
    );
    if (!row) return null;
    return {
      run: this.parse(readTextColumn(row, 0, "view_json")),
      revision: readCountColumn(row, 1, "recovery_revision"),
      runId,
      planId: readTextColumn(row, 2, "plan_id"),
      projectId: readTextColumn(row, 3, "project_id"),
      startedById: readTextColumn(row, 4, "user_id"),
    };
  }

  /** Replaces the failures of a run and remembers the revision they come from. */
  public async replace(entry: RunFailureIndexEntry): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        "DELETE FROM agent_run_failures WHERE run_id = $run_id;",
        { run_id: entry.runId },
      );
      for (const failure of entry.failures)
        await insertFailure(transaction, entry, failure);
      await transaction.execute(UPSERT_INDEX, {
        run_id: entry.runId,
        revision: entry.revision,
        plan_id: entry.planId,
        plan_name: entry.planName,
        ended_at: entry.endedAt,
        failed_step_id: entry.failedStepId,
        error_class: entry.errorClass,
        error_code: entry.errorCode,
      });
    });
  }

  /** Counts the runs a search matches. */
  public async count(filters: RunSearchFilters): Promise<number> {
    const { where, parameters } = runStatement(filters);
    const [row] = await this.database.query(
      `
      SELECT COUNT(*)
      FROM agent_plan_runs AS runs
      WHERE ${where};
    `,
      parameters,
    );
    return row ? readCountColumn(row, 0, "count") : 0;
  }

  /** Reads one window of the runs a search matches, newest first. */
  public async search(
    filters: RunSearchFilters,
    window: { readonly offset: number; readonly limit: number },
  ): Promise<readonly RunSearchRow[]> {
    const { where, parameters } = runStatement(filters);
    const rows = await this.database.query(
      `
      SELECT
          runs.id,
          runs.plan_id,
          COALESCE(indexed.plan_name, runs.plan_id),
          runs.project_id,
          runs.status,
          runs.started_at,
          indexed.ended_at,
          runs.user_id,
          indexed.failed_step_id,
          indexed.error_class,
          indexed.error_code
      FROM agent_plan_runs AS runs
      LEFT JOIN agent_run_failure_index AS indexed
          ON indexed.run_id = runs.id
      WHERE ${where}
      ORDER BY runs.started_at DESC, runs.id DESC
      LIMIT $window_limit
      OFFSET $window_offset;
    `,
      {
        ...parameters,
        window_limit: window.limit,
        window_offset: window.offset,
      },
    );
    return rows.map(readRunRow);
  }

  /** Groups the failed steps a search matches. */
  public async groups(
    filters: RunSearchFilters,
    grouping: AgentRunFailureGrouping,
    limit: number,
  ): Promise<readonly FailureGroupRow[]> {
    const { statement, parameters } = failureStatement(filters);
    const columns = GROUP_COLUMNS[grouping];
    const rows = await this.database.query(
      `
      SELECT
          ${columns.select},
          COUNT(*),
          MIN(failures.occurred_at),
          MAX(failures.occurred_at),
          array_to_string(
              (ARRAY_AGG(
                  failures.run_id
                  ORDER BY (runs.id IS NULL), failures.occurred_at DESC
              ))[1:40],
              ','
          )
      FROM agent_run_failures AS failures
      LEFT JOIN agent_plan_runs AS runs
          ON runs.id = failures.run_id
      WHERE ${statement}
      GROUP BY ${columns.group}
      ORDER BY COUNT(*) DESC, MAX(failures.occurred_at) DESC
      LIMIT $group_limit;
    `,
      { ...parameters, group_limit: limit },
    );
    return rows.map((row) => ({
      errorClass: readClass(row, 0),
      planId: readNullableTextColumn(row, 1, "plan_id"),
      planName: readNullableTextColumn(row, 2, "plan_name"),
      stepId: readNullableTextColumn(row, 3, "step_id"),
      stepLabel: readNullableTextColumn(row, 4, "step_label"),
      count: readCountColumn(row, 5, "count"),
      firstAt: readTextColumn(row, 6, "first_at"),
      lastAt: readTextColumn(row, 7, "last_at"),
      exampleRunIds: [...new Set(readTextColumn(row, 8, "run_ids").split(","))],
    }));
  }

  /** Counts the failed steps a search matches. */
  public async totalFailedSteps(filters: RunSearchFilters): Promise<number> {
    const { statement, parameters } = failureStatement(filters);
    const [row] = await this.database.query(
      `
      SELECT COUNT(*)
      FROM agent_run_failures AS failures
      WHERE ${statement};
    `,
      parameters,
    );
    return row ? readCountColumn(row, 0, "count") : 0;
  }

  /**
   * Removes the failures of runs that started before a time.
   *
   * @param cutoff - ISO 8601 time.
   */
  public async prune(cutoff: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        "DELETE FROM agent_run_failures WHERE occurred_at < $cutoff;",
        { cutoff },
      );
      await transaction.execute(
        `
        DELETE FROM agent_run_failure_index
        WHERE run_id NOT IN (SELECT id FROM agent_plan_runs);
      `,
      );
    });
  }

  private parse(text: string): AgentPlanRun | null {
    try {
      const input: unknown = JSON.parse(text);
      return readPlanRun(input);
    } catch (error: unknown) {
      logCaughtError("AgentRunFailureRepository", error);

      return null;
    }
  }
}

function failureStatement(filters: RunSearchFilters): {
  readonly statement: string;
  readonly parameters: Record<string, string | number>;
} {
  const parameters: Record<string, string | number> = {};
  const conditions = [
    `failures.plan_id IN (${placeholders("plan", filters.planIds, parameters)})`,
  ];
  const equals: readonly (readonly [string, string | null, string])[] = [
    ["failures.project_id", filters.projectId, "project_id"],
    ["failures.plan_id", filters.planId, "plan_id_filter"],
    ["failures.step_id", filters.stepId, "step_id"],
    ["failures.error_class", filters.errorClass, "error_class"],
    ["failures.started_by_id", filters.startedById, "started_by_id"],
  ];
  for (const [column, value, name] of equals)
    if (value !== null) {
      conditions.push(`${column} = $${name}`);
      parameters[name] = value;
    }
  if (filters.from !== null) {
    conditions.push("failures.occurred_at >= $from_at");
    parameters.from_at = filters.from;
  }
  if (filters.to !== null) {
    conditions.push("failures.occurred_at <= $to_at");
    parameters.to_at = filters.to;
  }
  return { statement: conditions.join("\n          AND "), parameters };
}
