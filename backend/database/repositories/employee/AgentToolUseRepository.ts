import {
  readBooleanColumn,
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";
import type { AgentToolUse } from "@/definition/AgentDreaming";

/** One call of a tool as it is stored. */
export interface StoredAgentToolUse extends AgentToolUse {
  /** The position the dream run remembers as its cursor. */
  readonly id: number;
  /** `YYYY-MM-DD HH:MM:SS` UTC. */
  readonly at: string;
}

/** Days after which a tool use is dropped, whether a run read it or not. */
export const TOOL_USE_RETENTION_DAYS = 30;

/**
 * The tool calls of the chat sessions of agents, which the dream run reads
 * to learn how an agent works (PAGE-378).
 */
export class AgentToolUseRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Stores one call. */
  public async append(agentId: string, use: AgentToolUse): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO agent_tool_uses (
            agent_id,
            tool,
            input,
            output,
            is_ok,
            error
        )
        VALUES (
            $agent_id,
            $tool,
            $input,
            $output,
            $is_ok,
            $error
        );
      `,
      {
        agent_id: agentId,
        tool: use.tool,
        input: use.input,
        output: use.output,
        is_ok: use.isOk,
        error: use.error,
      },
    );
  }

  /** The calls after a cursor, the oldest first. */
  public async since(
    agentId: string,
    cursor: number,
    limit: number,
  ): Promise<StoredAgentToolUse[]> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            created_at,
            tool,
            input,
            output,
            is_ok,
            error
        FROM agent_tool_uses
        WHERE agent_id = $agent_id
            AND id > $cursor
        ORDER BY id
        LIMIT $limit;
      `,
      { agent_id: agentId, cursor, limit },
    );
    return rows.map((row) => ({
      id: readCountColumn(row, 0, "id"),
      at: readTextColumn(row, 1, "created_at"),
      tool: readTextColumn(row, 2, "tool"),
      input: readTextColumn(row, 3, "input"),
      output: readTextColumn(row, 4, "output"),
      isOk: readBooleanColumn(row, 5, "is_ok"),
      error: readNullableTextColumn(row, 6, "error"),
    }));
  }

  /** The names of the tools the agent has called, for checking the tools of a recipe. */
  public async toolNames(agentId: string): Promise<string[]> {
    const rows = await this.database.query(
      `
        SELECT DISTINCT tool
        FROM agent_tool_uses
        WHERE agent_id = $agent_id
        ORDER BY tool;
      `,
      { agent_id: agentId },
    );
    return rows.map((row) => readTextColumn(row, 0, "tool"));
  }

  /**
   * Drops the calls older than the retention.
   *
   * @param agentId - The agent.
   * @param before - `YYYY-MM-DD HH:MM:SS` UTC; older calls go.
   */
  public async prune(agentId: string, before: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM agent_tool_uses
        WHERE agent_id = $agent_id
            AND created_at < $before;
      `,
      { agent_id: agentId, before },
    );
  }
}
