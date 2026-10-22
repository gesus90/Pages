import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";
import { hostObservationSchema } from "@/definition/RemoteSetup";

import type { Database } from "@/backend/database/Database";
import type { InstallFinding } from "@/definition/RemoteSetup";

/** Stores the latest probe result of each remote connection in DuckDB. */
export class RemoteInstallFindingRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Returns the stored finding of a connection, or `null` when none was made. */
  public async find(connectionId: string): Promise<InstallFinding | null> {
    const rows = await this.database.query(
      `
      SELECT
          host,
          port,
          username,
          host_key_fingerprint,
          observation_json,
          observed_at
      FROM remote_install_findings
      WHERE connection_id = $connection_id;
    `,
      { connection_id: connectionId },
    );
    const row = rows[0];
    if (!row) return null;
    return {
      binding: {
        host: readTextColumn(row, 0, "host"),
        port: readCountColumn(row, 1, "port"),
        username: readTextColumn(row, 2, "username"),
        hostKeyFingerprint: readTextColumn(row, 3, "host_key_fingerprint"),
      },
      observation: hostObservationSchema.parse(
        JSON.parse(readTextColumn(row, 4, "observation_json")),
      ),
      observedAt: readTextColumn(row, 5, "observed_at"),
    };
  }

  /** Replaces the finding of a connection; there is only ever the latest one. */
  public async save(
    connectionId: string,
    finding: InstallFinding,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO remote_install_findings (
          connection_id,
          host,
          port,
          username,
          host_key_fingerprint,
          observation_json,
          observed_at
      )
      VALUES (
          $connection_id,
          $host,
          $port,
          $username,
          $host_key_fingerprint,
          $observation_json,
          $observed_at
      )
      ON CONFLICT (connection_id) DO UPDATE SET
          host = excluded.host,
          port = excluded.port,
          username = excluded.username,
          host_key_fingerprint = excluded.host_key_fingerprint,
          observation_json = excluded.observation_json,
          observed_at = excluded.observed_at;
    `,
      {
        connection_id: connectionId,
        host: finding.binding.host,
        port: finding.binding.port,
        username: finding.binding.username,
        host_key_fingerprint: finding.binding.hostKeyFingerprint,
        observation_json: JSON.stringify(finding.observation),
        observed_at: finding.observedAt,
      },
    );
  }
}
