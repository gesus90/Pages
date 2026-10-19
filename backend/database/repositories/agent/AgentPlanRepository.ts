import { allPlanSteps } from "@/definition/AgentPlanGroup";
import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { isUniqueViolationOn } from "@/backend/database/Database";
import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import { agentPlanNameKey } from "@/definition/AgentPlanName";
import { withoutTicketFlow } from "@/definition/AgentPlanGraph";
import { withPortlessPlanGroups } from "@/definition/AgentPlanGroupUpgrade";

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
    plan_json,
    department_id
`;

function readPlan(row: readonly DatabaseValue[]): AgentPlan {
  const input: unknown = JSON.parse(readTextColumn(row, 4, "plan_json"));
  return withPortlessPlanGroups(
    withoutTicketFlow({
      ...readPlanInput(input),
      id: readTextColumn(row, 0, "id"),
      ownerId: readTextColumn(row, 1, "owner_id"),
      projectId: readTextColumn(row, 2, "project_id"),
      revision: readCountColumn(row, 3, "revision"),
      departmentId: readNullableTextColumn(row, 5, "department_id"),
    }),
  );
}

/**
 * Whether a write failed because another plan of the team already has the name.
 *
 * @remarks
 * A violation found while the statement runs names the first column of the
 * index; one found when the transaction commits only says that a key repeats.
 * Nothing else in a plan write can repeat a key: the identifier is checked
 * before the statement.
 */
function isNameViolation(error: unknown): boolean {
  return (
    isUniqueViolationOn(error, "project_id") ||
    (error instanceof Error &&
      error.message.includes("UNIQUE constraint violation"))
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

/** A plan that still waits for the one-time sharing of the plans that existed before teams. */
export interface LegacyShareCandidate {
  readonly id: string;
  readonly ownerId: string;
}

/**
 * What the one-time sharing of a legacy plan came to.
 *
 * - `shared`: the plan now belongs to the department.
 * - `collision`: another plan of the project already has the name in that
 *   department; the plan stays private and is not marked any more.
 * - `settled`: the plan is gone or no longer marked, nothing was changed.
 */
export type LegacyShareResult = "shared" | "collision" | "settled";

/**
 * Stores bounded graphs with optimistic revisions, immutable ownership and
 * one name per team.
 *
 * @remarks
 * The owner and the department are written when a plan is created and never
 * again; whoever saves a later revision only appears as `updated_by`.
 */
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
   * Rejects stale writes atomically, including the workspace project invariant.
   *
   * @param plan - The plan as it is stored.
   * @param isNew - Whether the plan must not exist yet.
   * @param journal - Runs in the same transaction after the write, so a
   * recorded operation result commits together with the plan.
   * @param editorId - The person who stores this revision; absent for a write
   * of the system, which keeps the recorded editor.
   * @throws {AgentError} `plan_conflict` for a stale revision, another owner
   * or department, `plan_name_taken` when another plan of the same project
   * and department already has the name.
   */
  public async save(
    plan: AgentPlan,
    isNew: boolean,
    journal?: (transaction: DatabaseTransaction) => Promise<void>,
    editorId?: string,
  ): Promise<void> {
    try {
      await this.database.transaction((transaction) =>
        writePlan(transaction, { plan, isNew, journal, editorId }),
      );
    } catch (error: unknown) {
      // The unique index decides a name race; the loser is told the name is taken.
      if (isNameViolation(error)) throw new AgentError("plan_name_taken");
      throw error;
    }
  }

  /**
   * Lists the marked legacy plans, the smallest identifier first.
   *
   * @remarks
   * Only plans that existed when migration 062 ran carry the mark; a plan
   * created later never does.
   */
  public async listLegacyShareCandidates(): Promise<
    readonly LegacyShareCandidate[]
  > {
    const rows = await this.database.query(`
      SELECT
          id,
          owner_id
      FROM agent_plans
      WHERE legacy_share_pending = true
      ORDER BY id;
    `);
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      ownerId: readTextColumn(row, 1, "owner_id"),
    }));
  }

  /**
   * Gives a marked legacy plan the department of its owner, once.
   *
   * @remarks
   * Only the department, the name key and the mark change: owner, revision,
   * content, runs and the recorded editor stay as they are. A name that the
   * department already uses in the project is a collision; the plan is never
   * renamed or deleted, it stays private and loses the mark.
   *
   * @param id - The plan.
   * @param departmentId - The only department its owner belongs to.
   */
  public async shareLegacyPlan(
    id: string,
    departmentId: string,
  ): Promise<LegacyShareResult> {
    try {
      return await this.database.transaction(async (transaction) => {
        const [row] = await transaction.query(
          `
          SELECT name
          FROM agent_plans
          WHERE id = $id
              AND legacy_share_pending = true
              AND department_id IS NULL;
        `,
          { id },
        );
        if (!row) return "settled";
        await transaction.execute(
          `
          UPDATE agent_plans
          SET department_id = $department_id,
              name_key = $name_key,
              legacy_share_pending = false
          WHERE id = $id;
        `,
          {
            id,
            department_id: departmentId,
            name_key: agentPlanNameKey(readTextColumn(row, 0, "name")),
          },
        );
        return "shared";
      });
    } catch (error: unknown) {
      if (!isNameViolation(error)) throw error;
      await this.releaseLegacyShare(id);
      return "collision";
    }
  }

  /** Drops the mark of a legacy plan that stays private; nothing else changes. */
  public async releaseLegacyShare(id: string): Promise<void> {
    await this.database.transaction((transaction) =>
      transaction.execute(
        `
        UPDATE agent_plans
        SET legacy_share_pending = false
        WHERE id = $id;
      `,
        { id },
      ),
    );
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

interface PlanWrite {
  readonly plan: AgentPlan;
  readonly isNew: boolean;
  readonly journal?: (transaction: DatabaseTransaction) => Promise<void>;
  readonly editorId?: string;
}

async function writePlan(
  transaction: DatabaseTransaction,
  write: PlanWrite,
): Promise<void> {
  const { plan, isNew } = write;
  const previous = await findPlan(transaction, plan.id);
  if (
    (isNew && previous) ||
    (!isNew &&
      (previous?.revision !== plan.revision ||
        previous.ownerId !== plan.ownerId ||
        (previous.departmentId ?? null) !== (plan.departmentId ?? null)))
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
        department_id,
        name,
        name_key,
        usage,
        revision,
        plan_json,
        updated_by,
        updated_at
    ) VALUES (
        $id,
        $owner_id,
        $project_id,
        $workspace_id,
        $department_id,
        $name,
        $name_key,
        $usage,
        1,
        $plan_json,
        $updated_by,
        utc_now()
    )
    ON CONFLICT (id) DO UPDATE SET
        project_id = EXCLUDED.project_id,
        workspace_id = EXCLUDED.workspace_id,
        name = EXCLUDED.name,
        name_key = EXCLUDED.name_key,
        usage = EXCLUDED.usage,
        revision = agent_plans.revision + 1,
        plan_json = EXCLUDED.plan_json,
        updated_by = COALESCE(EXCLUDED.updated_by, agent_plans.updated_by),
        updated_at = CASE
            WHEN EXCLUDED.updated_by IS NULL THEN agent_plans.updated_at
            ELSE EXCLUDED.updated_at
        END;
  `,
    {
      id: plan.id,
      owner_id: plan.ownerId,
      project_id: plan.projectId,
      workspace_id: plan.workspaceId,
      department_id: plan.departmentId ?? null,
      name: plan.name,
      name_key: agentPlanNameKey(plan.name),
      usage: plan.usage,
      plan_json: JSON.stringify(plan),
      updated_by: write.editorId ?? null,
    },
  );
  await write.journal?.(transaction);
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
