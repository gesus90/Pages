import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { AgentActivityCost } from "@/definition/AgentEmployee";

/** A learning run or a change of the access level (PAGE-303), as the activity table stores it. */
export interface StoredAgentEvent {
  readonly id: string;
  readonly kind: "learning" | "access";
  readonly detail: string;
  readonly cost: AgentActivityCost;
  readonly createdAt: string;
}

/** One chat job of an agent: a session with a person or a learning run. */
export interface StoredAgentSession {
  readonly id: string;
  readonly purpose: "chat" | "learning";
  readonly personName: string | null;
  readonly state: string;
  readonly createdAt: string;
  readonly cost: AgentActivityCost;
}

/** A ticket or wiki change the agent made, as the project activity records it. */
export interface StoredAgentChange {
  readonly id: string;
  readonly kind: "ticket" | "wiki";
  readonly message: string;
  readonly projectId: string;
  readonly workItemKey: string | null;
  readonly wikiPageId: string | null;
  readonly createdAt: string;
}

/** Known and unknown costs of an agent in one period. */
export interface AgentPeriodCost {
  readonly known: number;
  readonly unknownSessions: number;
}

function readCost(
  amount: DatabaseValue | undefined,
  state: string,
  isEstimated: boolean,
): AgentActivityCost {
  if (state === "known" && typeof amount === "number")
    return { state: "known", amount, isEstimated };
  return {
    state: state === "unknown" ? "unknown" : "none",
    amount: null,
    isEstimated: false,
  };
}

function readJobCost(row: readonly DatabaseValue[]): AgentActivityCost {
  const amount = row[5];
  const currency = readNullableTextColumn(row, 6, "cost_currency");
  if (typeof amount === "number" && currency === "USD")
    return { state: "known", amount, isEstimated: row[7] === 1 };
  return readCost(null, "unknown", false);
}

/**
 * What an agent did: its sessions and learning runs with their costs, and
 * its ticket and wiki changes (PAGE-266).
 *
 * @remarks
 * Sessions are the chat jobs of the agent's conversations, and changes are
 * the project activity the agent's account caused, so nothing is recorded
 * twice. A model that reports no cost leaves its job without an amount; such
 * a job counts as unknown.
 */
