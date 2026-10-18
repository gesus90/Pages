import { allPlanSteps } from "@/definition/AgentPlanGroup";
import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import { withoutTicketFlow } from "@/definition/AgentPlanGraph";
import { withExplicitGroupFlow } from "@/definition/AgentPlanGroupEdit";

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
  return withExplicitGroupFlow(
    withoutTicketFlow({
      ...readPlanInput(input),
      id: readTextColumn(row, 0, "id"),
      ownerId: readTextColumn(row, 1, "owner_id"),
      projectId: readTextColumn(row, 2, "project_id"),
      revision: readCountColumn(row, 3, "revision"),
    }),
  );
}

async function findPlan(
  database: Pick<DatabaseTransaction, "query">,
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
  private readonly database: Pick<Database, "transaction" | "query">;

  public constructor(database: Pick<Database, "transaction" | "query">) {
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

  /**
   * Rejects stale owner writes atomically, including the workspace project invariant.
   *
   * @param plan - The plan as it is stored.
   * @param isNew - Whether the plan must not exist yet.
   * @param journal - Runs in the same transaction after the write, so a
   * recorded operation result commits together with the plan.
   */
  public async save(
    plan: AgentPlan,
    isNew: boolean,
    journal?: (transaction: DatabaseTransaction) => Promise<void>,
  ): Promise<void> {
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
      await requirePlanEditable(transaction, plan.id);
      await requirePlanAgents(transaction, plan);
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
      await journal?.(transaction);
    });
  }

  /**
   * Deletes an owner's plan unless one of its runs is still active.
   *
   * @remarks
   * Finished runs stay stored, so the run records of the agents keep their
   * history; without the plan they are no longer listed anywhere.
   *
   * @throws {AgentError} `plan_access_denied` when the plan no longer belongs
   * to the owner, `plan_running` while a run is running or paused.
   */
  public async remove(id: string, ownerId: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const previous = await findPlan(transaction, id);
      if (previous?.ownerId !== ownerId)
        throw new AgentError("plan_access_denied");
      const [active] = await transaction.query(
        `
        SELECT id
        FROM agent_plan_runs
        WHERE plan_id = $plan_id
            AND status IN ('running', 'pausing', 'paused', 'stopping')
        LIMIT 1;
      `,
        { plan_id: id },
      );
      if (active) throw new AgentError("plan_running");
      await transaction.execute(
        `
        DELETE FROM agent_plans
        WHERE id = $id;
      `,
        { id },
      );
    });
  }
}

/** Rechecks references within the write transaction so a concurrent deletion cannot leave dangling IDs. */
async function requirePlanAgents(
  database: DatabaseTransaction,
  plan: AgentPlan,
): Promise<void> {
  const ids = new Set(
    allPlanSteps(plan).flatMap((node) =>
      node.type === "agent" ? [node.agentId, node.personalAgentId] : [],
    ),
  );
  for (const id of ids) {
    if (!id) continue;
    const [profile] = await database.query(
      `
      SELECT id
      FROM agent_execution_profiles
      WHERE id = $id;
      `,
      { id },
    );
    if (!profile) throw new AgentError("plan_context_changed");
  }
}

/** Saving must not race a running scheduler or the adoption of a paused revision. */
async function requirePlanEditable(
  transaction: DatabaseTransaction,
  id: string,
): Promise<void> {
  const [active] = await transaction.query(
    `
    SELECT id
    FROM agent_plan_runs
    WHERE plan_id = $id
        AND status IN ('running', 'pausing', 'stopping')
    LIMIT 1;
  `,
    { id },
  );
  if (active) throw new AgentError("plan_pause_required");
}
