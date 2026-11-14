import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { AgentChatKind } from "@/definition/AgentChatSession";
import type { AgentChatModelSetting } from "@/definition/AgentChatControl";

/** The model one agent answers with in one chat (PAGE-380). */
export interface StoredAgentChatModel extends AgentChatModelSetting {
  readonly agentId: string;
  readonly chatKind: AgentChatKind;
  /** The person of a direct chat or the conversation of a group. */
  readonly chatId: string;
}

/** The chat of a stored choice. */
export interface AgentChatModelKey {
  readonly agentId: string;
  readonly chatKind: AgentChatKind;
  readonly chatId: string;
}

const MODEL_COLUMNS = `
    agent_id,
    chat_kind,
    chat_id,
    connection_id,
    model,
    reasoning_effort`;

function toModel(row: readonly DatabaseValue[]): StoredAgentChatModel {
  return {
    agentId: readTextColumn(row, 0, "agent_id"),
    chatKind: readTextColumn(row, 1, "chat_kind") === "group" ? "group" : "direct",
    chatId: readTextColumn(row, 2, "chat_id"),
    connectionId: readTextColumn(row, 3, "connection_id"),
    model: readTextColumn(row, 4, "model"),
    reasoningEffort: readNullableTextColumn(row, 5, "reasoning_effort"),
  };
}

/**
 * The models agents answer with in single chats instead of their own
 * (PAGE-380).
 *
 * @remarks
 * A row lasts until somebody resets the choice, the agent leaves the group or
 * the group is dissolved; resting sessions and restarts of Pages keep it.
 */
export class AgentChatModelRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** The choice of one agent in one chat; `null` follows the agent's own model. */
  public async find(key: AgentChatModelKey): Promise<StoredAgentChatModel | null> {
    const [row] = await this.database.query(
      `
        SELECT${MODEL_COLUMNS}
        FROM agent_chat_models
        WHERE agent_id = $agent_id
            AND chat_kind = $chat_kind
            AND chat_id = $chat_id;
      `,
      { agent_id: key.agentId, chat_kind: key.chatKind, chat_id: key.chatId },
    );
    return row ? toModel(row) : null;
  }

  /** The choices of every agent of one chat. */
  public async forChat(
    chatKind: AgentChatKind,
    chatId: string,
  ): Promise<StoredAgentChatModel[]> {
    const rows = await this.database.query(
      `
        SELECT${MODEL_COLUMNS}
        FROM agent_chat_models
        WHERE chat_kind = $chat_kind
            AND chat_id = $chat_id
        ORDER BY agent_id;
      `,
      { chat_kind: chatKind, chat_id: chatId },
    );
    return rows.map(toModel);
  }

  /** Stores or replaces the choice of one agent in one chat. */
  public async save(
    model: StoredAgentChatModel,
    change: { readonly changedBy: string; readonly changedAt: string },
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO agent_chat_models (
            agent_id,
            chat_kind,
            chat_id,
            connection_id,
            model,
            reasoning_effort,
            changed_by,
            changed_at
        )
        VALUES (
            $agent_id,
            $chat_kind,
            $chat_id,
            $connection_id,
            $model,
            $reasoning_effort,
            $changed_by,
            $changed_at
        )
        ON CONFLICT (agent_id, chat_kind, chat_id) DO UPDATE
        SET
            connection_id = EXCLUDED.connection_id,
            model = EXCLUDED.model,
            reasoning_effort = EXCLUDED.reasoning_effort,
            changed_by = EXCLUDED.changed_by,
            changed_at = EXCLUDED.changed_at;
      `,
      {
        agent_id: model.agentId,
        chat_kind: model.chatKind,
        chat_id: model.chatId,
        connection_id: model.connectionId,
        model: model.model,
        reasoning_effort: model.reasoningEffort,
        changed_by: change.changedBy,
        changed_at: change.changedAt,
      },
    );
  }

  /** Removes the choice of one agent in one chat, so its own model applies again. */
  public async remove(key: AgentChatModelKey): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM agent_chat_models
        WHERE agent_id = $agent_id
            AND chat_kind = $chat_kind
            AND chat_id = $chat_id;
      `,
      { agent_id: key.agentId, chat_kind: key.chatKind, chat_id: key.chatId },
    );
  }

  /** Removes the choices of every agent of one chat, for a dissolved group. */
  public async removeForChat(
    chatKind: AgentChatKind,
    chatId: string,
  ): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM agent_chat_models
        WHERE chat_kind = $chat_kind
            AND chat_id = $chat_id;
      `,
      { chat_kind: chatKind, chat_id: chatId },
    );
  }
}
