import type { DatabaseTransaction } from "@/backend/database/Database";

const PAYLOAD_COLUMNS = [
  ["agent_plan_runs", "snapshot_file"],
  ["agent_plan_runs", "engine_file"],
  ["agent_plan_continuations", "snapshot_file"],
  ["agent_session_events", "body_file"],
  ["agent_session_history_chunks", "events_file"],
  ["runner_history_recovery", "packet_file"],
  ["agent_local_session_owners", "checkpoint_file"],
  ["agent_local_session_results", "payload_file"],
] as const;

/** Protects payloads still owned by committed database rows during journal compaction. */
export class AgentPayloadReferenceRepository {
  private readonly database: Pick<DatabaseTransaction, "query">;

  public constructor(database: Pick<DatabaseTransaction, "query">) {
    this.database = database;
  }

  /** Returns referenced storage paths, comparing file identity rather than JSON formatting. */
  public async referenced(
    paths: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (paths.length === 0) return new Set();
    const selection = PAYLOAD_COLUMNS.map(
      ([table, column]) => `
      SELECT ${column}::jsonb ->> 'path' AS storage_name
      FROM ${table}
      WHERE ${column} IS NOT NULL
          AND ${column}::jsonb ->> 'path' IN (
              SELECT jsonb_array_elements_text($paths::jsonb)
          )
    `,
    ).join("\nUNION ALL\n");
    const rows = await this.database.query(selection, {
      paths: JSON.stringify(paths),
    });
    return new Set(
      rows.flatMap(([name]) => (typeof name === "string" ? [name] : [])),
    );
  }
}
