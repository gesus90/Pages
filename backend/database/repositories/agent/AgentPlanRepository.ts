import { allPlanSteps } from "@/definition/AgentPlanGroup";
import {
  readPlanInput,
  readPlanSharing,
} from "@/backend/agents/AgentPlanInput";
import { requireCloneablePlan } from "@/backend/agents/AgentPlanCloneShape";
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
import { fullPlanTeam } from "@/definition/AgentPlanTeam";

import { AgentWorkspaceReferencesRepository } from "./AgentWorkspaceReferencesRepository";
import {
  requirePlanConnections,
  requireRemotePlanModels,
} from "./AgentPlanStoredReferences";
import {
  AgentPlanTeamRepository,
  readAllPlanTeams,
  readPlanTeams,
} from "./AgentPlanTeamRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentPlan, AgentPlanInput } from "@/definition/AgentPlan";

const PLAN_COLUMNS = `
    id,
    owner_id,
    project_id,
    revision,
    plan_json,
    department_id,
    one_shot_delete_at
`;

/** The deadline of a one-time plan from its own column; it is never part of the stored graph. */
function scheduledDeletion(
  deadline: string | null,
): Pick<AgentPlan, "scheduledDeletionAt"> {
  return deadline === null ? {} : { scheduledDeletionAt: deadline };
}

/** Fields of a plan that live in columns or tables of their own and never in its JSON. */
const UNSTORED_PLAN_FIELDS: ReadonlySet<string> = new Set([
  "scheduledDeletionAt",
  "teams",
]);

/** The graph as it is stored: the deadline and the teams live outside it, so a plan read back never carries them into the JSON. */
function storedPlanJson(plan: AgentPlan): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(plan).filter(([key]) => !UNSTORED_PLAN_FIELDS.has(key)),
    ),
  );
}

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
      ...scheduledDeletion(
        readNullableTextColumn(row, 6, "one_shot_delete_at"),
      ),
    }),
  );
}

/**
 * What a list of plans needs of each plan: its identity and the sharing that
 * decides who reads it, never its graph.
 */
export interface AgentPlanListing {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly departmentId: string | null;
  readonly usage: AgentPlanInput["usage"];
  readonly revision: number;
  readonly sharing?: AgentPlanInput["sharing"];
  /** The groups and departments that share the plan, with their rights. */
  readonly teams?: AgentPlan["teams"];
  /** Whether the plan is a one-time plan, read from its stored graph. */
  readonly oneShot?: boolean;
  /** When the one-time plan is deleted; absent or `null` while nothing is scheduled. */
  readonly scheduledDeletionAt?: string | null;
}

