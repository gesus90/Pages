import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { AgentChatTaskKind } from "@/definition/AgentChatTask";

/** Where a stored task is bound: a group conversation, or the direct chat of a person with the agent. */
export type StoredAgentChatTaskChat =
  | { readonly kind: "group"; readonly conversationId: string }
  | { readonly kind: "direct"; readonly personId: string };

/** The binding of an automation to a chat and its agent. */
export interface StoredAgentChatTask {
  readonly automationId: string;
  readonly agentId: string;
  readonly requesterId: string;
  readonly chat: StoredAgentChatTaskChat;
  readonly kind: AgentChatTaskKind;
  readonly request: string;
  readonly instruction: string;
  readonly createdAt: string;
}

const COLUMNS = `
    automation_id,
    agent_id,
    requester_id,
    chat_kind,
    conversation_id,
    person_id,
    kind,
    request,
    instruction,
    created_at
`;

function readTask(row: readonly DatabaseValue[]): StoredAgentChatTask {
  const conversationId = readNullableTextColumn(row, 4, "conversation_id");
  const personId = readNullableTextColumn(row, 5, "person_id");
  const kind = readTextColumn(row, 6, "kind");
  return {
    automationId: readTextColumn(row, 0, "automation_id"),
    agentId: readTextColumn(row, 1, "agent_id"),
    requesterId: readTextColumn(row, 2, "requester_id"),
    chat:
      conversationId === null
        ? { kind: "direct", personId: personId ?? "" }
        : { kind: "group", conversationId },
    kind: kind === "reminder" ? "reminder" : "task",
    request: readTextColumn(row, 7, "request"),
    instruction: readTextColumn(row, 8, "instruction"),
    createdAt: readTextColumn(row, 9, "created_at"),
  };
}

/** The condition and parameters that select the tasks of one chat. */
function chatFilter(
  chat: StoredAgentChatTaskChat,
  agentId: string | null,
): { readonly where: string; readonly values: Record<string, string> } {
  const agent = agentId === null ? "" : "\n    AND agent_id = $agent_id";
  const agentValue: Record<string, string> =
    agentId === null ? {} : { agent_id: agentId };
  if (chat.kind === "group")
    return {
      where: `chat_kind = 'group'\n    AND conversation_id = $conversation_id${agent}`,
      values: { conversation_id: chat.conversationId, ...agentValue },
    };
  return {
    where: `chat_kind = 'direct'\n    AND person_id = $person_id${agent}`,
    values: { person_id: chat.personId, ...agentValue },
  };
}

/**
 * Persists the bindings of scheduled tasks to their chats.
 *
 * @remarks
 * Removing a binding removes its automation in the database, and the
 * binding goes with its conversation or with the direct chat in the
 * person's list, so no task outlives its chat.
 */
export class AgentChatTaskRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Stores the binding of a new task. */
  public async insert(task: StoredAgentChatTask): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO agent_chat_tasks (
            automation_id,
            agent_id,
            requester_id,
            chat_kind,
            conversation_id,
            person_id,
            kind,
            request,
            instruction,
            created_at
        )
        VALUES (
            $automation_id,
            $agent_id,
            $requester_id,
            $chat_kind,
            $conversation_id,
            $person_id,
            $kind,
            $request,
            $instruction,
            $created_at
        );
      `,
      {
        automation_id: task.automationId,
        agent_id: task.agentId,
        requester_id: task.requesterId,
        chat_kind: task.chat.kind,
        conversation_id:
          task.chat.kind === "group" ? task.chat.conversationId : null,
        person_id: task.chat.kind === "direct" ? task.chat.personId : null,
        kind: task.kind,
        request: task.request,
        instruction: task.instruction,
        created_at: task.createdAt,
      },
    );
  }

  /** The binding of an automation; `null` for an automation of no chat. */
  public async find(automationId: string): Promise<StoredAgentChatTask | null> {
    const [row] = await this.database.query(
      `
        SELECT
            ${COLUMNS}
        FROM agent_chat_tasks
        WHERE automation_id = $automation_id;
      `,
      { automation_id: automationId },
    );
    return row ? readTask(row) : null;
  }

  /**
   * The tasks of one chat, oldest first.
   *
   * @param chat - The chat.
   * @param agentId - Only the tasks of this agent; `null` for every agent.
   */
  public async listForChat(
    chat: StoredAgentChatTaskChat,
    agentId: string | null,
  ): Promise<readonly StoredAgentChatTask[]> {
    const filter = chatFilter(chat, agentId);
    const rows = await this.database.query(
      `
        SELECT
            ${COLUMNS}
        FROM agent_chat_tasks
        WHERE ${filter.where}
        ORDER BY created_at, automation_id;
      `,
      filter.values,
    );
    return rows.map(readTask);
  }

  /** How many tasks one chat holds, of every agent. */
  public async countForChat(chat: StoredAgentChatTaskChat): Promise<number> {
    return (await this.listForChat(chat, null)).length;
  }

  /** Replaces the request and the instruction of a task. */
  public async updateTexts(
    automationId: string,
    texts: { readonly request: string; readonly instruction: string },
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_chat_tasks
        SET request = $request,
            instruction = $instruction
        WHERE automation_id = $automation_id;
      `,
      {
        automation_id: automationId,
        request: texts.request,
        instruction: texts.instruction,
      },
    );
  }

  /** Removes a task; the database removes its automation along with it. */
  public async delete(automationId: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM agent_chat_tasks
        WHERE automation_id = $automation_id;
      `,
      { automation_id: automationId },
    );
  }
}
