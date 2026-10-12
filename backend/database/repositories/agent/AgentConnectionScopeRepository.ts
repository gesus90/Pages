import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  GLOBAL_CONNECTION_SCOPE,
  UNSET_CONNECTION_SCOPE,
  isAgentConnectionScopeKind,
} from "@/definition/AgentConnectionScope";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type {
  AgentConnectionScope,
  AgentConnectionScopeKind,
  AgentConnectionScopeTarget,
} from "@/definition/AgentConnectionScope";
import type { AgentReference } from "@/definition/AgentUsage";

/** Fixed statements, one per directory table; only the identifier is a value. */
const TARGET_EXISTS: Readonly<Record<AgentConnectionScopeKind, string>> = {
  person: "SELECT id FROM users WHERE id = $target_id;",
  group: "SELECT id FROM user_groups WHERE id = $target_id;",
  department: "SELECT id FROM departments WHERE id = $target_id;",
};

type TargetRow = readonly [string, string, string];

/** Narrows the stored rows of one connection; an unknown kind is a corrupt scope. */
function readTargets(
  rows: readonly TargetRow[],
  connectionId: string,
): AgentConnectionScopeTarget[] {
  return rows
    .filter(([id]) => id === connectionId)
    .map(([, kind, targetId]) => {
      if (!isAgentConnectionScopeKind(kind))
        throw new AgentError("connection_scope_invalid");
      return { kind, targetId };
    });
}

/** Stores who may use each connection, apart from its credentials and checks. */
export class AgentConnectionScopeRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /**
   * Reads the scope of one connection.
   *
   * @param connectionId - The connection.
   * @returns The scope, or `null` when the connection does not exist.
   */
  public async find(
    connectionId: string,
  ): Promise<AgentConnectionScope | null> {
    const rows = await this.database.query(
      `
      SELECT
          scopes.mode
      FROM agent_connections AS connections
      LEFT JOIN agent_connection_scopes AS scopes
          ON scopes.connection_id = connections.id
      WHERE connections.id = $connection_id;
    `,
      { connection_id: connectionId },
    );
    const row = rows[0];
    if (!row) return null;
    const mode = readNullableTextColumn(row, 0, "mode");
    if (mode === "global") return GLOBAL_CONNECTION_SCOPE;
    if (mode !== "restricted") return UNSET_CONNECTION_SCOPE;
    return {
      mode,
      targets: readTargets(await this.targetRows(connectionId), connectionId),
    };
  }

  /** Reads every scope in two statements, for the administration list. */
  public async list(): Promise<ReadonlyMap<string, AgentConnectionScope>> {
    const [modes, targets] = await Promise.all([
      this.database.query(`
        SELECT
            connections.id,
            scopes.mode
        FROM agent_connections AS connections
        LEFT JOIN agent_connection_scopes AS scopes
            ON scopes.connection_id = connections.id
        ORDER BY connections.id;
      `),
      this.targetRows(null),
    ]);
    const scopes = new Map<string, AgentConnectionScope>();
    for (const row of modes) {
      const id = readTextColumn(row, 0, "id");
      const mode = readNullableTextColumn(row, 1, "mode");
      if (mode === "global") scopes.set(id, GLOBAL_CONNECTION_SCOPE);
      else if (mode === "restricted")
        scopes.set(id, { mode, targets: readTargets(targets, id) });
      else scopes.set(id, UNSET_CONNECTION_SCOPE);
    }
    return scopes;
  }

  /**
   * Replaces mode and targets of one connection.
   *
   * @param connectionId - The connection.
   * @param scope - A validated scope.
   * @throws {AgentError} `profile_target_invalid` for a person, group or
   * department that does not exist.
   *
   * @remarks
   * Call inside the transaction of the connection change, so the scope and the
   * connection are never saved apart.
   */
  public async save(
    connectionId: string,
    scope: AgentConnectionScope,
  ): Promise<void> {
    for (const target of scope.targets) await this.requireTarget(target);
    await this.database.execute(
      `
      INSERT INTO agent_connection_scopes (
          connection_id,
          mode
      ) VALUES (
          $connection_id,
          $mode
      )
      ON CONFLICT (connection_id) DO UPDATE SET
          mode = EXCLUDED.mode;
    `,
      { connection_id: connectionId, mode: scope.mode },
    );
    await this.database.execute(
      "DELETE FROM agent_connection_scope_targets WHERE connection_id = $connection_id;",
      { connection_id: connectionId },
    );
    for (const target of scope.targets)
      await this.database.execute(
        `
        INSERT INTO agent_connection_scope_targets (
            connection_id,
            kind,
            target_id
        ) VALUES (
            $connection_id,
            $kind,
            $target_id
        );
      `,
        {
          connection_id: connectionId,
          kind: target.kind,
          target_id: target.targetId,
        },
      );
  }

  /** Removes the scope together with its connection. */
  public async remove(connectionId: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM agent_connection_scope_targets WHERE connection_id = $connection_id;",
      { connection_id: connectionId },
    );
    await this.database.execute(
      "DELETE FROM agent_connection_scopes WHERE connection_id = $connection_id;",
      { connection_id: connectionId },
    );
  }

  /** Names the connections whose scope still lists a person, group or department. */
  public async references(
    target: AgentConnectionScopeTarget,
  ): Promise<readonly AgentReference[]> {
    const rows = await this.database.query(
      `
      SELECT
          connections.id,
          connections.name
      FROM agent_connection_scope_targets AS targets
      INNER JOIN agent_connections AS connections
          ON connections.id = targets.connection_id
      WHERE targets.kind = $kind
          AND targets.target_id = $target_id
      ORDER BY lower(connections.name), connections.id;
    `,
      { kind: target.kind, target_id: target.targetId },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      name: readTextColumn(row, 1, "name"),
    }));
  }

  private async targetRows(
    connectionId: string | null,
  ): Promise<readonly TargetRow[]> {
    const rows =
      connectionId === null
        ? await this.database.query(`
            SELECT
                connection_id,
                kind,
                target_id
            FROM agent_connection_scope_targets
            ORDER BY connection_id, kind, target_id;
          `)
        : await this.database.query(
            `
            SELECT
                connection_id,
                kind,
                target_id
            FROM agent_connection_scope_targets
            WHERE connection_id = $connection_id
            ORDER BY kind, target_id;
          `,
            { connection_id: connectionId },
          );
    return rows.map((row) => [
      readTextColumn(row, 0, "connection_id"),
      readTextColumn(row, 1, "kind"),
      readTextColumn(row, 2, "target_id"),
    ]);
  }

  private async requireTarget(
    target: AgentConnectionScopeTarget,
  ): Promise<void> {
    const rows = await this.database.query(TARGET_EXISTS[target.kind], {
      target_id: target.targetId,
    });
    if (rows.length === 0) throw new AgentError("profile_target_invalid");
  }
}
