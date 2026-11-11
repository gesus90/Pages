import {
  readBooleanColumn,
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AGENT_RUN_LOG_LEVELS } from "@/definition/AgentRunDiagnosis";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { RunLogRecord } from "@/backend/logging/RunLogSink";
import type {
  AgentRunLogEntry,
  AgentRunLogLevel,
  AgentRunLogSource,
} from "@/definition/AgentRunDiagnosis";

/** A log line ready to be stored: its text is already filtered and bounded. */
export interface StoredRunLogLine extends RunLogRecord {
  readonly isFiltered: boolean;
}

/** Which lines of a run a read wants. */
export interface RunLogQuery {
  readonly runId: string;
  readonly stepId: string | null;
  readonly attemptId: string | null;
  readonly minimumLevel: AgentRunLogLevel;
  readonly from: string | null;
  readonly to: string | null;
  /** The identifier of the last line the reader has. */
  readonly after: number;
  readonly limit: number;
}

/** One stored line with the identifier a page continues after. */
export interface RunLogRow extends Omit<AgentRunLogEntry, "message"> {
  readonly id: number;
  readonly message: string;
}

const LEVELS_FROM: Readonly<Record<AgentRunLogLevel, readonly string[]>> = {
  debug: AGENT_RUN_LOG_LEVELS,
  info: AGENT_RUN_LOG_LEVELS.slice(1),
  warn: AGENT_RUN_LOG_LEVELS.slice(2),
  error: AGENT_RUN_LOG_LEVELS.slice(3),
};

/** Stores and reads the log lines of plan runs (PAGE-307). */
export class AgentRunLogRepository {
  private readonly database: Pick<Database, "query" | "transaction">;

  public constructor(database: Pick<Database, "query" | "transaction">) {
    this.database = database;
  }

  /**
   * Appends lines in the order given.
   *
   * @param lines - Lines with a run, or with an attempt whose run the store finds.
   * @remarks
   * A line whose attempt belongs to no run is dropped: nobody could read it.
   */
  public async append(lines: readonly StoredRunLogLine[]): Promise<void> {
    if (lines.length === 0) return;
    await this.database.transaction(async (transaction) => {
      for (const line of lines)
        await transaction.execute(
          `
          INSERT INTO agent_run_logs (
              run_id,
              step_id,
              attempt_id,
              logged_at,
              level,
              source,
              message,
              is_filtered
          )
          SELECT
              COALESCE($run_id, attempts.run_id),
              COALESCE($step_id, attempts.step_id),
              $attempt_id,
              $logged_at,
              $level,
              $source,
              $message,
              $is_filtered
          FROM (SELECT 1) AS single_row
          LEFT JOIN agent_session_attempts AS attempts
              ON attempts.attempt_id = $attempt_id
          WHERE COALESCE($run_id, attempts.run_id) IS NOT NULL;
        `,
          {
            run_id: line.runId,
            step_id: line.stepId,
            attempt_id: line.attemptId,
            logged_at: line.at,
            level: line.level,
            source: line.source,
            message: line.message,
            is_filtered: line.isFiltered,
          },
        );
    });
  }

  /** Reads one page of a run's lines, oldest first, plus whether more follow. */
  public async read(query: RunLogQuery): Promise<{
    readonly rows: readonly RunLogRow[];
    readonly hasMore: boolean;
  }> {
    const parameters: Record<string, string | number> = {
      run_id: query.runId,
      after: query.after,
      limit: query.limit + 1,
    };
    const conditions = ["run_id = $run_id", "id > $after"];
    if (query.stepId !== null) {
      conditions.push("step_id = $step_id");
      parameters.step_id = query.stepId;
    }
    if (query.attemptId !== null) {
      conditions.push("attempt_id = $attempt_id");
      parameters.attempt_id = query.attemptId;
    }
    if (query.from !== null) {
      conditions.push("logged_at >= $from_at");
      parameters.from_at = query.from;
    }
    if (query.to !== null) {
      conditions.push("logged_at <= $to_at");
      parameters.to_at = query.to;
    }
    const levels = LEVELS_FROM[query.minimumLevel];
    conditions.push(
      `level IN (${levels.map((_, index) => `$level_${String(index)}`).join(", ")})`,
    );
    levels.forEach((level, index) => {
      parameters[`level_${String(index)}`] = level;
    });
    const rows = await this.database.query(
      `
      SELECT
          id,
          logged_at,
          level,
          source,
          step_id,
          attempt_id,
          message,
          is_filtered
      FROM agent_run_logs
      WHERE ${conditions.join("\n          AND ")}
      ORDER BY id
      LIMIT $limit;
    `,
      parameters,
    );
    const page = rows.slice(0, query.limit).map(readLogRow);
    return { rows: page, hasMore: rows.length > query.limit };
  }

  /**
   * Removes the lines older than a time.
   *
   * @param cutoff - ISO 8601 time; older lines go.
   * @returns How many lines were removed.
   */
  public async prune(cutoff: string): Promise<number> {
    const rows = await this.database.query(
      `
      WITH removed AS (
          DELETE FROM agent_run_logs
          WHERE logged_at < $cutoff
          RETURNING id
      )
      SELECT COUNT(*) FROM removed;
    `,
      { cutoff },
    );
    const [row] = rows;
    return row ? readCountColumn(row, 0, "count") : 0;
  }
}

function readLogRow(values: readonly DatabaseValue[]): RunLogRow {
  return {
    id: readCountColumn(values, 0, "id"),
    at: readTextColumn(values, 1, "logged_at"),
    level: readLevel(readTextColumn(values, 2, "level")),
    source: readSource(readTextColumn(values, 3, "source")),
    stepId: readNullableTextColumn(values, 4, "step_id"),
    attemptId: readNullableTextColumn(values, 5, "attempt_id"),
    message: readTextColumn(values, 6, "message"),
    isFiltered: readBooleanColumn(values, 7, "is_filtered"),
  };
}

function readLevel(text: string): AgentRunLogLevel {
  const level = AGENT_RUN_LOG_LEVELS.find((entry) => entry === text);
  if (level === undefined) throw new Error("Unknown run log level");
  return level;
}

function readSource(text: string): AgentRunLogSource {
  if (text === "server" || text === "runner" || text === "cli") return text;
  throw new Error("Unknown run log source");
}