function readListing(row: readonly DatabaseValue[]): AgentPlanListing {
  const usage = readTextColumn(row, 6, "usage");
  if (usage !== "private" && usage !== "workspace")
    throw new AgentError("plan_invalid");
  const sharing = readNullableTextColumn(row, 8, "sharing_json");
  return {
    id: readTextColumn(row, 0, "id"),
    ownerId: readTextColumn(row, 1, "owner_id"),
    projectId: readTextColumn(row, 2, "project_id"),
    workspaceId: readTextColumn(row, 3, "workspace_id"),
    departmentId: readNullableTextColumn(row, 4, "department_id"),
    name: readTextColumn(row, 5, "name"),
    usage,
    revision: readCountColumn(row, 7, "revision"),
    ...(readNullableTextColumn(row, 9, "one_shot") === "true"
      ? { oneShot: true }
      : {}),
    ...scheduledDeletion(readNullableTextColumn(row, 10, "one_shot_delete_at")),
    ...(sharing === null
      ? {}
      : { sharing: readPlanSharing(JSON.parse(sharing)) }),
  };
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
  return row
    ? { ...readPlan(row), teams: await readPlanTeams(database, id) }
    : null;
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
    const [rows, teams] = await Promise.all([
      this.database.query(`
        SELECT ${PLAN_COLUMNS}
        FROM agent_plans
        ORDER BY lower(name), id;
      `),
      readAllPlanTeams(this.database),
    ]);
    return rows.map((row) => {
      const plan = readPlan(row);
      return { ...plan, teams: teams.get(plan.id) ?? [] };
    });
  }

  /**
   * Lists every plan without its graph, in the order of {@link list}.
   *
   * @remarks
   * The graph of a plan can be megabytes; it stays in the database, which
   * hands out only the identity columns and the sharing of each plan.
   */
  public async listings(): Promise<readonly AgentPlanListing[]> {
    const listed = this.database.query(`
      SELECT
          id,
          owner_id,
          project_id,
          workspace_id,
          department_id,
          name,
          usage,
          revision,
          json_extract_string(plan_json, '$.sharing') AS sharing_json,
          json_extract_string(plan_json, '$.oneShot') AS one_shot,
          one_shot_delete_at
      FROM agent_plans
      ORDER BY lower(name), id;
    `);
    const [rows, teams] = await Promise.all([
      listed,
      readAllPlanTeams(this.database),
    ]);
    return rows.map((row) => {
      const listing = readListing(row);
      return { ...listing, teams: teams.get(listing.id) ?? [] };
    });
  }

  /** Reads a graph without introducing permission policy into persistence. */
  public async find(id: string): Promise<AgentPlan | null> {
    return findPlan(this.database, id);
  }

  /** Reads the saved source for clone normalization, after the service authorized its visibility. */
  public async cloneSource(id: string): Promise<unknown> {
    const [row] = await this.database.query(
      `
      SELECT plan_json
      FROM agent_plans
      WHERE id = $id;
    `,
      { id },
    );
    if (!row) throw new AgentError("source_not_visible");
    const source: unknown = JSON.parse(readTextColumn(row, 0, "plan_json"));
    return source;
  }

  /** Refuses a stale source or unknown persisted fields instead of silently producing a partial clone. */
  public async requireCloneSource(id: string, revision: number): Promise<void> {
    const [row] = await this.database.query(
      `
      SELECT
          revision,
          plan_json
      FROM agent_plans
      WHERE id = $id;
    `,
      { id },
    );
    if (!row || readCountColumn(row, 0, "revision") !== revision)
      throw new AgentError("plan_conflict");
    const stored: unknown = JSON.parse(readTextColumn(row, 1, "plan_json"));
    requireCloneablePlan(stored);
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
   * and department already has the name, `plan_pause_required` while a run of
   * the plan executes steps.
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
        await new AgentPlanTeamRepository(transaction).replace(id, [
          fullPlanTeam("department", departmentId),
        ]);
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
   * Removes the one-time mark of a plan and cancels its scheduled deletion (PAGE-309).
   *
   * @param id - The plan.
   * @param options - The revision the person saw, the person who keeps it
   * and the journal that runs in the same transaction.
   * @returns Whether anything changed; a plan without the mark stays as it is.
   * @throws {AgentError} `plan_conflict` for a stale revision,
   * `plan_pause_required` while a run of the plan executes steps.
   *
   * @remarks
   * The mark is a plan setting, so removing it is a saved revision like any
   * other change of the plan.
   */
  public async keepOneShot(
    id: string,
    options: {
      readonly revision: number;
      readonly editorId: string;
      readonly journal?: (transaction: DatabaseTransaction) => Promise<void>;
    },
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction.query(
        `
        SELECT
            revision,
            plan_json
        FROM agent_plans
        WHERE id = $id
        FOR UPDATE;
      `,
        { id },
      );
      if (!row || readCountColumn(row, 0, "revision") !== options.revision)
        throw new AgentError("plan_conflict");
      const stored = unmarkedPlan(readTextColumn(row, 1, "plan_json"));
      if (stored === null) {
        await cancelScheduledDeletion(transaction, { id });
        await options.journal?.(transaction);
        return false;
      }
      await requireEditablePlan(transaction, id);
      await transaction.execute(
        `
        UPDATE agent_plans
        SET plan_json = $plan_json,
            revision = revision + 1,
            one_shot_delete_at = NULL,
            updated_by = $updated_by,
            updated_at = utc_now()
        WHERE id = $id;
      `,
        { id, plan_json: stored, updated_by: options.editorId },
      );
      await options.journal?.(transaction);
      return true;
    });
  }

  /**
   * Deletes an owner's plan unless one of its runs is still active.
   *
   * @remarks
   * Finished runs stay stored, so the run records of the agents keep their
   * history; without the plan they are no longer listed anywhere.
   *
   * @param id - The plan.
   * @param ownerId - The owner the plan must still belong to, or `null` for an
   * administrator, who deletes every plan (PAGE-329).
   * @param options - The revision the person saw and the journal of the deletion.
   * @throws {AgentError} `plan_access_denied` when the plan no longer belongs
   * to the owner, `plan_running` while a run is running or paused.
   */
  public async remove(
    id: string,
    ownerId: string | null,
    options?: {
      readonly revision: number;
      readonly journal: (transaction: DatabaseTransaction) => Promise<void>;
    },
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const previous = await findPlan(transaction, id);
      if (!previous || (ownerId !== null && previous.ownerId !== ownerId))
        throw new AgentError("plan_access_denied");
      if (options && previous.revision !== options.revision)
        throw new AgentError("plan_conflict");
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
        `DELETE FROM agent_plan_start_rejections WHERE plan_id = $id;`,
        { id },
      );
      await transaction.execute(
        `
        DELETE FROM agent_plans
        WHERE id = $id;
      `,
        { id },
      );
      await options?.journal(transaction);
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
  if (!isNew) await requireEditablePlan(transaction, plan.id);
  await requirePlanWorkspace(transaction, plan);
  await requirePlanAgents(transaction, plan);
  await new AgentWorkspaceReferencesRepository(transaction).requireReferences(
    plan,
  );
  await storePlan(transaction, write);
  if (isNew)
    await new AgentPlanTeamRepository(transaction).replace(
      plan.id,
      plan.teams ?? [],
    );
  await write.journal?.(transaction);
}

