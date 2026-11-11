import { z } from "zod";

import { readTextColumn } from "@/backend/database/RowValue";
import { AGENT_TODO_STATUSES } from "@/definition/AgentPlanAgentTodos";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanAgentTodo } from "@/definition/AgentPlanAgentTodos";

/** The stored TODO list of one attempt, its entries as JSON. */
export interface StoredAgentTodoList {
  readonly runId: string;
  readonly stepId: string;
  readonly attemptId: string;
  readonly todosJson: string;
  readonly updatedAt: string;
}

/** Stores the TODO list a CLI reported, one row per attempt (PAGE-306). */
export class AgentPlanAgentTodoRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Reads the entries stored for an attempt; empty before its first plan. */
  public async findEntries(
    attemptId: string,
  ): Promise<readonly AgentPlanAgentTodo[]> {
    const [row] = await this.database.query(
      `
      SELECT todos_json
      FROM agent_plan_agent_todos
      WHERE attempt_id = $attempt_id;
    `,
      { attempt_id: attemptId },
    );
    return row ? readEntries(readTextColumn(row, 0, "todos_json")) : [];
  }

  /** Reads the lists of every attempt of a run. */
  public async listForRun(
    runId: string,
  ): Promise<readonly StoredAgentTodoList[]> {
    const rows = await this.database.query(
      `
      SELECT
          run_id,
          step_id,
          attempt_id,
          todos_json,
          updated_at
      FROM agent_plan_agent_todos
      WHERE run_id = $run_id
      ORDER BY attempt_id;
    `,
      { run_id: runId },
    );
    return rows.map((row) => ({
      runId: readTextColumn(row, 0, "run_id"),
      stepId: readTextColumn(row, 1, "step_id"),
      attemptId: readTextColumn(row, 2, "attempt_id"),
      todosJson: readTextColumn(row, 3, "todos_json"),
      updatedAt: readTextColumn(row, 4, "updated_at"),
    }));
  }

  /**
   * Replaces the list of an attempt that Pages knows.
   *
   * @remarks
   * Run and node come from the stored attempt, so a caller that only knows the
   * attempt cannot file a list under a foreign run.
   */
  public async save(
    attemptId: string,
    todos: readonly AgentPlanAgentTodo[],
    updatedAt: string,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_plan_agent_todos (
          run_id,
          step_id,
          attempt_id,
          todos_json,
          updated_at
      )
      SELECT
          run_id,
          step_id,
          attempt_id,
          $todos_json,
          $updated_at
      FROM agent_session_attempts
      WHERE attempt_id = $attempt_id
      ON CONFLICT (attempt_id) DO UPDATE SET
          todos_json = excluded.todos_json,
          updated_at = excluded.updated_at;
    `,
      {
        attempt_id: attemptId,
        todos_json: JSON.stringify(todos),
        updated_at: updatedAt,
      },
    );
  }
}

const entrySchema = z.array(
  z.strictObject({
    id: z.string(),
    text: z.string(),
    status: z.enum(AGENT_TODO_STATUSES),
    updatedAt: z.string(),
  }),
);

/**
 * Reads the entries of a stored list.
 *
 * @param todosJson - The stored JSON.
 * @returns The entries; empty when the JSON is not a list of entries.
 */
export function readEntries(todosJson: string): readonly AgentPlanAgentTodo[] {
  const parsed = entrySchema.safeParse(JSON.parse(todosJson));
  return parsed.success ? parsed.data : [];
}