export class AgentActivityRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Records a learning run or a change of the access level. */
  public async record(
    userId: string,
    event: Omit<StoredAgentEvent, "createdAt">,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO agent_activity (
            id,
            user_id,
            kind,
            detail,
            cost_amount,
            cost_state
        )
        VALUES (
            $id,
            $user_id,
            $kind,
            $detail,
            $cost_amount,
            $cost_state
        );
      `,
      {
        id: event.id,
        user_id: userId,
        kind: event.kind,
        detail: event.detail,
        cost_amount: event.cost.amount,
        cost_state: event.cost.state,
      },
    );
  }

  /** Lists recorded events of an agent, the newest first. */
  public async events(
    userId: string,
    limit: number,
  ): Promise<StoredAgentEvent[]> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            kind,
            detail,
            cost_amount,
            cost_state,
            created_at
        FROM agent_activity
        WHERE user_id = $user_id
        ORDER BY created_at DESC, id
        LIMIT $limit;
      `,
      { user_id: userId, limit },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      kind:
        readTextColumn(row, 1, "kind") === "access"
          ? ("access" as const)
          : ("learning" as const),
      detail: readTextColumn(row, 2, "detail"),
      cost: readCost(row[3], readTextColumn(row, 4, "cost_state"), false),
      createdAt: readTextColumn(row, 5, "created_at"),
    }));
  }

  /** Lists the chat jobs of an agent's conversations, the newest first. */
  public async sessions(
    userId: string,
    limit: number,
  ): Promise<StoredAgentSession[]> {
    const rows = await this.database.query(
      `
        SELECT
            chat_jobs.id,
            agent_conversations.purpose,
            people.display_name AS person_name,
            chat_jobs.state,
            chat_jobs.created_at,
            chat_jobs.cost_amount,
            chat_jobs.cost_currency,
            CASE WHEN chat_jobs.cost_is_estimated THEN 1 ELSE 0 END
        FROM chat_jobs
        INNER JOIN agent_conversations
            ON agent_conversations.chat_session_id = chat_jobs.session_id
        LEFT JOIN users AS people
            ON people.id = agent_conversations.person_id
            AND agent_conversations.purpose = 'chat'
        WHERE agent_conversations.agent_id = $user_id
        ORDER BY chat_jobs.created_at DESC, chat_jobs.id
        LIMIT $limit;
      `,
      { user_id: userId, limit },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      // Dream runs and memory updates of PAGE-305 are the agent's own sessions.
      purpose: ["learning", "memory"].includes(
        readTextColumn(row, 1, "purpose"),
      )
        ? "learning"
        : "chat",
      personName: readNullableTextColumn(row, 2, "person_name"),
      state: readTextColumn(row, 3, "state"),
      createdAt: readTextColumn(row, 4, "created_at"),
      cost: readJobCost(row),
    }));
  }

  /**
   * Sums the known costs of an agent's chat jobs since a time and counts
   * the jobs without a reported cost.
   *
   * @remarks
   * An adapter that reports the total of its native session repeats earlier
   * costs in every job, so of those jobs only the highest amount per
   * conversation counts.
   */
  public async costSince(
    userId: string,
    since: string,
  ): Promise<AgentPeriodCost> {
    const rows = await this.database.query(
      `
        WITH agent_jobs AS (
            SELECT
                chat_jobs.session_id,
                chat_jobs.cost_amount,
                chat_jobs.cost_currency,
                chat_jobs.cost_scope
            FROM chat_jobs
            INNER JOIN agent_conversations
                ON agent_conversations.chat_session_id = chat_jobs.session_id
            WHERE agent_conversations.agent_id = $user_id
                AND chat_jobs.created_at >= $since
                AND chat_jobs.state <> 'running'
        ),
        session_totals AS (
            SELECT MAX(cost_amount) AS amount
            FROM agent_jobs
            WHERE cost_scope = 'session'
                AND cost_currency = 'USD'
            GROUP BY session_id
        )
        SELECT
            COALESCE((
                SELECT SUM(cost_amount)
                FROM agent_jobs
                WHERE cost_currency = 'USD'
                    AND cost_scope IS DISTINCT FROM 'session'
            ), 0)
            + COALESCE((SELECT SUM(amount) FROM session_totals), 0),
            (
                SELECT COUNT(*)
                FROM agent_jobs
                WHERE cost_amount IS NULL
                    OR cost_currency IS DISTINCT FROM 'USD'
            );
      `,
      { user_id: userId, since },
    );
    const row = rows[0];
    const known = row?.[0];
    return {
      known: typeof known === "number" ? known : 0,
      unknownSessions: row ? readCountColumn(row, 1, "unknown_sessions") : 0,
    };
  }

  /** Lists the ticket and wiki changes the agent's account made, the newest first. */
  public async changes(
    userId: string,
    limit: number,
  ): Promise<StoredAgentChange[]> {
    const rows = await this.database.query(
      `
        SELECT
            project_activity.id,
            project_activity.category,
            project_activity.message,
            project_activity.project_id,
            work_items.key,
            project_activity.wiki_page_id,
            project_activity.created_at
        FROM project_activity
        LEFT JOIN work_items
            ON work_items.id = project_activity.work_item_id
        WHERE project_activity.user_id = $user_id
            AND project_activity.category IN ('tasks', 'wiki')
        ORDER BY project_activity.created_at DESC, project_activity.id
        LIMIT $limit;
      `,
      { user_id: userId, limit },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      kind: readTextColumn(row, 1, "category") === "wiki" ? "wiki" : "ticket",
      message: readTextColumn(row, 2, "message"),
      projectId: readTextColumn(row, 3, "project_id"),
      workItemKey: readNullableTextColumn(row, 4, "key"),
      wikiPageId: readNullableTextColumn(row, 5, "wiki_page_id"),
      createdAt: readTextColumn(row, 6, "created_at"),
    }));
  }
}
