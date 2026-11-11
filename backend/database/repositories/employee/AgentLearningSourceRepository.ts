import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** Where a learning source comes from. */
export type AgentLearningSourceKind = "chat" | "project" | "group" | "plan";

/** One new piece of content a learning run may take in. */
export interface AgentLearningSource {
  readonly kind: AgentLearningSourceKind;
  /** When it happened, `YYYY-MM-DD HH:MM:SS` UTC. */
  readonly at: string;
  /** Where it happened: the person, project, group or plan run. */
  readonly origin: string;
  readonly text: string;
}

/** What one read of the sources is bounded by. */
export interface AgentLearningWindow {
  /** Only content after this time, `YYYY-MM-DD HH:MM:SS` UTC; `null` reads from the start. */
  readonly since: string | null;
  /** Entries per source at most. */
  readonly limit: number;
}

const BEGINNING = "0000-00-00 00:00:00";

/** Turns an ISO time into the text form the other sources use. */
function fromIso(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

/** Turns the text form into a prefix an ISO time compares against. */
function toIso(text: string): string {
  return text.replace(" ", "T");
}

/**
 * Reads what is new for an agent since its last dream run (PAGE-266,
 * PAGE-305): its own chats and conversations, the projects it is a member
 * of, the groups it belongs to and the plan runs of its projects; chats
 * marked confidential are left out.
 *
 * @remarks
 * Every source is limited to what the agent itself takes part in, so a run
 * learns nothing its account could not read.
 */
export class AgentLearningSourceRepository {
  private readonly database: Pick<Database, "query">;

  public constructor(database: Pick<Database, "query">) {
    this.database = database;
  }

  /** Returns the new content of every source, the oldest first. */
  public async read(
    agentId: string,
    window: AgentLearningWindow,
  ): Promise<AgentLearningSource[]> {
    const since = window.since ?? BEGINNING;
    const sources = [
      ...(await this.chats(agentId, since, window.limit)),
      ...(await this.conversations(agentId, since, window.limit)),
      ...(await this.projects(agentId, since, window.limit)),
      ...(await this.groups(agentId, since, window.limit)),
      ...(await this.plans(agentId, since, window.limit)),
    ];
    return sources.sort((left, right) => left.at.localeCompare(right.at));
  }

  private async chats(
    agentId: string,
    since: string,
    limit: number,
  ): Promise<AgentLearningSource[]> {
    const rows = await this.database.query(
      `
        SELECT
            chat_messages.created_at,
            chat_messages.role,
            chat_messages.content,
            people.display_name
        FROM chat_messages
        INNER JOIN agent_conversations
            ON agent_conversations.chat_session_id = chat_messages.session_id
        INNER JOIN users AS people
            ON people.id = agent_conversations.person_id
        WHERE agent_conversations.agent_id = $agent_id
            AND agent_conversations.purpose = 'chat'
            AND NOT agent_conversations.is_confidential
            AND chat_messages.created_at > $since
        ORDER BY chat_messages.created_at, chat_messages.position
        LIMIT $limit;
      `,
      { agent_id: agentId, since, limit },
    );
    return rows.map((row) => {
      const person = readTextColumn(row, 3, "display_name");
      return {
        kind: "chat",
        at: readTextColumn(row, 0, "created_at"),
        origin:
          readTextColumn(row, 1, "role") === "user" ? person : `→ ${person}`,
        text: readTextColumn(row, 2, "content"),
      };
    });
  }

  /** The messages of the stored conversations the agent belongs to, confidential ones left out (PAGE-305). */
  private async conversations(
    agentId: string,
    since: string,
    limit: number,
  ): Promise<AgentLearningSource[]> {
    const rows = await this.database.query(
      `
        SELECT
            conversation_messages.created_at,
            conversations.name,
            senders.display_name,
            conversation_messages.text,
            conversation_messages.sender_id
        FROM conversation_messages
        INNER JOIN conversation_members
            ON conversation_members.conversation_id = conversation_messages.conversation_id
            AND conversation_members.user_id = $agent_id
        INNER JOIN conversations
            ON conversations.id = conversation_messages.conversation_id
        INNER JOIN users AS senders
            ON senders.id = conversation_messages.sender_id
        WHERE NOT conversations.is_confidential
            AND conversation_messages.text <> ''
            AND conversation_messages.created_at > $since
        ORDER BY conversation_messages.sequence
        LIMIT $limit;
      `,
      { agent_id: agentId, since: toIso(since), limit },
    );
    return rows.map((row) => {
      const sender = readTextColumn(row, 2, "display_name");
      const name = readTextColumn(row, 1, "name");
      const isOwn = readTextColumn(row, 4, "sender_id") === agentId;
      return {
        kind: "chat",
        at: fromIso(readTextColumn(row, 0, "created_at")),
        origin: `${isOwn ? "→ " : ""}${name === "" ? sender : `${name} · ${sender}`}`,
        text: readTextColumn(row, 3, "text"),
      };
    });
  }

  private async projects(
    agentId: string,
    since: string,
    limit: number,
  ): Promise<AgentLearningSource[]> {
    const rows = await this.database.query(
      `
        SELECT
            project_activity.created_at,
            projects.name,
            actors.display_name,
            project_activity.message
        FROM project_activity
        INNER JOIN project_members
            ON project_members.project_id = project_activity.project_id
            AND project_members.user_id = $agent_id
        INNER JOIN projects
            ON projects.id = project_activity.project_id
        LEFT JOIN users AS actors
            ON actors.id = project_activity.user_id
        WHERE project_activity.created_at > $since
        ORDER BY project_activity.created_at, project_activity.id
        LIMIT $limit;
      `,
      { agent_id: agentId, since, limit },
    );
    return rows.map((row) => ({
      kind: "project",
      at: readTextColumn(row, 0, "created_at"),
      origin: [
        readTextColumn(row, 1, "name"),
        readNullableTextColumn(row, 2, "display_name"),
      ]
        .filter((part) => part !== null)
        .join(" · "),
      text: readTextColumn(row, 3, "message"),
    }));
  }

  private async groups(
    agentId: string,
    since: string,
    limit: number,
  ): Promise<AgentLearningSource[]> {
    const rows = await this.database.query(
      `
        SELECT
            work_items.updated_at,
            user_groups.name,
            work_items.key,
            work_items.title
        FROM work_items
        INNER JOIN user_group_members
            ON user_group_members.group_id = work_items.assignee_group_id
            AND user_group_members.user_id = $agent_id
        INNER JOIN user_groups
            ON user_groups.id = work_items.assignee_group_id
        WHERE work_items.updated_at > $since
            AND work_items.archived_at IS NULL
        ORDER BY work_items.updated_at, work_items.id
        LIMIT $limit;
      `,
      { agent_id: agentId, since, limit },
    );
    return rows.map((row) => ({
      kind: "group",
      at: readTextColumn(row, 0, "updated_at"),
      origin: readTextColumn(row, 1, "name"),
      text: `${readTextColumn(row, 2, "key")}: ${readTextColumn(row, 3, "title")}`,
    }));
  }

  private async plans(
    agentId: string,
    since: string,
    limit: number,
  ): Promise<AgentLearningSource[]> {
    const rows = await this.database.query(
      `
        SELECT
            agent_plan_runs.started_at,
            projects.name,
            agent_plan_runs.status,
            agent_plan_step_reports.report_json
        FROM agent_plan_runs
        INNER JOIN project_members
            ON project_members.project_id = agent_plan_runs.project_id
            AND project_members.user_id = $agent_id
        INNER JOIN projects
            ON projects.id = agent_plan_runs.project_id
        LEFT JOIN agent_plan_step_reports
            ON agent_plan_step_reports.run_id = agent_plan_runs.id
        WHERE agent_plan_runs.started_at > $since
        ORDER BY agent_plan_runs.started_at, agent_plan_runs.id
        LIMIT $limit;
      `,
      { agent_id: agentId, since: toIso(since), limit },
    );
    return rows.map((row) => ({
      kind: "plan",
      at: fromIso(readTextColumn(row, 0, "started_at")),
      origin: readTextColumn(row, 1, "name"),
      text: describeReport(
        readTextColumn(row, 2, "status"),
        readNullableTextColumn(row, 3, "report_json"),
      ),
    }));
  }
}

/** The status of a run and the summary its step reported, without anything else of the report. */
function describeReport(status: string, report: string | null): string {
  if (report === null) return status;
  try {
    const parsed: unknown = JSON.parse(report);
    if (typeof parsed !== "object" || parsed === null) return status;
    const summary: unknown = Reflect.get(parsed, "summary");
    const message: unknown = Reflect.get(parsed, "message");
    const text = [summary, message].find(
      (entry): entry is string => typeof entry === "string" && entry !== "",
    );
    return text ? `${status}: ${text}` : status;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return status;
    throw error;
  }
}
