import {
  readBooleanColumn,
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { isAgentEmployeeAccess } from "@/definition/AgentEmployee";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  AgentEmployeeAccess,
  AgentLearningResult,
  AgentLearningStatus,
} from "@/definition/AgentEmployee";

/** The stored configuration and documents of one agent. */
export interface StoredAgentEmployee {
  readonly userId: string;
  readonly connectionId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly access: AgentEmployeeAccess;
  readonly soul: string;
  readonly instructions: string;
  readonly memory: string;
  readonly isLearningEnabled: boolean;
  readonly learningIntervalHours: number;
  /** The newest source time the last learning run took in, `YYYY-MM-DD HH:MM:SS` UTC. */
  readonly learnedThrough: string | null;
  readonly lastLearningAt: string | null;
  readonly lastLearningResult: AgentLearningResult | null;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The chosen voice ID (PAGE-300); `null` for the first voice of the model. */
  readonly voiceId: string | null;
  /** The speed of the voice in tenths, 5 to 20. */
  readonly voiceSpeedTenths: number;
}

/** What an administrator changes on an agent beside its account. */
export interface AgentEmployeeChange {
  readonly connectionId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly access: AgentEmployeeAccess;
  readonly soul: string;
  readonly instructions: string;
  readonly isLearningEnabled: boolean;
  readonly voiceId: string | null;
  readonly voiceSpeedTenths: number;
}

/** What a learning run stores about itself. */
export interface AgentLearningRecord {
  readonly learnedThrough: string | null;
  readonly lastLearningAt: string;
  readonly result: AgentLearningResult;
}

const COLUMNS = `
    user_id,
    connection_id,
    model,
    reasoning_effort,
    access,
    soul,
    instructions,
    memory,
    is_learning_enabled,
    learning_interval_hours,
    learned_through,
    last_learning_at,
    last_learning_result,
    revision,
    created_at,
    updated_at,
    voice_id,
    voice_speed_tenths`;

const STATUSES: readonly AgentLearningStatus[] = [
  "updated",
  "unchanged",
  "failed",
];

function readCount(input: unknown): number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0
    ? input
    : 0;
}

/** Reads a stored learning result; anything unreadable counts as none. */
function readLearningResult(text: string | null): AgentLearningResult | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const status: unknown = Reflect.get(parsed, "status");
    const match = STATUSES.find((entry) => entry === status);
    if (match === undefined) return null;
    const errorCode: unknown = Reflect.get(parsed, "errorCode");
    return {
      status: match,
      added: readCount(Reflect.get(parsed, "added")),
      merged: readCount(Reflect.get(parsed, "merged")),
      archived: readCount(Reflect.get(parsed, "archived")),
      removed: readCount(Reflect.get(parsed, "removed")),
      errorCode: typeof errorCode === "string" ? errorCode : null,
    };
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function readEmployee(row: readonly DatabaseValue[]): StoredAgentEmployee {
  const access = readTextColumn(row, 4, "access");
  if (!isAgentEmployeeAccess(access))
    throw new Error("Database returned an unsupported agent access.");
  return {
    userId: readTextColumn(row, 0, "user_id"),
    connectionId: readTextColumn(row, 1, "connection_id"),
    model: readTextColumn(row, 2, "model"),
    reasoningEffort: readNullableTextColumn(row, 3, "reasoning_effort"),
    access,
    soul: readTextColumn(row, 5, "soul"),
    instructions: readTextColumn(row, 6, "instructions"),
    memory: readTextColumn(row, 7, "memory"),
    isLearningEnabled: readBooleanColumn(row, 8, "is_learning_enabled"),
    learningIntervalHours: readCountColumn(row, 9, "learning_interval_hours"),
    learnedThrough: readNullableTextColumn(row, 10, "learned_through"),
    lastLearningAt: readNullableTextColumn(row, 11, "last_learning_at"),
    lastLearningResult: readLearningResult(
      readNullableTextColumn(row, 12, "last_learning_result"),
    ),
    revision: readCountColumn(row, 13, "revision"),
    createdAt: readTextColumn(row, 14, "created_at"),
    updatedAt: readTextColumn(row, 15, "updated_at"),
    voiceId: readNullableTextColumn(row, 16, "voice_id"),
    voiceSpeedTenths: readCountColumn(row, 17, "voice_speed_tenths"),
  };
}

/**
 * Persists model, access, voice, documents and learning state of agents
 * (PAGE-266, PAGE-300).
 *
 * @remarks
 * The account itself lives in `users`; this table holds only what an agent
 * has beside it. Callers authorize every change before they use it.
 */
