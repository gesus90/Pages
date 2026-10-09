import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import { isAgentFunction } from "@/definition/AgentAssignment";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type {
  AgentAssignment,
  AgentFunction,
} from "@/definition/AgentAssignment";

/** Stores named function assignments independently of connection defaults. */
export class AgentAssignmentRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Lists assignments including references that have become unusable. */
  public async list(): Promise<readonly AgentAssignment[]> {
    const rows = await this.database.query(`
      SELECT
          function,
          connection_id,
          model,
          reasoning_effort
      FROM agent_function_assignments
      ORDER BY function;
    `);
    return rows.map((row) => {
      const assignedFunction = readTextColumn(row, 0, "function");
      if (!isAgentFunction(assignedFunction))
        throw new AgentError("function_invalid");
      return {
        function: assignedFunction,
        connectionId: readTextColumn(row, 1, "connection_id"),
        model: readTextColumn(row, 2, "model"),
        reasoningEffort: readNullableTextColumn(row, 3, "reasoning_effort"),
      };
    });
  }

  /** Replaces exactly one validated function; uniqueness is enforced by its key. */
  public async save(assignment: AgentAssignment): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_function_assignments (
          function,
          connection_id,
          model,
          reasoning_effort
      ) VALUES ($function, $connection_id, $model, $reasoning_effort)
      ON CONFLICT (function) DO UPDATE SET
          connection_id = EXCLUDED.connection_id,
          model = EXCLUDED.model,
          reasoning_effort = EXCLUDED.reasoning_effort;
    `,
      {
        function: assignment.function,
        connection_id: assignment.connectionId,
        model: assignment.model,
        reasoning_effort: assignment.reasoningEffort,
      },
    );
  }

  /** Explicit unassignment never removes the connection or starts a task. */
  public async remove(assignedFunction: AgentFunction): Promise<void> {
    await this.database.execute(
      "DELETE FROM agent_function_assignments WHERE function = $function;",
      { function: assignedFunction },
    );
  }
}
