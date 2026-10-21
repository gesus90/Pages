import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { RemoteError } from "@/backend/error/RemoteErrors";
import {
  isRemoteFailureCode,
  isRemotePathIssue,
} from "@/definition/RemoteConnection";

import { parseRemoteRoots } from "./RemoteConnectionRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type {
  RemoteFailureDetail,
  RemoteWorkspaceCheck,
} from "@/definition/RemoteConnection";

/** A stored directory check with the allowed directories it applied. */
export interface RemoteWorkspaceCheckRecord extends RemoteWorkspaceCheck {
  /** The connection's effective allowed directories; `null` when the check predates this record. */
  readonly roots: readonly string[] | null;
}

/** A stored remote workspace profile with its latest directory check. */
export interface RemoteWorkspaceRecord {
  readonly id: string;
  readonly name: string;
  readonly connectionId: string;
  /** Canonical absolute path on the remote machine. */
  readonly path: string;
  readonly projectId: string;
  readonly registeredBy: string;
  readonly check: RemoteWorkspaceCheckRecord | null;
  readonly revision: number;
}

const WORKSPACE_COLUMNS = `
    id,
    name,
    connection_id,
    path,
    project_id,
    registered_by,
    checked_at,
    check_issue,
    revision,
    check_roots_json
`;

function readIssue(value: string | null): RemoteFailureDetail | null {
  if (isRemotePathIssue(value) || isRemoteFailureCode(value)) return value;
  return null;
}

function readCheckRoots(
  row: readonly DatabaseValue[],
): readonly string[] | null {
  const json = readNullableTextColumn(row, 9, "check_roots_json");
  return json === null ? null : parseRemoteRoots(json, "check_roots_json");
}

function writeCheckRoots(
  check: RemoteWorkspaceCheckRecord | null,
): string | null {
  return check?.roots ? JSON.stringify(check.roots) : null;
}

function readWorkspace(row: readonly DatabaseValue[]): RemoteWorkspaceRecord {
  const checkedAt = readNullableTextColumn(row, 6, "checked_at");
  return {
    id: readTextColumn(row, 0, "id"),
    name: readTextColumn(row, 1, "name"),
    connectionId: readTextColumn(row, 2, "connection_id"),
    path: readTextColumn(row, 3, "path"),
    projectId: readTextColumn(row, 4, "project_id"),
    registeredBy: readTextColumn(row, 5, "registered_by"),
    check:
      checkedAt === null
        ? null
        : {
            checkedAt,
            issue: readIssue(readNullableTextColumn(row, 7, "check_issue")),
            roots: readCheckRoots(row),
          },
    revision: readCountColumn(row, 8, "revision"),
  };
}

async function readWorkspaces(
  database: DatabaseTransaction,
): Promise<readonly RemoteWorkspaceRecord[]> {
  const rows = await database.query(`
    SELECT
        ${WORKSPACE_COLUMNS}
    FROM remote_workspaces
    ORDER BY lower(name), id;
  `);
  return rows.map(readWorkspace);
}

/** Directories of one machine may not contain each other, as with local workspaces. */
async function requireSeparatePath(
  transaction: DatabaseTransaction,
  workspace: RemoteWorkspaceRecord,
): Promise<void> {
  const overlaps = await transaction.query(
    `
    SELECT id
    FROM remote_workspaces
    WHERE id <> $id
        AND connection_id = $connection_id
        AND (
            path = $path
            OR starts_with(path, $prefix)
            OR starts_with($path, CASE WHEN path = '/' THEN path ELSE path || '/' END)
        );
  `,
    {
      id: workspace.id,
      connection_id: workspace.connectionId,
      path: workspace.path,
      prefix: workspace.path.endsWith("/")
        ? workspace.path
        : `${workspace.path}/`,
    },
  );
  if (overlaps.length > 0)
    throw new RemoteError("remote_workspace_path_conflict");
}

/** Stores remote workspace profiles; the remote directory itself is never changed. */
export class RemoteWorkspaceRepository {
  private readonly database: Pick<Database, "transaction">;

