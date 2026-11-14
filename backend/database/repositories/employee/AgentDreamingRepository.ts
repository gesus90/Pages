import {
  readBooleanColumn,
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import {
  AGENT_DREAM_INTERVAL_UNITS,
  AGENT_DREAM_LOG_KINDS,
  AGENT_DREAM_NO_COUNTS,
} from "@/definition/AgentDreaming";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  AgentDreamCounts,
  AgentDreamLogEntry,
  AgentDreamRunStatus,
  AgentDreamSchedule,
  AgentDreamTrigger,
} from "@/definition/AgentDreaming";

/** The schedule of an agent and what a finished run read, as it is stored (PAGE-378). */
export interface StoredAgentDreaming {
  readonly agentId: string;
  readonly schedule: AgentDreamSchedule;
  /** The model of the run; `null` is the agent's own model. */
  readonly model: {
    readonly connectionId: string;
    readonly model: string;
  } | null;
  /** `YYYY-MM-DD HH:MM:SS` UTC of the last run, whatever its outcome. */
  readonly lastRunAt: string | null;
  /** `YYYY-MM-DD HH:MM:SS` UTC the agent was created, the start of its first interval. */
  readonly createdAt: string;
  /** A run somebody asked for that has not run yet. */
  readonly request: AgentDreamRequest | null;
  /** The newest Lagebuch entry a finished run has read; the sequence. */
  readonly logbookThrough: number;
  /** The newest tool use a finished run has read. */
  readonly toolsThrough: number;
  readonly lastRun: StoredDreamRun | null;
}

/** A run somebody asked for: a person with "Jetzt träumen", or a Lagebuch that is full. */
export interface AgentDreamRequest {
  /** `YYYY-MM-DD HH:MM:SS` UTC of the request. */
  readonly at: string;
  readonly trigger: Exclude<AgentDreamTrigger, "schedule">;
}

/** The log of the last run as it is stored. */
export interface StoredDreamRun {
  /** ISO time the run ended. */
  readonly at: string;
  readonly status: AgentDreamRunStatus;
  readonly trigger: AgentDreamTrigger | null;
  readonly errorCode: string | null;
  readonly counts: AgentDreamCounts;
  readonly log: readonly AgentDreamLogEntry[];
}

/** What a schedule change saves. */
export interface AgentDreamScheduleChange {
  readonly schedule: AgentDreamSchedule;
  readonly model: {
    readonly connectionId: string;
    readonly model: string;
  } | null;
}

/** What a finished run stores about itself beside the result. */
export interface AgentDreamRunRecord {
  readonly run: StoredDreamRun;
  /** The new Lagebuch cursor; `null` keeps the old one. */
  readonly logbookThrough: number | null;
  /** The new cursor of the tool uses; `null` keeps the old one. */
  readonly toolsThrough: number | null;
}

/**
 * The columns of the schedule beside the switch `is_learning_enabled`, in
 * the order {@link readDreamSchedule} reads them.
 */
export const DREAM_SCHEDULE_COLUMNS = `
    dream_interval,
    dream_unit,
    dream_time,
    dream_weekday,
    dream_on_full_logbook`;

const COLUMNS = `
    user_id,
    is_learning_enabled,
    ${DREAM_SCHEDULE_COLUMNS},
    dream_connection_id,
    dream_model,
    last_learning_at,
    created_at,
    dream_requested_at,
    dream_requested_trigger,
    dream_logbook_through,
    dream_tools_through,
    dream_last_run`;

const STATUSES: readonly AgentDreamRunStatus[] = [
  "updated",
  "unchanged",
  "failed",
];
const TRIGGERS: readonly AgentDreamTrigger[] = [
  "schedule",
  "manual",
  "logbook",
];

function readCount(input: unknown): number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0
    ? input
    : 0;
}

function readCounts(input: unknown): AgentDreamCounts {
  const counts = { ...AGENT_DREAM_NO_COUNTS };
  if (typeof input !== "object" || input === null) return counts;
  for (const kind of AGENT_DREAM_LOG_KINDS)
    counts[kind] = readCount(Reflect.get(input, kind));
  return counts;
}

function readLog(input: unknown): AgentDreamLogEntry[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const kind: unknown = Reflect.get(entry, "kind");
    const text: unknown = Reflect.get(entry, "text");
    const match = AGENT_DREAM_LOG_KINDS.find((candidate) => candidate === kind);
    return match !== undefined && typeof text === "string"
      ? [{ kind: match, text }]
      : [];
  });
}

/** Reads a stored run; anything unreadable counts as none. */
function readRun(text: string | null): StoredDreamRun | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const status = STATUSES.find(
      (entry) => entry === Reflect.get(parsed, "status"),
    );
    const at: unknown = Reflect.get(parsed, "at");
    if (status === undefined || typeof at !== "string") return null;
    const errorCode: unknown = Reflect.get(parsed, "errorCode");
    return {
      at,
      status,
      trigger:
        TRIGGERS.find((entry) => entry === Reflect.get(parsed, "trigger")) ??
        null,
      errorCode: typeof errorCode === "string" ? errorCode : null,
      counts: readCounts(Reflect.get(parsed, "counts")),
      log: readLog(Reflect.get(parsed, "log")),
    };
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function readUnit(text: string): AgentDreamSchedule["unit"] {
  return AGENT_DREAM_INTERVAL_UNITS.find((unit) => unit === text) ?? "days";
}

