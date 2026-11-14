import { randomUUID } from "node:crypto";

import { readTextColumn } from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  StorageActivity,
  StorageGrant,
  StorageGrantTarget,
} from "@/definition/StorageAccess";

function grantOf(row: readonly DatabaseValue[]): StorageGrant {
  const targetKind = readTextColumn(row, 3, "target_kind");
  if (
    targetKind !== "role" &&
    targetKind !== "department" &&
    targetKind !== "group"
  )
    throw new Error("Invalid Storage grant recipient.");
  return {
    permissionId: readTextColumn(row, 0, "permission_id"),
    folderRef: readTextColumn(row, 1, "folder_ref"),
    folderName: readTextColumn(row, 2, "folder_name"),
    targetKind,
    targetId: readTextColumn(row, 4, "target_id"),
  };
}

/** Persists explicit folder grants and account-attributed Storage history. */
export class StorageAccessRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Reads grants using current role, department and group memberships. */
  public async grants(
    userId: string | null,
    permissionId: string,
  ): Promise<readonly StorageGrant[]> {
    const rows = await this.database.query(
      `
      SELECT
          permission_id,
          folder_ref,
          folder_name,
          target_kind,
          target_id
      FROM storage_folder_grants
      WHERE permission_id = $permission_id
          AND (CAST($user_id AS TEXT) IS NULL
              OR (target_kind = 'role' AND target_id IN (
                  SELECT role_id FROM user_authorization WHERE user_id = $user_id
              ))
              OR (target_kind = 'department' AND target_id IN (
                  SELECT department_id FROM department_members WHERE user_id = $user_id
              ))
              OR (target_kind = 'group' AND target_id IN (
                  SELECT group_id FROM user_group_members WHERE user_id = $user_id
              )))
      ORDER BY folder_name, target_kind, target_id;
    `,
      { user_id: userId, permission_id: permissionId },
    );
    return rows.map(grantOf);
  }

  /** Lists existing grant recipients; arbitrary or deleted IDs cannot be granted. */
  public async targets(): Promise<readonly StorageGrantTarget[]> {
    const rows = await this.database.query(`
      SELECT 'role' AS kind, id, name FROM roles
      UNION ALL
      SELECT 'department' AS kind, id, name FROM departments
      UNION ALL
      SELECT 'group' AS kind, id, name FROM user_groups
      ORDER BY kind, name, id;
    `);
    return rows.map((row) => {
      const kind = readTextColumn(row, 0, "kind");
      if (kind !== "role" && kind !== "department" && kind !== "group")
        throw new Error("Invalid Storage target.");
      return {
        kind,
        id: readTextColumn(row, 1, "id"),
        name: readTextColumn(row, 2, "name"),
      };
    });
  }

  /** Adds or revokes one grant without replacing concurrent grants. */
  public async setGrant(grant: StorageGrant, enabled: boolean): Promise<void> {
    const parameters = {
      permission_id: grant.permissionId,
      folder_ref: grant.folderRef,
      folder_name: grant.folderName,
      target_kind: grant.targetKind,
      target_id: grant.targetId,
    };
    if (!enabled) {
      await this.database.execute(
        `
        DELETE FROM storage_folder_grants
        WHERE permission_id = $permission_id
            AND folder_ref = $folder_ref
            AND target_kind = $target_kind
            AND target_id = $target_id;
      `,
        parameters,
      );
      return;
    }
    await this.database.execute(
      `
      INSERT INTO storage_folder_grants (
          permission_id,
          folder_ref,
          folder_name,
          target_kind,
          target_id
      ) VALUES ($permission_id, $folder_ref, $folder_name, $target_kind, $target_id)
      ON CONFLICT (permission_id, folder_ref, target_kind, target_id) DO UPDATE
      SET folder_name = EXCLUDED.folder_name;
    `,
      parameters,
    );
  }

  /** Stores metadata only, never file bytes, tokens or request parameters. */
  public async record(
    activity: Omit<StorageActivity, "createdAt">,
    permissionId: string,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO storage_activity (
          id,
          actor_id,
          actor_name,
          operation,
          ref,
          permission_id
      ) VALUES ($id, $actor_id, $actor_name, $operation, $ref, $permission_id);
    `,
      {
        id: randomUUID(),
        actor_id: activity.actorId,
        actor_name: activity.actorName,
        operation: activity.operation,
        ref: activity.ref,
        permission_id: permissionId,
      },
    );
  }

  /** Reads the account's history; administrators may read all accounts. */
  public async history(
    userId: string | null,
    permissionId: string,
  ): Promise<readonly StorageActivity[]> {
    const rows = await this.database.query(
      `
      SELECT
          actor_id,
          actor_name,
          operation,
          ref,
          created_at
      FROM storage_activity
      WHERE permission_id = $permission_id
          AND (CAST($user_id AS TEXT) IS NULL OR actor_id = $user_id)
      ORDER BY created_at DESC, id DESC
      LIMIT 100;
    `,
      { user_id: userId, permission_id: permissionId },
    );
    return rows.map((row) => ({
      actorId: readTextColumn(row, 0, "actor_id"),
      actorName: readTextColumn(row, 1, "actor_name"),
      operation: readTextColumn(row, 2, "operation"),
      ref: readTextColumn(row, 3, "ref"),
      createdAt: readTextColumn(row, 4, "created_at"),
    }));
  }
}
