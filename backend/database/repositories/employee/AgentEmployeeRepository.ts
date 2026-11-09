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
  readonly monthlyCostLimit: number | null;
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
}

/** What an administrator changes on an agent beside its account. */
export interface AgentEmployeeChange {
  readonly connectionId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly access: AgentEmployeeAccess;
  readonly monthlyCostLimit: number | null;
  readonly soul: string;
  readonly instructions: string;
  readonly isLearningEnabled: boolean;
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
    monthly_cost_limit,
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
    updated_at`;

const STATUSES: readonly AgentLearningStatus[] = [
  "updated",
  "unchanged",
  "failed",
  "limitReached",
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

function readNullableNumber(
  row: readonly DatabaseValue[],
  index: number,
): number | null {
  const value = row[index];
  return typeof value === "number" ? value : null;
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
    monthlyCostLimit: readNullableNumber(row, 5),
    soul: readTextColumn(row, 6, "soul"),
    instructions: readTextColumn(row, 7, "instructions"),
    memory: readTextColumn(row, 8, "memory"),
    isLearningEnabled: readBooleanColumn(row, 9, "is_learning_enabled"),
    learningIntervalHours: readCountColumn(row, 10, "learning_interval_hours"),
    learnedThrough: readNullableTextColumn(row, 11, "learned_through"),
    lastLearningAt: readNullableTextColumn(row, 12, "last_learning_at"),
    lastLearningResult: readLearningResult(
      readNullableTextColumn(row, 13, "last_learning_result"),
    ),
    revision: readCountColumn(row, 14, "revision"),
    createdAt: readTextColumn(row, 15, "created_at"),
    updatedAt: readTextColumn(row, 16, "updated_at"),
  };
}

/**
 * Persists model, access, cost limit, documents and learning state of agents
 * (PAGE-266).
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
            monthly_cost_limit,
            soul,
            instructions,
            is_learning_enabled
        )
        VALUES (
            $user_id,
            $connection_id,
            $model,
            $reasoning_effort,
            $access,
            $monthly_cost_limit,
            $soul,
            $instructions,
            $is_learning_enabled
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
            monthly_cost_limit = $monthly_cost_limit,
            soul = $soul,
            instructions = $instructions,
            is_learning_enabled = $is_learning_enabled,
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
      monthly_cost_limit: change.monthlyCostLimit,
      soul: change.soul,
      instructions: change.instructions,
      is_learning_enabled: change.isLearningEnabled,
    };
  }
}
