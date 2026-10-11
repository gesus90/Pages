import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentPlan } from "@/definition/AgentPlan";

const PLAN_COLUMNS = `
    id,
    owner_id,
    project_id,
    revision,
    plan_json
`;

function readPlan(row: readonly DatabaseValue[]): AgentPlan {
  const input: unknown = JSON.parse(readTextColumn(row, 4, "plan_json"));
  return {
    ...readPlanInput(input),
    id: readTextColumn(row, 0, "id"),
    ownerId: readTextColumn(row, 1, "owner_id"),
    projectId: readTextColumn(row, 2, "project_id"),
    revision: readCountColumn(row, 3, "revision"),
  };
}

async function findPlan(
  database: DatabaseTransaction,
  id: string,
): Promise<AgentPlan | null> {
  const [row] = await database.query(
    `
    SELECT ${PLAN_COLUMNS}
    FROM agent_plans
    WHERE id = $id;
  `,
    { id },
  );
  return row ? readPlan(row) : null;
}

/** Stores bounded graphs with optimistic revisions and immutable ownership. */
export class AgentPlanRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Lists metadata for subsequent service-level grant filtering. */
  public async list(): Promise<readonly AgentPlan[]> {
    const rows = await this.database.query(`
      SELECT ${PLAN_COLUMNS}
      FROM agent_plans
      ORDER BY lower(name), id;
    `);
    return rows.map(readPlan);
  }

  /** Reads a graph without introducing permission policy into persistence. */
  public async find(id: string): Promise<AgentPlan | null> {
    return findPlan(this.database, id);
  }

  /** Rejects stale owner writes atomically, including the workspace project invariant. */
  public async save(plan: AgentPlan, isNew: boolean): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const previous = await findPlan(transaction, plan.id);
      if (
        (isNew && previous) ||
        (!isNew &&
          (previous?.revision !== plan.revision ||
            previous.ownerId !== plan.ownerId))
      )
        throw new AgentError("plan_conflict");
      const [workspace] = await transaction.query(
        `
        SELECT project_id
        FROM agent_workspaces
        WHERE id = $id;
      `,
        { id: plan.workspaceId },
      );
      if (!workspace || workspace[0] !== plan.projectId)
        throw new AgentError("plan_context_changed");
      await transaction.execute(
        `
        INSERT INTO agent_plans (
            id,
            owner_id,
            project_id,
            workspace_id,
            name,
            usage,
            revision,
            plan_json
        ) VALUES ($id, $owner_id, $project_id, $workspace_id, $name, $usage, 1, $plan_json)
        ON CONFLICT (id) DO UPDATE SET
            project_id = EXCLUDED.project_id,
            workspace_id = EXCLUDED.workspace_id,
            name = EXCLUDED.name,
            usage = EXCLUDED.usage,
            revision = agent_plans.revision + 1,
            plan_json = EXCLUDED.plan_json;
      `,
        {
          id: plan.id,
          owner_id: plan.ownerId,
          project_id: plan.projectId,
          workspace_id: plan.workspaceId,
          name: plan.name,
          usage: plan.usage,
          plan_json: JSON.stringify(plan),
        },
      );
    });
  }
}
