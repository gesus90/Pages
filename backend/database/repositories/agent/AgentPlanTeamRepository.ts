import { readBooleanColumn, readTextColumn } from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import { isAgentPlanTeamKind } from "@/definition/AgentPlanTeam";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentPlanTeam } from "@/definition/AgentPlanTeam";

const TEAM_COLUMNS = `
    plan_id,
    kind,
    target_id,
    can_read,
    can_edit,
    can_run
`;

function readTeam(row: readonly DatabaseValue[]): AgentPlanTeam {
  const kind = readTextColumn(row, 1, "kind");
  if (!isAgentPlanTeamKind(kind)) throw new AgentError("plan_invalid");
  return {
    kind,
    targetId: readTextColumn(row, 2, "target_id"),
    canRead: readBooleanColumn(row, 3, "can_read"),
    canEdit: readBooleanColumn(row, 4, "can_edit"),
    canRun: readBooleanColumn(row, 5, "can_run"),
  };
}

function groupByPlan(
  rows: readonly (readonly DatabaseValue[])[],
): ReadonlyMap<string, readonly AgentPlanTeam[]> {
  const teams = new Map<string, AgentPlanTeam[]>();
  for (const row of rows) {
    const planId = readTextColumn(row, 0, "plan_id");
    const list = teams.get(planId) ?? [];
    list.push(readTeam(row));
    teams.set(planId, list);
  }
  return teams;
}

/**
 * Reads the teams of every plan, each list in its stored order.
 *
 * @param database - Any executor that queries.
 */
export async function readAllPlanTeams(
  database: Pick<DatabaseTransaction, "query">,
): Promise<ReadonlyMap<string, readonly AgentPlanTeam[]>> {
  const rows = await database.query(`
    SELECT ${TEAM_COLUMNS}
    FROM agent_plan_teams
    ORDER BY plan_id, position, kind, target_id;
  `);
  return groupByPlan(rows);
}

/**
 * Reads the teams of one plan in their stored order.
 *
 * @param database - Any executor that queries.
 * @param planId - The plan.
 */
export async function readPlanTeams(
  database: Pick<DatabaseTransaction, "query">,
  planId: string,
): Promise<readonly AgentPlanTeam[]> {
  const rows = await database.query(
    `
    SELECT ${TEAM_COLUMNS}
    FROM agent_plan_teams
    WHERE plan_id = $plan_id
    ORDER BY position, kind, target_id;
  `,
    { plan_id: planId },
  );
  return rows.map(readTeam);
}

/**
 * Stores the teams of plans (PAGE-329): groups and departments with their rights.
 *
 * @remarks
 * The teams live outside the plan graph, so a save of the graph never changes
 * them; only {@link replace} does, in the transaction of an access change or
 * of the creation of the plan.
 */
export class AgentPlanTeamRepository {
  private readonly database: Pick<DatabaseTransaction, "query" | "execute">;

  public constructor(database: Pick<DatabaseTransaction, "query" | "execute">) {
    this.database = database;
  }

  /**
   * Replaces the teams of a plan with the given list, in its order.
   *
   * @param planId - The plan.
   * @param teams - The normalized entries; an empty list leaves the plan without a team.
   */
  public async replace(
    planId: string,
    teams: readonly AgentPlanTeam[],
  ): Promise<void> {
    await this.database.execute(
      `
      DELETE FROM agent_plan_teams
      WHERE plan_id = $plan_id;
    `,
      { plan_id: planId },
    );
    for (const [position, team] of teams.entries())
      await this.database.execute(
        `
        INSERT INTO agent_plan_teams (
            plan_id,
            position,
            kind,
            target_id,
            can_read,
            can_edit,
            can_run
        )
        VALUES (
            $plan_id,
            $position,
            $kind,
            $target_id,
            $can_read,
            $can_edit,
            $can_run
        );
      `,
        {
          plan_id: planId,
          position,
          kind: team.kind,
          target_id: team.targetId,
          can_read: team.canRead,
          can_edit: team.canEdit,
          can_run: team.canRun,
        },
      );
  }
}
