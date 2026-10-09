import { readTextColumn } from "@/backend/database/RowValue";
import { parseOAuthClient } from "@/definition/McpOAuthClient";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { McpOAuthClient } from "@/definition/McpAuthorization";

/** Stores validated public OAuth client metadata, without client secrets. */
export class OAuthClientRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Persists a DCR client or refreshes a CIMD metadata snapshot. */
  public async save(client: McpOAuthClient): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO mcp_oauth_clients (id, metadata)
      VALUES ($id, $metadata)
      ON CONFLICT (id) DO UPDATE SET metadata = excluded.metadata;
    `,
      { id: client.client_id, metadata: JSON.stringify(client) },
    );
  }

  /** Returns a validated registration, or null for an unknown client. */
  public async find(id: string): Promise<McpOAuthClient | null> {
    const rows = await this.database.query(
      `
      SELECT metadata
      FROM mcp_oauth_clients
      WHERE id = $id;
    `,
      { id },
    );
    return rows[0]
      ? parseOAuthClient(JSON.parse(readTextColumn(rows[0], 0, "metadata")), id)
      : null;
  }
}
