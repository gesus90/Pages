import { Database } from "@/backend/database/Database";
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

/** Reads retained legacy function assignments without a model execution path. */
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

  /** Explicit unassignment never removes the connection or starts a task. */
  public async remove(assignedFunction: AgentFunction): Promise<void> {
    if (this.database instanceof Database)
      return this.database.transaction((transaction) =>
        new AgentAssignmentRepository(transaction).remove(assignedFunction),
      );
    await this.database.execute(
      `
      DELETE FROM agent_legacy_function_assignments
      WHERE function = $function;
    `,
      { function: assignedFunction },
    );
  }
}
