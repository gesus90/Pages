import { z } from "zod";

import { readTextColumn } from "@/backend/database/RowValue";
import { isAgentProvider } from "@/definition/AgentConnection";

import type { Database } from "@/backend/database/Database";
import type { AgentAnswerModel } from "@/definition/AgentChatControl";

const STORED_MODEL = z.object({
  name: z.string(),
  provider: z.string().nullable(),
  modelId: z.string(),
  reasoningEffort: z.string().nullable(),
  isFree: z.boolean(),
});

/** Reads the JSON Pages wrote; `null` for a value it cannot read. */
function readModel(text: string): AgentAnswerModel | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A damaged value only loses the badge of one answer, never the history.
    return null;
  }
  const result = STORED_MODEL.safeParse(parsed);
  if (!result.success) return null;
  const { provider, ...model } = result.data;
  return { ...model, provider: isAgentProvider(provider) ? provider : null };
}

/**
 * The model an agent answered with, kept with the stored answer.
 * @remarks
 * A direct chat with an agent stores its answers in `chat_messages`, a group
 * in `conversation_messages`; message IDs are unique across both, so the
 * model goes to the one row that has the ID. Deleting the message deletes
 * the model with it.
 */
export class ChatAnswerModelRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Keeps the model with a stored answer.
   * @param messageId - The stored answer of a direct chat or a conversation.
   * @param model - The model of the run, from the catalog of its connection.
   */
  public async record(
    messageId: string,
    model: AgentAnswerModel,
  ): Promise<void> {
    const parameters = {
      id: messageId,
      answer_model: JSON.stringify({
        name: model.name,
        provider: model.provider,
        modelId: model.modelId,
        reasoningEffort: model.reasoningEffort,
        isFree: model.isFree,
      }),
    };
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
        UPDATE conversation_messages
        SET answer_model = $answer_model
        WHERE id = $id;
      `,
        parameters,
      );
      await transaction.execute(
        `
        UPDATE chat_messages
        SET answer_model = $answer_model
        WHERE id = $id
            AND role = 'assistant';
      `,
        parameters,
      );
    });
  }

  /**
   * Reads the models kept with the given messages.
   * @returns The model by message; messages without one are missing.
   */
  public async forMessages(
    messageIds: readonly string[],
  ): Promise<ReadonlyMap<string, AgentAnswerModel>> {
    if (messageIds.length === 0) return new Map();
    const rows = await this.database.query(
      `
        SELECT
            id,
            answer_model
        FROM conversation_messages
        WHERE id = ANY(string_to_array($ids, ','))
            AND answer_model IS NOT NULL
        UNION ALL
        SELECT
            id,
            answer_model
        FROM chat_messages
        WHERE id = ANY(string_to_array($ids, ','))
            AND answer_model IS NOT NULL;
      `,
      { ids: messageIds.join(",") },
    );
    const models = new Map<string, AgentAnswerModel>();
    for (const row of rows) {
      const model = readModel(readTextColumn(row, 1, "answer_model"));
      if (model) models.set(readTextColumn(row, 0, "id"), model);
    }
    return models;
  }
}