  public constructor(database: Pick<Database, "transaction">) {
    this.database = database;
  }

  /** Reads every profile from one coherent snapshot. */
  public async list(): Promise<readonly RemoteWorkspaceRecord[]> {
    return this.database.transaction(readWorkspaces);
  }

  /** Returns one profile, or `null` when it does not exist. */
  public async find(id: string): Promise<RemoteWorkspaceRecord | null> {
    const workspaces = await this.list();
    return workspaces.find((workspace) => workspace.id === id) ?? null;
  }

  /**
   * Inserts or replaces a profile together with its fresh directory check.
   *
   * @param workspace - The profile; for a change, with the revision read before.
   * @param isNew - Whether the identifier must not exist yet.
   * @throws {RemoteError} `remote_conflict` or `remote_workspace_path_conflict`.
   */
  public async save(
    workspace: RemoteWorkspaceRecord,
    isNew: boolean,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const previous = (await readWorkspaces(transaction)).find(
        (entry) => entry.id === workspace.id,
      );
      if (isNew && previous) throw new RemoteError("remote_conflict");
      if (!isNew && !previous)
        throw new RemoteError("remote_workspace_not_found");
      if (!isNew && previous?.revision !== workspace.revision)
        throw new RemoteError("remote_conflict");
      await requireSeparatePath(transaction, workspace);
      // DuckDB refuses a named parameter the statement does not use, so the
      // author is bound only where a profile is inserted.
      const parameters = {
        id: workspace.id,
        name: workspace.name,
        connection_id: workspace.connectionId,
        path: workspace.path,
        project_id: workspace.projectId,
        checked_at: workspace.check?.checkedAt ?? null,
        check_issue: workspace.check?.issue ?? null,
        check_roots_json: writeCheckRoots(workspace.check),
      };
      if (isNew) {
        await transaction.execute(
          `
          INSERT INTO remote_workspaces (
              id,
              name,
              connection_id,
              path,
              project_id,
              registered_by,
              checked_at,
              check_issue,
              check_roots_json
          )
          VALUES (
              $id,
              $name,
              $connection_id,
              $path,
              $project_id,
              $registered_by,
              $checked_at,
              $check_issue,
              $check_roots_json
          );
        `,
          { ...parameters, registered_by: workspace.registeredBy },
        );
        return;
      }
      await transaction.execute(
        `
        UPDATE remote_workspaces
        SET
            name = $name,
            path = $path,
            project_id = $project_id,
            checked_at = $checked_at,
            check_issue = $check_issue,
            check_roots_json = $check_roots_json,
            revision = revision + 1
        WHERE id = $id
            AND connection_id = $connection_id;
      `,
        parameters,
      );
    });
  }

  /**
   * Records a directory check of an unchanged profile.
   *
   * @param id - The profile.
   * @param revision - The revision the check belongs to.
   * @param check - The latest result with the allowed directories it applied.
   */
  public async saveCheck(
    id: string,
    revision: number,
    check: RemoteWorkspaceCheckRecord,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
        UPDATE remote_workspaces
        SET
            checked_at = $checked_at,
            check_issue = $check_issue,
            check_roots_json = $check_roots_json
        WHERE id = $id
            AND revision = $revision;
      `,
        {
          id,
          revision,
          checked_at: check.checkedAt,
          check_issue: check.issue,
          check_roots_json: writeCheckRoots(check),
        },
      );
    });
  }

  /**
   * Unregisters a profile; the remote directory and its files stay as they are.
   *
   * @param id - The profile.
   * @param revision - The revision the caller last read.
   */
  public async remove(id: string, revision: number): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const previous = (await readWorkspaces(transaction)).find(
        (entry) => entry.id === id,
      );
      if (!previous) throw new RemoteError("remote_workspace_not_found");
      if (previous.revision !== revision)
        throw new RemoteError("remote_conflict");
      await transaction.execute(
        "DELETE FROM remote_workspaces WHERE id = $id;",
        { id },
      );
    });
  }
}
