import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import {
  withoutWorkspaceReferences,
  workspaceReferenceIds,
} from "@/backend/agents/AgentWorkspaceReferences";
import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentWorkspaceUsage } from "@/definition/AgentWorkspace";

const REFERENCED_PLANS = `
    SELECT id
    FROM agent_plans
    WHERE workspace_id = $id
        OR EXISTS (
            SELECT 1
            FROM json_tree(agent_plans.plan_json) AS reference
            WHERE json_extract_string(reference.value, '$.workspaceId') = $id
        )
`;

const REFERENCED_AGENTS = `
    SELECT id
    FROM agent_execution_profiles
    WHERE EXISTS (
        SELECT 1
        FROM json_tree(agent_execution_profiles.configuration_json) AS reference
        WHERE json_extract_string(reference.value, '$.workspaceId') = $id
    )
`;

/** Shared atomic reference handling for local and remote registration removal. */
export class AgentWorkspaceReferencesRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Includes current graph references and active snapshots, including pending cleanup. */
  public async usages(id: string): Promise<readonly AgentWorkspaceUsage[]> {
    const rows = await this.database.query(
      `
      SELECT id, name, 'agent' AS kind
      FROM agent_execution_profiles
      WHERE id IN (${REFERENCED_AGENTS})
      UNION
      SELECT id, name, 'plan' AS kind
      FROM agent_plans
      WHERE id IN (${REFERENCED_PLANS})
      UNION
      SELECT id, CAST(NULL AS TEXT) AS name, 'run' AS kind
      FROM agent_plan_runs
      WHERE (
          status IN ('running', 'pausing', 'paused', 'stopping')
          OR id IN (SELECT run_id FROM agent_plan_workspace_locks)
      )
          AND (
              workspace_id = $id
              OR EXISTS (
                  SELECT 1
                  FROM json_tree(agent_plan_runs.snapshot_json) AS reference
                  WHERE json_extract_string(reference.value, '$.workspaceId') = $id
              )
              OR EXISTS (
                  SELECT 1
                  FROM agent_plan_continuations AS continuation,
                      json_tree(continuation.snapshot_json) AS reference
                  WHERE continuation.run_id = agent_plan_runs.id
                      AND json_extract_string(reference.value, '$.workspaceId') = $id
              )
          )
      UNION
      SELECT run_id AS id, CAST(NULL AS TEXT) AS name, 'run' AS kind
      FROM agent_plan_workspace_locks
      WHERE workspace_id = $id
      ORDER BY kind, name NULLS LAST, id;
    `,
      { id },
    );
    return rows.map((row) => {
      const kind = readTextColumn(row, 2, "kind");
      if (kind !== "agent" && kind !== "plan" && kind !== "run")
        throw new AgentError("workspace_invalid");
      return {
        id: readTextColumn(row, 0, "id"),
        name: readNullableTextColumn(row, 1, "name"),
        kind,
      };
    });
  }

  /** Logically detaches current references and retains exact-owner cleanup obligations in the same transaction. */
  public async detach(
    id: string,
    removal: { readonly userId: string; readonly name: string },
  ): Promise<void> {
    const usages = await this.usages(id);
    for (const usage of usages.filter((entry) => entry.kind === "run")) {
      const [row] = await this.database.query(
        "SELECT view_json FROM agent_plan_runs WHERE id = $id;",
        { id: usage.id },
      );
      if (row) {
        const run = readPlanRun(
          JSON.parse(readTextColumn(row, 0, "view_json")),
        );
        await this.database.execute(
          `
          UPDATE agent_plan_runs SET view_json = $view_json, recovery_revision = recovery_revision + 1 WHERE id = $id;
        `,
          {
            id: run.id,
            view_json: JSON.stringify({ ...run, stopRequested: true }),
          },
        );
      }
      await this.database.execute(
        `
        INSERT INTO agent_workspace_cleanup (workspace_id, run_id, owner_id, removed_by, workspace_name)
        SELECT $workspace_id, id, user_id, $removed_by, $name
        FROM agent_plan_runs
        WHERE id = $run_id
        ON CONFLICT (workspace_id, run_id) DO NOTHING;
      `,
        {
          workspace_id: id,
          run_id: usage.id,
          removed_by: removal.userId,
          name: removal.name,
        },
      );
    }
    if (usages.some((usage) => usage.kind === "plan"))
      await this.detachPlans(id);
    if (usages.some((usage) => usage.kind === "agent"))
      await this.detachAgents(id);
    await this.detachTemplates(id);
  }

  /** Prevents a concurrent save from restoring a registration that removal just detached. */
  public async requireReferences(input: unknown): Promise<void> {
    for (const id of workspaceReferenceIds(input)) {
      const [registration] = await this.database.query(
        `
        SELECT id FROM agent_workspaces WHERE id = $id
        UNION ALL
        SELECT id FROM remote_workspaces WHERE id = $id;
      `,
        { id },
      );
      if (!registration) throw new AgentError("workspace_not_found");
    }
  }

  private async detachPlans(id: string): Promise<void> {
    const rows = await this.database.query(
      `
      SELECT id, plan_json
      FROM agent_plans
      WHERE id IN (${REFERENCED_PLANS});
    `,
      { id },
    );
    for (const row of rows) {
      const original: unknown = JSON.parse(readTextColumn(row, 1, "plan_json"));
      const cleared = withoutWorkspaceReferences(original, id);
      if (
        typeof cleared !== "object" ||
        cleared === null ||
        Array.isArray(cleared)
      )
        throw new AgentError("plan_invalid");
      await this.database.execute(
        `
        UPDATE agent_plans
        SET workspace_id = $workspace_id,
            plan_json = $plan_json,
            revision = revision + 1,
            updated_at = utc_now()
        WHERE id = $plan_id;
      `,
        {
          plan_id: readTextColumn(row, 0, "id"),
          workspace_id:
            "workspaceId" in cleared && typeof cleared.workspaceId === "string"
              ? cleared.workspaceId
              : "",
          plan_json: JSON.stringify(cleared),
        },
      );
    }
  }

  private async detachTemplates(id: string): Promise<void> {
    const rows = await this.database.query(
      `
      SELECT id, node_json
      FROM agent_plan_templates
      WHERE EXISTS (
          SELECT 1 FROM json_tree(agent_plan_templates.node_json) AS reference
          WHERE json_extract_string(reference.value, '$.workspaceId') = $id
      );
    `,
      { id },
    );
    for (const row of rows)
      await this.database.execute(
        `
      UPDATE agent_plan_templates SET node_json = $node_json WHERE id = $id;
    `,
        {
          id: readTextColumn(row, 0, "id"),
          node_json: JSON.stringify(
            withoutWorkspaceReferences(
              JSON.parse(readTextColumn(row, 1, "node_json")),
              id,
            ),
          ),
        },
      );
  }

  private async detachAgents(id: string): Promise<void> {
    const rows = await this.database.query(
      `
      SELECT id, configuration_json
      FROM agent_execution_profiles
      WHERE id IN (${REFERENCED_AGENTS});
    `,
      { id },
    );
    for (const row of rows) {
      const configuration: unknown = JSON.parse(
        readTextColumn(row, 1, "configuration_json"),
      );
      await this.database.execute(
        `
        UPDATE agent_execution_profiles
        SET configuration_json = $configuration_json,
            revision = revision + 1
        WHERE id = $profile_id;
      `,
        {
          profile_id: readTextColumn(row, 0, "id"),
          configuration_json: JSON.stringify(
            withoutWorkspaceReferences(configuration, id),
          ),
        },
      );
    }
  }
}
