import { z } from "zod";

import { readTextColumn } from "@/backend/database/RowValue";
import { planSwarmRunSchema } from "@/definition/AgentPlanSwarmRun";

import { saveSwarmTodos } from "./AgentPlanAgentTodoRepository";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanAgentTodo } from "@/definition/AgentPlanAgentTodos";
import type { SwarmStoredBoard } from "@/backend/service/agents/swarm/SwarmPorts";

const boardSchema = z.strictObject({
  view: planSwarmRunSchema,
  locks: z
    .array(
      z.strictObject({
        path: z.string().max(1024),
        owner: z.string().max(10),
        expiresAt: z.number(),
      }),
    )
    .max(10_000),
});

/**
 * Stores the task board of each swarm node of a run (PAGE-313).
 *
 * @remarks
 * One row per run and node holds subtasks, helpers, violations and locks. A
 * resumed run reads the board of the run it continues.
 */
export class AgentPlanSwarmRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Replaces the board of a swarm node in a run. */
  public async save(
    runId: string,
    nodeId: string,
    board: SwarmStoredBoard,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_plan_swarm_boards (
          run_id,
          node_id,
          board_json,
          updated_at
      )
      VALUES (
          $run_id,
          $node_id,
          $board_json,
          $updated_at
      )
      ON CONFLICT (run_id, node_id) DO UPDATE SET
          board_json = excluded.board_json,
          updated_at = excluded.updated_at;
    `,
      {
        run_id: runId,
        node_id: nodeId,
        board_json: JSON.stringify(board),
        updated_at: new Date().toISOString(),
      },
    );
  }

  /**
   * Reads the board of a swarm node in a run.
   *
   * @returns The board, or `null` without one or for a board that cannot be read.
   */
  public async find(
    runId: string,
    nodeId: string,
  ): Promise<SwarmStoredBoard | null> {
    const [row] = await this.database.query(
      `
      SELECT board_json
      FROM agent_plan_swarm_boards
      WHERE run_id = $run_id
          AND node_id = $node_id;
    `,
      { run_id: runId, node_id: nodeId },
    );
    if (!row) return null;
    const parsed = boardSchema.safeParse(
      JSON.parse(readTextColumn(row, 0, "board_json")),
    );
    return parsed.success ? parsed.data : null;
  }

  /** Keeps the TODO list of the main model or of a helper. */
  public async saveTodos(list: {
    readonly runId: string;
    readonly stepId: string;
    readonly attemptId: string;
    readonly workerId: string;
    readonly todos: readonly AgentPlanAgentTodo[];
    readonly updatedAt: string;
  }): Promise<void> {
    await saveSwarmTodos(this.database, list);
  }
}