function readNullableCount(
  row: readonly DatabaseValue[],
  index: number,
  name: string,
): number | null {
  return readNullableTextColumn(row, index, name) === null
    ? null
    : readCountColumn(row, index, name);
}

/**
 * Reads the schedule columns of a row.
 *
 * @param row - A row that holds {@link DREAM_SCHEDULE_COLUMNS}.
 * @param offset - The index of the first of them.
 * @param isEnabled - The switch `is_learning_enabled` of the same row.
 */
export function readDreamSchedule(
  row: readonly DatabaseValue[],
  offset: number,
  isEnabled: boolean,
): AgentDreamSchedule {
  return {
    isEnabled,
    interval: readCountColumn(row, offset, "dream_interval"),
    unit: readUnit(readTextColumn(row, offset + 1, "dream_unit")),
    time: readNullableTextColumn(row, offset + 2, "dream_time"),
    weekday: readNullableCount(row, offset + 3, "dream_weekday"),
    isOnFullLogbook: readBooleanColumn(
      row,
      offset + 4,
      "dream_on_full_logbook",
    ),
  };
}

/**
 * Reads a request for a run.
 *
 * @param row - A row that holds `dream_requested_at` and `dream_requested_trigger` in a row.
 * @param offset - The index of the first of them.
 */
export function readDreamRequest(
  row: readonly DatabaseValue[],
  offset: number,
): AgentDreamRequest | null {
  const at = readNullableTextColumn(row, offset, "dream_requested_at");
  const trigger = readNullableTextColumn(
    row,
    offset + 1,
    "dream_requested_trigger",
  );
  if (at === null) return null;
  return { at, trigger: trigger === "logbook" ? "logbook" : "manual" };
}

function read(row: readonly DatabaseValue[]): StoredAgentDreaming {
  const connectionId = readNullableTextColumn(row, 7, "dream_connection_id");
  const model = readNullableTextColumn(row, 8, "dream_model");
  return {
    agentId: readTextColumn(row, 0, "user_id"),
    schedule: readDreamSchedule(
      row,
      2,
      readBooleanColumn(row, 1, "is_learning_enabled"),
    ),
    model:
      connectionId !== null && model !== null ? { connectionId, model } : null,
    lastRunAt: readNullableTextColumn(row, 9, "last_learning_at"),
    createdAt: readTextColumn(row, 10, "created_at"),
    request: readDreamRequest(row, 11),
    logbookThrough: readCountColumn(row, 13, "dream_logbook_through"),
    toolsThrough: readCountColumn(row, 14, "dream_tools_through"),
    lastRun: readRun(readNullableTextColumn(row, 15, "dream_last_run")),
  };
}

/**
 * The schedule and the run state of the dream run of agents (PAGE-378).
 *
 * @remarks
 * Saving the schedule keeps the revision of the agent, because a running
 * session ends at its next turn when the revision changes and the schedule
 * changes no session.
 */
export class AgentDreamingRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** The schedule of one agent; `null` for an unknown agent. */
  public async find(agentId: string): Promise<StoredAgentDreaming | null> {
    const [row] = await this.database.query(
      `SELECT ${COLUMNS} FROM agent_employees WHERE user_id = $agent_id;`,
      { agent_id: agentId },
    );
    return row ? read(row) : null;
  }

  /**
   * Saves the schedule, the switch and the model of an agent.
   *
   * @returns Whether the agent exists.
   */
  public async saveSchedule(
    agentId: string,
    change: AgentDreamScheduleChange,
  ): Promise<boolean> {
    const { schedule, model } = change;
    const rows = await this.database.query(
      `
        UPDATE agent_employees
        SET
            is_learning_enabled = $is_enabled,
            dream_interval = $interval,
            dream_unit = $unit,
            dream_time = $time,
            dream_weekday = $weekday,
            dream_on_full_logbook = $is_on_full_logbook,
            dream_connection_id = $connection_id,
            dream_model = $model
        WHERE user_id = $agent_id
        RETURNING user_id;
      `,
      {
        agent_id: agentId,
        is_enabled: schedule.isEnabled,
        interval: schedule.interval,
        unit: schedule.unit,
        time: schedule.time,
        weekday: schedule.weekday,
        is_on_full_logbook: schedule.isOnFullLogbook,
        connection_id: model?.connectionId ?? null,
        model: model?.model ?? null,
      },
    );
    return rows.length > 0;
  }

  /**
   * Notes that somebody asked for a run that waits for the agent to leave its
   * chats; a request already waiting stays as it is.
   */
  public async saveRequest(
    agentId: string,
    request: AgentDreamRequest,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_employees
        SET
            dream_requested_at = $at,
            dream_requested_trigger = $trigger
        WHERE user_id = $agent_id
            AND dream_requested_at IS NULL;
      `,
      { agent_id: agentId, at: request.at, trigger: request.trigger },
    );
  }

  /** Stores the log of a finished run and moves the cursors of what it read. */
  public async saveRun(
    agentId: string,
    record: AgentDreamRunRecord,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_employees
        SET
            dream_last_run = $last_run,
            dream_requested_at = NULL,
            dream_requested_trigger = NULL,
            dream_logbook_through = COALESCE($logbook_through, dream_logbook_through),
            dream_tools_through = COALESCE($tools_through, dream_tools_through)
        WHERE user_id = $agent_id;
      `,
      {
        agent_id: agentId,
        last_run: JSON.stringify(record.run),
        logbook_through: record.logbookThrough,
        tools_through: record.toolsThrough,
      },
    );
  }
}
