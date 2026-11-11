import { readTextColumn } from "@/backend/database/RowValue";

import { AgentEmployeeRemovalRepository } from "./AgentEmployeeRemovalRepository";

import type { Database, SqlParameters } from "@/backend/database/Database";

/** Disk artifacts to remove after the database transaction commits. */
export interface AgentDeletionFiles {
  readonly entries: readonly {
    readonly kind: "session" | "chat" | "plan" | "voice";
    readonly name: string;
  }[];
}

function fileKind(input: string): "session" | "chat" | "plan" | "voice" {
  if (
    input === "session" ||
    input === "chat" ||
    input === "plan" ||
    input === "voice"
  )
    return input;
  throw new Error("Unknown agent deletion file kind.");
}

/** Expiry and disk cleanup of deleted agent artifacts. */
export class AgentDeletionPurgeRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Finds expired, unpurged agents for the maintenance pass. */
  public async expired(now: string): Promise<readonly string[]> {
    const rows = await this.database.query(
      `SELECT agent_id FROM agent_deletions
       WHERE purged_at IS NULL AND restorable_until <= $now
       ORDER BY restorable_until, agent_id LIMIT 100;`,
      { now },
    );
    return rows.map((row) => readTextColumn(row, 0, "agent_id"));
  }

  /** Permanently removes private rows and queues their disk names for cleanup. */
  public async purge(
    agentId: string,
    now: string,
    eventId: string,
  ): Promise<AgentDeletionFiles> {
    const parameters = { agent_id: agentId };
    const entries = await this.queueFiles(parameters);
    await this.purgePlans(parameters);
    await this.purgeAccess(parameters);
    await this.purgeChats(parameters);
    await new AgentEmployeeRemovalRepository(this.database).remove(agentId);
    await this.database.execute(
      `INSERT INTO agent_deletion_events (id, agent_id, actor_id, action, occurred_at, counts)
       SELECT $event_id, agent_id, deleted_by, 'purge', $now, counts
       FROM agent_deletions WHERE agent_id = $agent_id;`,
      { ...parameters, now, event_id: eventId },
    );
    await this.database.execute(
      `UPDATE agent_deletions SET purged_at = $now,
          token_state = '{}'::jsonb, assigned_tickets = '[]'::jsonb,
          assigned_tasks = '[]'::jsonb
       WHERE agent_id = $agent_id;`,
      { ...parameters, now },
    );
    return { entries };
  }

  /** Reads persisted cleanup work left after a committed purge. */
  public async pendingFiles(): Promise<AgentDeletionFiles> {
    const rows = await this.database.query(
      "SELECT kind, name FROM agent_deletion_files ORDER BY kind, name LIMIT 500;",
    );
    return {
      entries: rows.map((row) => ({
        kind: fileKind(readTextColumn(row, 0, "kind")),
        name: readTextColumn(row, 1, "name"),
      })),
    };
  }

  /** Acknowledges removal of one file or session directory. */
  public async acknowledgeFile(kind: string, name: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM agent_deletion_files WHERE kind = $kind AND name = $name;",
      { kind, name },
    );
  }
  private async queueFiles(
    parameters: SqlParameters,
  ): Promise<AgentDeletionFiles["entries"]> {
    const sessionRows = await this.database.query(
      `SELECT id FROM chat_sessions
         WHERE user_id = $agent_id OR id IN (SELECT chat_session_id FROM agent_conversations WHERE agent_id = $agent_id)
         UNION SELECT chat_session_id FROM chat_acp_sessions WHERE user_id = $agent_id;`,
      parameters,
    );
    const fileRows = await this.database.query(
      `SELECT 'chat' AS kind, storage_name FROM chat_attachments
         WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id = $agent_id OR id IN (SELECT chat_session_id FROM agent_conversations WHERE agent_id = $agent_id))
         UNION SELECT 'plan', storage_name FROM agent_plan_assets WHERE owner_id = $agent_id
         UNION SELECT 'voice', voice_storage_name FROM conversation_messages
         WHERE voice_storage_name IS NOT NULL AND conversation_id IN (SELECT id FROM conversations WHERE deleted_agent_id = $agent_id);`,
      parameters,
    );
    const entries: AgentDeletionFiles["entries"] = [
      ...sessionRows.map((row) => ({
        kind: "session" as const,
        name: readTextColumn(row, 0, "chat_session_id"),
      })),
      ...fileRows.map((row) => ({
        kind: fileKind(readTextColumn(row, 0, "kind")),
        name: readTextColumn(row, 1, "storage_name"),
      })),
    ];
    for (const entry of entries) {
      await this.database.execute(
        "INSERT INTO agent_deletion_files (kind, name) VALUES ($kind, $name) ON CONFLICT DO NOTHING;",
        entry,
      );
    }
    return entries;
  }

  private async purgePlans(parameters: SqlParameters): Promise<void> {
    const runIds = `SELECT id FROM agent_plan_runs WHERE user_id = $agent_id
      OR plan_id IN (SELECT id FROM agent_plans WHERE owner_id = $agent_id)`;
    const attemptIds = `SELECT attempt_id FROM agent_session_attempts WHERE user_id = $agent_id
      OR run_id IN (${runIds})`;
    for (const table of [
      "agent_session_events",
      "agent_session_history_chunks",
      "agent_session_messages",
      "agent_session_turn_usage",
    ]) {
      await this.database.execute(
        `DELETE FROM ${table} WHERE attempt_id IN (${attemptIds});`,
        parameters,
      );
    }
    await this.database.execute(
      `DELETE FROM agent_session_attempts WHERE attempt_id IN (${attemptIds});`,
      parameters,
    );
    for (const table of [
      "agent_plan_checkpoints",
      "agent_plan_cleanup_failures",
      "agent_plan_continuations",
      "agent_plan_loop_iterations",
      "agent_plan_recovery_executions",
      "agent_plan_repair_attempts",
      "agent_plan_step_reports",
      "agent_plan_work",
      "agent_plan_step_progress",
      "agent_plan_workspace_locks",
      "agent_workspace_cleanup",
    ]) {
      await this.database.execute(
        `DELETE FROM ${table} WHERE run_id IN (${runIds});`,
        parameters,
      );
    }
    await this.database.execute(
      `DELETE FROM agent_run_credentials WHERE user_id = $agent_id OR run_id IN (${runIds});`,
      parameters,
    );
    await this.database.execute(
      `DELETE FROM agent_plan_runs WHERE id IN (${runIds});`,
      parameters,
    );
    await this.database.execute(
      "DELETE FROM agent_plan_start_rejections WHERE user_id = $agent_id OR plan_id IN (SELECT id FROM agent_plans WHERE owner_id = $agent_id);",
      parameters,
    );
    await this.database.execute(
      "DELETE FROM agent_plan_templates WHERE owner_id = $agent_id;",
      parameters,
    );
    await this.database.execute(
      "DELETE FROM agent_plan_assets WHERE owner_id = $agent_id;",
      parameters,
    );
    await this.database.execute(
      "DELETE FROM agent_plans WHERE owner_id = $agent_id;",
      parameters,
    );
  }

  private async purgeAccess(parameters: SqlParameters): Promise<void> {
    await this.database.execute(
      "DELETE FROM conversations WHERE deleted_agent_id = $agent_id;",
      parameters,
    );
    await this.database.execute(
      "DELETE FROM conversation_members WHERE user_id = $agent_id;",
      parameters,
    );
    await this.database.execute(
      "DELETE FROM chat_group_members WHERE contact_id = $agent_id OR owner_id = $agent_id;",
      parameters,
    );
    await this.database.execute(
      "DELETE FROM chat_groups WHERE owner_id = $agent_id;",
      parameters,
    );
    await this.database.execute(
      "DELETE FROM mcp_device WHERE user_id = $agent_id;",
      parameters,
    );
    await this.database.execute(
      "DELETE FROM mcp_device_pairing WHERE user_id = $agent_id;",
      parameters,
    );
    await this.database.execute(
      "DELETE FROM mcp_pairing_requests WHERE user_id = $agent_id;",
      parameters,
    );
    await this.database.execute(
      "DELETE FROM discord_connection_attempts WHERE user_id = $agent_id;",
      parameters,
    );
    await this.database.execute(
      "DELETE FROM google_drive_sign_in_attempt WHERE user_id = $agent_id;",
      parameters,
    );
    await this.database.execute(
      "DELETE FROM personal_agent_tokens WHERE user_id = $agent_id;",
      parameters,
    );
    await this.database.execute(
      "DELETE FROM mcp_pairing_preferences WHERE user_id = $agent_id;",
      parameters,
    );
  }

  private async purgeChats(parameters: SqlParameters): Promise<void> {
    await this.database.execute(
      "DELETE FROM chat_job_events WHERE job_id IN (SELECT id FROM chat_jobs WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id = $agent_id OR id IN (SELECT chat_session_id FROM agent_conversations WHERE agent_id = $agent_id)));",
      parameters,
    );
    await this.database.execute(
      "DELETE FROM chat_job_turns WHERE job_id IN (SELECT id FROM chat_jobs WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id = $agent_id OR id IN (SELECT chat_session_id FROM agent_conversations WHERE agent_id = $agent_id)));",
      parameters,
    );
    for (const table of [
      "chat_attachments",
      "chat_messages",
      "chat_jobs",
      "chat_acp_sessions",
      "chat_selections",
      "chat_steers",
    ]) {
      const column =
        table === "chat_acp_sessions" ? "chat_session_id" : "session_id";
      await this.database.execute(
        `DELETE FROM ${table} WHERE ${column} IN (SELECT id FROM chat_sessions WHERE user_id = $agent_id OR id IN (SELECT chat_session_id FROM agent_conversations WHERE agent_id = $agent_id));`,
        parameters,
      );
    }
    await this.database.execute(
      "DELETE FROM chat_sessions WHERE user_id = $agent_id OR id IN (SELECT chat_session_id FROM agent_conversations WHERE agent_id = $agent_id);",
      parameters,
    );
    await this.database.execute(
      "DELETE FROM agent_conversations WHERE agent_id = $agent_id;",
      parameters,
    );
  }
}
