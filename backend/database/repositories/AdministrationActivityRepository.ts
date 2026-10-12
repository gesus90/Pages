import { randomUUID } from "node:crypto";

import { readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type {
  AdministrationActivity,
  AgentAdminChanged,
} from "@/definition/AgentAdministration";

/** Persists instance-wide administration activity without credentials or request bodies. */
export class AdministrationActivityRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Records the public outcome beside its successful administration mutation. */
  public async insert(input: {
    readonly actorId: string;
    readonly operation: string;
    readonly source: "mcp" | "ai";
    readonly result: AgentAdminChanged;
  }): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO administration_activity (
          id,
          actor_id,
          operation,
          source,
          target_type,
          target_id,
          changes_json
      ) VALUES (
          $id,
          $actor_id,
          $operation,
          $source,
          $target_type,
          $target_id,
          $changes
      );
      `,
      {
        id: randomUUID(),
        actor_id: input.actorId,
        operation: input.operation,
        source: input.source,
        target_type: input.result.targetType,
        target_id: input.result.id,
        changes: JSON.stringify(input.result),
      },
    );
  }

  /** Returns safe activity in stable chronological order; services authorize and page it. */
  public async findAll(): Promise<readonly AdministrationActivity[]> {
    const rows = await this.database.query(`
      SELECT
          id,
          actor_id,
          operation,
          source,
          target_type,
          target_id,
          changes_json,
          created_at
      FROM administration_activity
      ORDER BY created_at DESC, id;
    `);
    return rows.map((row) => {
      const source = readTextColumn(row, 3, "source");
      if (source !== "mcp" && source !== "ai")
        throw new Error("Invalid administration activity source.");
      return {
        id: readTextColumn(row, 0, "id"),
        actorId: readTextColumn(row, 1, "actor_id"),
        operation: readTextColumn(row, 2, "operation"),
        source,
        targetType: readTextColumn(row, 4, "target_type"),
        targetId: readTextColumn(row, 5, "target_id"),
        changes: readTextColumn(row, 6, "changes_json"),
        createdAt: readTextColumn(row, 7, "created_at"),
      };
    });
  }
}
