import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";

import { AgentProfileRepository } from "./agent/AgentProfileRepository";
import { AgentCatalogRepository } from "./agent/AgentCatalogRepository";
import { AgentCheckRepository } from "./agent/AgentCheckRepository";
import { AgentConnectionScopeRepository } from "./agent/AgentConnectionScopeRepository";
import {
  CONNECTION_COLUMNS,
  readAgentConnection,
} from "./agent/AgentConnectionRows";

import type { Database } from "@/backend/database/Database";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentConnectionScope } from "@/definition/AgentConnectionScope";
import type { AgentUsage } from "@/definition/AgentUsage";
import type { AgentConnectionRecord } from "./agent/AgentConnectionRows";

export interface AgentConnectionWrite {
  readonly id: string;
  readonly name: string;
  readonly provider: AgentProviderId;
  readonly secretEncrypted: string | null;
  readonly testModel: string | null;
  readonly actorId: string;
  /** Absent keeps the system-wide behaviour every connection had before scopes. */
  readonly scope?: AgentConnectionScope;
}

export interface AgentConnectionChange {
  readonly name: string;
  /** Null keeps the stored key; replacing a key always clears both checks. */
  readonly secretEncrypted: string | null;
  readonly testModel: string | null;
  readonly reasoningEffort: string | null;
  readonly clearModel: boolean;
  readonly actorId: string;
  /** Absent keeps the stored scope. */
  readonly scope?: AgentConnectionScope;
}

/** Facade for connection persistence and atomic credential/check changes. */
export class AgentConnectionRepository {
  private readonly database: Database;
  private readonly checkRepository: AgentCheckRepository;

  public constructor(database: Database) {
    this.database = database;
    this.checkRepository = new AgentCheckRepository(database);
  }

  /** Catalog persistence shares the connection transaction boundary. */
  public catalogs(): AgentCatalogRepository {
    return new AgentCatalogRepository(this.database);
  }

  /** Profile persistence shares the same database and legacy configuration boundary. */
  public profiles(): AgentProfileRepository {
    return new AgentProfileRepository(this.database);
  }

  /** Check persistence shares the same database connection. */
  public checks(): AgentCheckRepository {
    return this.checkRepository;
  }

  /** Scope persistence decides who may use the models of a connection. */
  public scopes(): AgentConnectionScopeRepository {
    return new AgentConnectionScopeRepository(this.database);
  }

  /** Lists safe metadata without selecting secret ciphertext. */
  public async list(): Promise<readonly AgentConnectionRecord[]> {
    return (
      await this.database.query(
        `SELECT ${CONNECTION_COLUMNS} FROM agent_connections ORDER BY lower(name), id;`,
      )
    ).map(readAgentConnection);
  }

  /** Reads safe metadata for one connection. */
  public async find(id: string): Promise<AgentConnectionRecord | null> {
    const rows = await this.database.query(
      `SELECT ${CONNECTION_COLUMNS} FROM agent_connections WHERE id = $id;`,
      { id },
    );
    return rows[0] ? readAgentConnection(rows[0]) : null;
  }

  /** Counts connections while the service serializes creation. */
  public async count(): Promise<number> {
    const rows = await this.database.query(
      "SELECT COUNT(*) AS count FROM agent_connections;",
    );
    return readCountColumn(rows[0], 0, "count");
  }

  /**
   * Names the agents that use this connection.
   *
   * @remarks
   * Read inside the connection write lock before credential cleanup or deletion.
   * Function assignments, including legacy ones, always belong to an agent.
   */
  public async usages(id: string): Promise<readonly AgentUsage[]> {
    const rows = await this.database.query(
      `
      SELECT
          id,
          name
      FROM agent_execution_profiles
      WHERE connection_id = $id
      ORDER BY lower(name), id;
    `,
      { id },
    );
    return rows.map((row): AgentUsage => ({
      kind: "agent",
      id: readTextColumn(row, 0, "id"),
      name: readTextColumn(row, 1, "name"),
    }));
  }

