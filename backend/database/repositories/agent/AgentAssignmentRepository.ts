import { randomUUID } from "node:crypto";

import { Database } from "@/backend/database/Database";
import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import { isAgentFunction } from "@/definition/AgentAssignment";

import { AgentProfileStore } from "./AgentProfileStore";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type {
  AgentAssignment,
  AgentFunction,
} from "@/definition/AgentAssignment";
import type { AgentProfileTarget } from "@/definition/AgentProfile";

/** Compatibility facade over central agents and their system function assignments. */
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

  /** Edits the assigned central agent; a new function never overwrites an unrelated agent ID. */
  public async save(assignment: AgentAssignment): Promise<void> {
    if (this.database instanceof Database)
      return this.database.transaction((transaction) =>
        new AgentAssignmentRepository(transaction).save(assignment),
      );
    if (assignment.function !== "text")
      throw new AgentError("function_invalid");
    const store = new AgentProfileStore(this.database);
    const profiles = await store.list();
    const previous = profiles.find((profile) =>
      profile.targets.some(
        (target) => target.kind === "system" && target.targetId === "text",
      ),
    );
    const legacyId = profiles.some((profile) => profile.id === "system-text")
      ? randomUUID()
      : "system-text";
    const hasChat = profiles.some((profile) =>
      profile.targets.some(
        (target) => target.kind === "system" && target.targetId === "chat",
      ),
    );
    const targets: AgentProfileTarget[] = [
      { kind: "system", targetId: "text" },
    ];
    if (!hasChat) targets.push({ kind: "system", targetId: "chat" });
    await store.save({
      ...(previous ?? {}),
      id: previous?.id ?? legacyId,
      name: previous?.name ?? "System Text",
      connectionId: assignment.connectionId,
      model: assignment.model,
      reasoningEffort: assignment.reasoningEffort,
      isActive: true,
      purposes: previous?.purposes ?? (hasChat ? ["text"] : ["text", "chat"]),
      targets: previous?.targets ?? targets,
    });
  }

  /** Explicit unassignment never removes the connection or starts a task. */
  public async remove(assignedFunction: AgentFunction): Promise<void> {
    if (this.database instanceof Database)
      return this.database.transaction((transaction) =>
        new AgentAssignmentRepository(transaction).remove(assignedFunction),
      );
    if (assignedFunction === "text") {
      await this.database.execute(`
        UPDATE agent_execution_profiles
        SET revision = revision + 1
        WHERE id IN (
            SELECT profile_id
            FROM agent_profile_targets
            WHERE kind = 'system'
                AND target_id = 'text'
        );
      `);
      await this.database.execute(`
        DELETE FROM agent_profile_targets
        WHERE kind = 'system'
            AND target_id = 'text';
      `);
    } else
      await this.database.execute(
        `
      DELETE FROM agent_legacy_function_assignments
      WHERE function = $function;
    `,
        { function: assignedFunction },
      );
  }
}