/** UI, Pica, MCP and agent sessions all store through here, so one check covers every editor. */
async function requireEditablePlan(
  transaction: DatabaseTransaction,
  planId: string,
): Promise<void> {
  const [executing] = await transaction.query(
    `
    SELECT id
    FROM agent_plan_runs
    WHERE plan_id = $plan_id
        AND status IN ('running', 'pausing', 'stopping')
    LIMIT 1;
  `,
    { plan_id: planId },
  );
  if (executing) throw new AgentError("plan_pause_required");
}

async function requirePlanWorkspace(
  transaction: DatabaseTransaction,
  plan: AgentPlan,
): Promise<void> {
  const [workspace] = await transaction.query(
    `
    SELECT project_id
    FROM agent_workspaces
    WHERE id = $id
    UNION ALL
    SELECT project_id
    FROM remote_workspaces
    WHERE id = $id
        AND id = $remote_id;
  `,
    {
      id: plan.workspaceId,
      remote_id:
        plan.executionTarget?.kind === "remote"
          ? plan.executionTarget.workspaceId
          : "",
    },
  );
  if (!workspace || workspace[0] !== plan.projectId)
    throw new AgentError("plan_context_changed");
}

/** The stored graph without the one-time mark; `null` when it carries none. */
function unmarkedPlan(planJson: string): string | null {
  const stored: unknown = JSON.parse(planJson);
  if (typeof stored !== "object" || stored === null || !("oneShot" in stored))
    return null;
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(stored).filter(([key]) => key !== "oneShot"),
    ),
  );
}

async function cancelScheduledDeletion(
  transaction: DatabaseTransaction,
  plan: Pick<AgentPlan, "id">,
): Promise<void> {
  await transaction.execute(
    `
    UPDATE agent_plans
    SET one_shot_delete_at = NULL
    WHERE id = $id
        AND one_shot_delete_at IS NOT NULL;
  `,
    { id: plan.id },
  );
}

async function storePlan(
  transaction: DatabaseTransaction,
  write: PlanWrite,
): Promise<void> {
  const { plan } = write;
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
        -- Removing the one-time mark cancels a scheduled deletion in the commit of that change.
        one_shot_delete_at = CASE
            WHEN json_extract_string(EXCLUDED.plan_json, '$.oneShot') = 'true'
                THEN agent_plans.one_shot_delete_at
        END,
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
      plan_json: storedPlanJson(plan),
      updated_by: write.editorId ?? null,
    },
  );
}

/** Rechecks references within the write transaction so a concurrent deletion cannot leave dangling IDs. */
async function requirePlanAgents(
  database: DatabaseTransaction,
  plan: AgentPlan,
): Promise<void> {
  const ids = new Set(
    allPlanSteps(plan).flatMap((node) =>
      node.configuration?.connectionId || node.configuration?.runnerRoute
        ? []
        : [node.agentId, node.personalAgentId],
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
  await requirePlanConnections(database, plan);
  await requireRemotePlanModels(database, plan);
}

/** Checks the saved revision within an operation's write transaction, before recording a no-op or run command. */
export async function requirePlanRevision(
  transaction: DatabaseTransaction,
  id: string,
  revision: number,
): Promise<void> {
  const [row] = await transaction.query(
    "SELECT revision FROM agent_plans WHERE id = $id;",
    { id },
  );
  if (!row || Number(row[0]) !== revision)
    throw new AgentError("plan_conflict");
}
