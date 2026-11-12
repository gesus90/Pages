import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  AgentProfileProject,
  AgentProfileRunningStep,
  AgentProfileTicket,
} from "@/definition/AgentProfileRead";

/** Listed open tickets of one agent at most; the count of a list covers all. */
const LISTED_TICKETS = 200;

/** Rows of a count query by agent. */
function countsByUser(
  rows: readonly (readonly DatabaseValue[])[],
): Map<string, number> {
  return new Map(
    rows.map((row) => [
      readTextColumn(row, 0, "user_id"),
      readCountColumn(row, 1, "total"),
    ]),
  );
}

/**
 * What the profile of an agent adds to its account: project roles, the
 * workload and the last activity (PAGE-308).
 *
 * @remarks
 * The counts cover every agent in one query each, so a list of agents costs
 * a fixed number of queries. Nothing here reads memory, chat contents or
 * credentials.
 */
export class AgentProfileLoadRepository {
  private readonly database: Pick<Database, "query">;

  public constructor(database: Pick<Database, "query">) {
    this.database = database;
  }

  /** The projects of every member with the project role, by user ID. */
  public async projectsByUser(): Promise<Map<string, AgentProfileProject[]>> {
    const rows = await this.database.query(`
      SELECT
          project_members.user_id,
          projects.id,
          projects.name,
          project_members.role
      FROM project_members
      INNER JOIN projects
          ON projects.id = project_members.project_id
      ORDER BY projects.name, projects.id;
    `);
    const projects = new Map<string, AgentProfileProject[]>();
    for (const row of rows) {
      const userId = readTextColumn(row, 0, "user_id");
      projects.set(userId, [
        ...(projects.get(userId) ?? []),
        {
          id: readTextColumn(row, 1, "id"),
          name: readTextColumn(row, 2, "name"),
          role: readTextColumn(row, 3, "role"),
        },
      ]);
    }
    return projects;
  }

  /** Chats with a job that is running now, by agent. */
  public async activeChats(): Promise<Map<string, number>> {
    const rows = await this.database.query(`
      SELECT
          agent_conversations.agent_id,
          COUNT(DISTINCT chat_jobs.session_id)
      FROM chat_jobs
      INNER JOIN agent_conversations
          ON agent_conversations.chat_session_id = chat_jobs.session_id
      WHERE chat_jobs.state = 'running'
          AND agent_conversations.purpose = 'chat'
      GROUP BY agent_conversations.agent_id;
    `);
    return countsByUser(rows);
  }

  /** Plan steps whose session is starting or running for the account, by agent. */
  public async runningSteps(): Promise<Map<string, AgentProfileRunningStep[]>> {
    const rows = await this.database.query(`
      SELECT
          acp_resource_leases.user_id,
          agent_plan_runs.plan_id,
          acp_resource_leases.run_id,
          acp_resource_leases.step_id
      FROM acp_resource_leases
      INNER JOIN agent_plan_runs
          ON agent_plan_runs.id = acp_resource_leases.run_id
      WHERE acp_resource_leases.state IN ('starting', 'running')
          AND acp_resource_leases.step_id IS NOT NULL
      ORDER BY acp_resource_leases.since, acp_resource_leases.instance_id;
    `);
    const steps = new Map<string, AgentProfileRunningStep[]>();
    for (const row of rows) {
      const userId = readTextColumn(row, 0, "user_id");
      steps.set(userId, [
        ...(steps.get(userId) ?? []),
        {
          planId: readTextColumn(row, 1, "plan_id"),
          runId: readTextColumn(row, 2, "run_id"),
          stepId: readTextColumn(row, 3, "step_id"),
        },
      ]);
    }
    return steps;
  }

  /** The number of unfinished, unarchived tickets assigned to each agent. */
  public async openTicketCounts(): Promise<Map<string, number>> {
    const rows = await this.database.query(`
      SELECT
          work_items.assignee_id,
          COUNT(*)
      FROM work_items
      WHERE work_items.assignee_id IS NOT NULL
          AND work_items.completed_at IS NULL
          AND work_items.archived_at IS NULL
      GROUP BY work_items.assignee_id;
    `);
    return countsByUser(rows);
  }

  /** The first unfinished tickets of one agent by key. */
  public async openTickets(userId: string): Promise<AgentProfileTicket[]> {
    const rows = await this.database.query(
      `
      SELECT
          id,
          key,
          title
      FROM work_items
      WHERE assignee_id = $user_id
          AND completed_at IS NULL
          AND archived_at IS NULL
      ORDER BY key, id
      LIMIT $limit;
    `,
      { user_id: userId, limit: LISTED_TICKETS },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      key: readTextColumn(row, 1, "key"),
      title: readTextColumn(row, 2, "title"),
    }));
  }

  /**
   * When each agent last did something: a chat job, a change in a project,
   * a plan run or a learning run, as ISO 8601 times in UTC.
   *
   * @remarks
   * The sources store times as `YYYY-MM-DD HH:MM:SS` or as ISO text, so the
   * query cuts both to the same seconds form before it compares them.
   */
  public async lastActivity(): Promise<Map<string, string>> {
    const rows = await this.database.query(`
      SELECT
          activity.user_id,
          MAX(substr(replace(activity.at, ' ', 'T'), 1, 19))
      FROM (
          SELECT
              agent_conversations.agent_id AS user_id,
              chat_jobs.created_at AS at
          FROM chat_jobs
          INNER JOIN agent_conversations
              ON agent_conversations.chat_session_id = chat_jobs.session_id
          UNION ALL
          SELECT
              user_id,
              created_at
          FROM project_activity
          UNION ALL
          SELECT
              user_id,
              started_at
          FROM agent_plan_runs
          UNION ALL
          SELECT
              user_id,
              created_at
          FROM agent_activity
      ) AS activity
      GROUP BY activity.user_id;
    `);
    const times = new Map<string, string>();
    for (const row of rows) {
      const at = readNullableTextColumn(row, 1, "at");
      if (at !== null) times.set(readTextColumn(row, 0, "user_id"), `${at}Z`);
    }
    return times;
  }
}
