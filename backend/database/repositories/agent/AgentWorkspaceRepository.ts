import path from "node:path";

import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type {
  AgentWorkspace,
  AgentWorkspaceUsage,
  AgentWorkspaceUsageKind,
} from "@/definition/AgentWorkspace";

const WORKSPACE_COLUMNS = `
    id,
    name,
    path,
    directory_identity,
    project_id,
    registered_by,
    revision
`;

function readWorkspace(row: readonly DatabaseValue[]): AgentWorkspace {
  return {
    id: readTextColumn(row, 0, "id"),
    name: readTextColumn(row, 1, "name"),
    path: readTextColumn(row, 2, "path"),
    directoryIdentity: readTextColumn(row, 3, "directory_identity"),
    projectId: readTextColumn(row, 4, "project_id"),
    registeredBy: readTextColumn(row, 5, "registered_by"),
    revision: readCountColumn(row, 6, "revision"),
  };
}

function readUsageKind(row: readonly DatabaseValue[]): AgentWorkspaceUsageKind {
  const kind = row[2];
  if (kind !== "agent" && kind !== "plan" && kind !== "run")
    throw new AgentError("workspace_invalid");
  return kind;
}

async function readWorkspaces(
  database: DatabaseTransaction,
): Promise<readonly AgentWorkspace[]> {
  const rows = await database.query(`
    SELECT
        ${WORKSPACE_COLUMNS}
    FROM agent_workspaces
    ORDER BY lower(name), id;
  `);
  return rows.map(readWorkspace);
}

async function readUsages(
  database: DatabaseTransaction,
  id: string,
): Promise<readonly AgentWorkspaceUsage[]> {
  const rows = await database.query(
    `
    SELECT DISTINCT
        profiles.id,
        profiles.name,
        'agent' AS kind
    FROM agent_execution_profiles AS profiles,
        json_each(json_extract(profiles.configuration_json, '$.parameters')) AS parameter
    WHERE json_extract_string(parameter.value, '$.defaultValue.type') = 'workspace'
        AND json_extract_string(parameter.value, '$.defaultValue.workspaceId') = $id
    UNION
    SELECT
        id,
        name,
        'plan' AS kind
    FROM agent_plans
    WHERE workspace_id = $id
        OR EXISTS (
            SELECT 1
            FROM json_each(json_extract(agent_plans.plan_json, '$.nodes')) AS node,
                json_each(json_extract(node.value, '$.bindings')) AS binding
            WHERE json_extract_string(binding.value, '$.value.type') = 'workspace'
                AND json_extract_string(binding.value, '$.value.workspaceId') = $id
        )
    UNION
    SELECT
        run_id AS id,
        '' AS name,
        'run' AS kind
    FROM agent_plan_workspace_locks
    WHERE workspace_id = $id
    ORDER BY kind, name, id;
  `,
    { id },
  );
  return rows.map((row) => ({
    id: readTextColumn(row, 0, "id"),
    name: readTextColumn(row, 1, "name"),
    kind: readUsageKind(row),
  }));
}

/** Atomic registration metadata, without filesystem mutation or Git operations. */
export class AgentWorkspaceRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Reads every registration from one coherent database snapshot. */
  public async list(): Promise<readonly AgentWorkspace[]> {
    return this.database.transaction(readWorkspaces);
  }

  /** Returns current references for a protected unregister dialog. */
  public async usages(id: string): Promise<readonly AgentWorkspaceUsage[]> {
    return this.database.transaction((transaction) =>
      readUsages(transaction, id),
    );
  }

  /** Rejects stale writes and overlapping directory registrations inside the transaction. */
  public async save(workspace: AgentWorkspace, isNew: boolean): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const previous = (await readWorkspaces(transaction)).find(
        (entry) => entry.id === workspace.id,
      );
      if (
        (!isNew && previous?.revision !== workspace.revision) ||
        (isNew && previous)
      )
        throw new AgentError("workspace_conflict");
      const overlaps = await transaction.query(
        `
        SELECT id
        FROM agent_workspaces
        WHERE id <> $id
            AND (
                path = $path
                OR starts_with(path, $prefix)
                OR starts_with($path, path || $separator)
            );
      `,
        {
          id: workspace.id,
          path: workspace.path,
          prefix: `${workspace.path}${path.sep}`,
          separator: path.sep,
        },
      );
      if (overlaps.length > 0) throw new AgentError("workspace_path_conflict");
      if (
        previous &&
        (previous.path !== workspace.path ||
          previous.projectId !== workspace.projectId ||
          previous.directoryIdentity !== workspace.directoryIdentity) &&
        (await readUsages(transaction, workspace.id)).length > 0
      )
        throw new AgentError("workspace_in_use");
      await this.saveRecord(transaction, workspace);
    });
  }

  /** Unregisters only an unused, unchanged record; its directory and contents remain intact. */
  public async remove(id: string, revision: number): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const previous = (await readWorkspaces(transaction)).find(
        (entry) => entry.id === id,
      );
      if (!previous) throw new AgentError("workspace_not_found");
      if (previous.revision !== revision)
        throw new AgentError("workspace_conflict");
      if ((await readUsages(transaction, id)).length > 0)
        throw new AgentError("workspace_in_use");
      await transaction.execute(
        "DELETE FROM agent_workspaces WHERE id = $id;",
        { id },
      );
    });
  }

  private async saveRecord(
    transaction: DatabaseTransaction,
    workspace: AgentWorkspace,
  ): Promise<void> {
    await transaction.execute(
      `
      INSERT INTO agent_workspaces (
          id,
          name,
          path,
          directory_identity,
          project_id,
          registered_by,
          revision
      ) VALUES ($id, $name, $path, $identity, $project_id, $registered_by, 1)
      ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          path = EXCLUDED.path,
          directory_identity = EXCLUDED.directory_identity,
          project_id = EXCLUDED.project_id,
          revision = agent_workspaces.revision + 1;
    `,
      {
        id: workspace.id,
        name: workspace.name,
        path: workspace.path,
        identity: workspace.directoryIdentity,
        project_id: workspace.projectId,
        registered_by: workspace.registeredBy,
      },
    );
  }
}
