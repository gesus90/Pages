import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";

/** Assigned tickets the removal question names at most; the count covers all. */
const LISTED_TICKETS = 100;

/** A group, project or plan the agent belongs to or owns. */
export interface StoredAgentUsageReference {
  readonly id: string;
  readonly name: string;
}

/** A ticket assigned to the agent. */
export interface StoredAgentTicket {
  readonly id: string;
  readonly key: string;
  readonly title: string;
}

/** Everything that still refers to an agent before it is removed. */
export interface StoredAgentUsages {
  /** Participant lists of the chat that hold the agent. */
  readonly chatLists: number;
  readonly groups: readonly StoredAgentUsageReference[];
  readonly ticketCount: number;
  /** The first assigned tickets by key. */
  readonly tickets: readonly StoredAgentTicket[];
  readonly projects: readonly StoredAgentUsageReference[];
  /** Plans the agent's account owns. */
  readonly plans: readonly StoredAgentUsageReference[];
}

/**
 * Rows of an agent that the removal deletes, in an order without dangling
 * references in between. Every statement names only the bound agent.
 */
const REMOVAL_STATEMENTS: readonly string[] = [
  "DELETE FROM agent_memory_archive WHERE user_id = $user_id;",
  "DELETE FROM agent_memory_versions WHERE user_id = $user_id;",
  "DELETE FROM agent_logbook_entries WHERE agent_id = $user_id;",
  "DELETE FROM agent_recipes WHERE agent_id = $user_id;",
  "DELETE FROM agent_tool_uses WHERE agent_id = $user_id;",
  "DELETE FROM agent_activity WHERE user_id = $user_id;",
  "DELETE FROM agent_employees WHERE user_id = $user_id;",
  "DELETE FROM chat_contacts WHERE contact_id = $user_id OR owner_id = $user_id;",
  "DELETE FROM chat_acp_sessions WHERE user_id = $user_id;",
  "DELETE FROM user_group_members WHERE user_id = $user_id;",
  "DELETE FROM project_members WHERE user_id = $user_id;",
  "DELETE FROM department_members WHERE user_id = $user_id;",
  "DELETE FROM managed_departments WHERE user_id = $user_id;",
  "DELETE FROM user_authorization WHERE user_id = $user_id;",
  "DELETE FROM user_avatars WHERE user_id = $user_id;",
  "DELETE FROM user_settings WHERE user_id = $user_id;",
  "UPDATE work_items SET assignee_id = NULL WHERE assignee_id = $user_id;",
  "UPDATE tasks SET assignee_id = NULL WHERE assignee_id = $user_id;",
];

function readReference(
  row: readonly DatabaseValue[],
): StoredAgentUsageReference {
  return {
    id: readTextColumn(row, 0, "id"),
    name: readTextColumn(row, 1, "name"),
  };
}

/**
 * What refers to an agent, whether it works right now, and its removal
 * (PAGE-267).
 *
 * @remarks
 * The removal deletes the agent's configuration, documents, memory with
 * versions and archive, activity, image, authorization and memberships, and
 * takes it off its tickets. Its `users` row stays as a tombstone without a
 * username, role or image, so earlier tickets, wiki pages and chat messages
 * keep its name as their author. Callers authorize and run it in one
 * transaction.
 */
export class AgentEmployeeRemovalRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Whether a chat job of the agent or a plan run of its account is active now. */
  public async isRunning(userId: string): Promise<boolean> {
    const rows = await this.database.query(
      `
        SELECT
            (
                SELECT COUNT(*)
                FROM chat_jobs
                LEFT JOIN agent_conversations
                    ON agent_conversations.chat_session_id = chat_jobs.session_id
                WHERE chat_jobs.state = 'running'
                    AND (
                        chat_jobs.user_id = $user_id
                        OR agent_conversations.agent_id = $user_id
                    )
            ) AS running_jobs,
            (
                SELECT COUNT(*)
                FROM agent_plan_runs
                WHERE user_id = $user_id
                    AND status IN ('running', 'pausing', 'paused', 'stopping')
            ) AS running_plans;
      `,
      { user_id: userId },
    );
    const row = rows[0];
    if (!row) return false;
    return (
      readCountColumn(row, 0, "running_jobs") +
        readCountColumn(row, 1, "running_plans") >
      0
    );
  }

  /** Reads everything that still refers to the agent. */
  public async usages(userId: string): Promise<StoredAgentUsages> {
    const parameters = { user_id: userId };
    const [contacts, groups, ticketCount, tickets, projects, plans] =
      await Promise.all([
        this.database.query(
          "SELECT COUNT(*) FROM chat_contacts WHERE contact_id = $user_id;",
          parameters,
        ),
        this.database.query(
          `
            SELECT
                user_groups.id,
                user_groups.name
            FROM user_group_members
            INNER JOIN user_groups
                ON user_groups.id = user_group_members.group_id
            WHERE user_group_members.user_id = $user_id
            ORDER BY user_groups.name, user_groups.id;
          `,
          parameters,
        ),
        this.database.query(
          "SELECT COUNT(*) FROM work_items WHERE assignee_id = $user_id;",
          parameters,
        ),
        this.database.query(
          `
            SELECT
                id,
                key,
                title
            FROM work_items
            WHERE assignee_id = $user_id
            ORDER BY key, id
            LIMIT $limit;
          `,
          { ...parameters, limit: LISTED_TICKETS },
        ),
        this.database.query(
          `
            SELECT
                projects.id,
                projects.name
            FROM project_members
            INNER JOIN projects
                ON projects.id = project_members.project_id
            WHERE project_members.user_id = $user_id
            ORDER BY projects.name, projects.id;
          `,
          parameters,
        ),
        this.database.query(
          `
            SELECT
                id,
                name
            FROM agent_plans
            WHERE owner_id = $user_id
            ORDER BY name, id;
          `,
          parameters,
        ),
      ]);
    return {
      chatLists: contacts[0] ? readCountColumn(contacts[0], 0, "count") : 0,
      groups: groups.map(readReference),
      ticketCount: ticketCount[0]
        ? readCountColumn(ticketCount[0], 0, "count")
        : 0,
      tickets: tickets.map((row) => ({
        id: readTextColumn(row, 0, "id"),
        key: readTextColumn(row, 1, "key"),
        title: readTextColumn(row, 2, "title"),
      })),
      projects: projects.map(readReference),
      plans: plans.map(readReference),
    };
  }

  /**
   * Removes the agent and leaves its account as a nameless tombstone.
   *
   * @param userId - The agent's account; a person is never touched by the last step.
   */
  public async remove(userId: string): Promise<void> {
    for (const statement of REMOVAL_STATEMENTS)
      await this.database.execute(statement, { user_id: userId });
    await this.database.execute(
      `
        UPDATE users
        SET
            removed_at = utc_now(),
            is_active = 0,
            username = $tombstone,
            job_title = NULL,
            avatar_type = 'initials',
            avatar_image_url = NULL,
            updated_at = utc_now()
        WHERE id = $user_id
            AND account_kind = 'agent';
      `,
      { user_id: userId, tombstone: `removed-agent-${userId}` },
    );
  }
}