  /** Updates availability without discarding a verified credential or catalog. */
  public async setActive(
    id: string,
    isActive: boolean,
    actorId: string,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE agent_connections
      SET
          is_active = $is_active,
          updated_by = $actor_id,
          updated_at = utc_now()
      WHERE id = $id;
    `,
      { id, is_active: isActive, actor_id: actorId },
    );
  }

  /** Only check execution needs the encrypted API secret. */
  public async findSecretEncrypted(id: string): Promise<string | null> {
    const rows = await this.database.query(
      "SELECT secret_encrypted FROM agent_connections WHERE id = $id;",
      { id },
    );
    return rows[0]
      ? readNullableTextColumn(rows[0], 0, "secret_encrypted")
      : null;
  }

  /** Inserts a validated connection and its scope; the database enforces case-insensitive names. */
  public async insert(connection: AgentConnectionWrite): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
        INSERT INTO agent_connections (
            id,
            name,
            provider,
            secret_encrypted,
            test_model,
            created_by,
            updated_by
        ) VALUES (
            $id,
            $name,
            $provider,
            $secret_encrypted,
            $test_model,
            $actor_id,
            $actor_id
        );
      `,
        {
          id: connection.id,
          name: connection.name,
          provider: connection.provider,
          secret_encrypted: connection.secretEncrypted,
          test_model: connection.testModel,
          actor_id: connection.actorId,
        },
      );
      await new AgentConnectionScopeRepository(transaction).save(
        connection.id,
        connection.scope ?? GLOBAL_CONNECTION_SCOPE,
      );
    });
  }

  /** Updates metadata and invalidates affected checks within one transaction. */
  public async update(
    id: string,
    change: AgentConnectionChange,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
        UPDATE agent_connections
        SET
            name = $name,
            secret_encrypted = COALESCE($secret_encrypted, secret_encrypted),
            test_model = $test_model,
            reasoning_effort = $reasoning_effort,
            updated_by = $actor_id,
            updated_at = utc_now()
        WHERE id = $id;
      `,
        {
          id,
          name: change.name,
          secret_encrypted: change.secretEncrypted,
          test_model: change.testModel,
          reasoning_effort: change.reasoningEffort,
          actor_id: change.actorId,
        },
      );
      if (change.scope)
        await new AgentConnectionScopeRepository(transaction).save(
          id,
          change.scope,
        );
      const checks = new AgentCheckRepository(transaction);
      if (change.secretEncrypted !== null) {
        await checks.clear(id);
        await new AgentCatalogRepository(transaction).invalidate(id);
      } else if (change.clearModel) await checks.clearModel(id);
    });
  }

  /**
   * Stores the default model of a connection that has none yet.
   *
   * @param id - The connection.
   * @param model - A model the fresh catalog lists.
   * @returns Whether the default was stored.
   *
   * @remarks
   * The `IS NULL` guard keeps a model saved in the meantime. The default leaves
   * the effort to the provider and discards a model check of the CLI default.
   */
  public async assignDefaultModel(id: string, model: string): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query(
        `
        UPDATE agent_connections
        SET
            test_model = $model,
            reasoning_effort = NULL,
            updated_at = utc_now()
        WHERE id = $id
          AND test_model IS NULL
        RETURNING id;
      `,
        { id, model },
      );
      if (rows.length === 0) return false;
      await new AgentCheckRepository(transaction).clearModel(id);
      return true;
    });
  }

  /** Persists verified login metadata and discards checks of the previous account. */
  public async setCliAccount(
    id: string,
    account: {
      readonly loggedInAt: string | null;
      readonly label: string | null;
    },
    actorId: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
        UPDATE agent_connections
        SET
            cli_logged_in_at = $logged_in_at,
            cli_account_label = $label,
            updated_by = $actor_id,
            updated_at = utc_now()
        WHERE id = $id;
      `,
        {
          id,
          logged_in_at: account.loggedInAt,
          label: account.label,
          actor_id: actorId,
        },
      );
      await new AgentCheckRepository(transaction).clear(id);
    });
  }

  /** Removes dependent checks before the connection, atomically. */
  public async remove(id: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await new AgentCheckRepository(transaction).clear(id);
      await new AgentCatalogRepository(transaction).remove(id);
      await new AgentConnectionScopeRepository(transaction).remove(id);
      await transaction.execute(
        "DELETE FROM agent_connections WHERE id = $id;",
        { id },
      );
    });
  }
}