export class AgentEmployeeRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Returns the stored agent of an account, or `null` for a person. */
  public async find(userId: string): Promise<StoredAgentEmployee | null> {
    const rows = await this.database.query(
      `
        SELECT ${COLUMNS}
        FROM agent_employees
        WHERE user_id = $user_id;
      `,
      { user_id: userId },
    );
    const row = rows[0];
    return row ? readEmployee(row) : null;
  }

  /** Returns every stored agent in creation order. */
  public async list(): Promise<StoredAgentEmployee[]> {
    const rows = await this.database.query(`
      SELECT ${COLUMNS}
      FROM agent_employees
      ORDER BY created_at, user_id;
    `);
    return rows.map(readEmployee);
  }

  /** Stores the configuration of a new agent account. */
  public async create(
    userId: string,
    change: AgentEmployeeChange,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO agent_employees (
            user_id,
            connection_id,
            model,
            reasoning_effort,
            access,
            soul,
            instructions,
            is_learning_enabled,
            voice_id,
            voice_speed_tenths
        )
        VALUES (
            $user_id,
            $connection_id,
            $model,
            $reasoning_effort,
            $access,
            $soul,
            $instructions,
            $is_learning_enabled,
            $voice_id,
            $voice_speed_tenths
        );
      `,
      { user_id: userId, ...this.parameters(change) },
    );
  }

  /**
   * Replaces the configuration of an agent when nobody changed it since it was read.
   *
   * @returns Whether the expected revision matched and the change was stored.
   */
  public async update(
    userId: string,
    change: AgentEmployeeChange,
    expectedRevision: number,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE agent_employees
        SET
            connection_id = $connection_id,
            model = $model,
            reasoning_effort = $reasoning_effort,
            access = $access,
            soul = $soul,
            instructions = $instructions,
            is_learning_enabled = $is_learning_enabled,
            voice_id = $voice_id,
            voice_speed_tenths = $voice_speed_tenths,
            revision = revision + 1,
            updated_at = utc_now()
        WHERE user_id = $user_id
            AND revision = $revision
        RETURNING user_id;
      `,
      {
        user_id: userId,
        revision: expectedRevision,
        ...this.parameters(change),
      },
    );
    return rows.length === 1;
  }

  /**
   * Counts a change of an agent that the configuration itself does not
   * hold, such as a restored memory, when nobody changed it since it was read.
   *
   * @param userId - The agent's account.
   * @param expectedRevision - The revision the caller read; `null` counts the change without a check.
   * @returns Whether the expected revision matched and the revision was raised.
   */
  public async touch(
    userId: string,
    expectedRevision: number | null,
  ): Promise<boolean> {
    const condition =
      expectedRevision === null ? "" : "AND revision = $revision";
    // Only the fixed condition is interpolated; the revision is bound as a value.
    const rows = await this.database.query(
      `
        UPDATE agent_employees
        SET
            revision = revision + 1,
            updated_at = utc_now()
        WHERE user_id = $user_id
            ${condition}
        RETURNING user_id;
      `,
      expectedRevision === null
        ? { user_id: userId }
        : { user_id: userId, revision: expectedRevision },
    );
    return rows.length === 1;
  }

  /** Replaces `MEMORY.md`. */
  public async saveMemory(userId: string, memory: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_employees
        SET
            memory = $memory,
            updated_at = utc_now()
        WHERE user_id = $user_id;
      `,
      { user_id: userId, memory },
    );
  }

  /** Stores the outcome of a learning run. */
  public async saveLearning(
    userId: string,
    record: AgentLearningRecord,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_employees
        SET
            learned_through = COALESCE($learned_through, learned_through),
            last_learning_at = $last_learning_at,
            last_learning_result = $last_learning_result
        WHERE user_id = $user_id;
      `,
      {
        user_id: userId,
        learned_through: record.learnedThrough,
        last_learning_at: record.lastLearningAt,
        last_learning_result: JSON.stringify(record.result),
      },
    );
  }

  private parameters(
    change: AgentEmployeeChange,
  ): Readonly<Record<string, string | number | boolean | null>> {
    return {
      connection_id: change.connectionId,
      model: change.model,
      reasoning_effort: change.reasoningEffort,
      access: change.access,
      soul: change.soul,
      instructions: change.instructions,
      is_learning_enabled: change.isLearningEnabled,
      voice_id: change.voiceId,
      voice_speed_tenths: change.voiceSpeedTenths,
    };
  }
}
