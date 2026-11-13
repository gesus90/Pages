import {
  readCountColumn,
  readNullableTextColumn,
} from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";

import type { Database } from "@/backend/database/Database";
import type { ChatDecisionSettings } from "@/definition/ConversationDecision";

/**
 * Persists the one decision model setting of the instance (PAGE-317,
 * PAGE-379): the decision model and the default thresholds of the groups. It
 * holds no credentials.
 */
export class ChatDecisionSettingsRepository {
  private readonly database: Pick<Database, "query">;

  public constructor(database: Pick<Database, "query">) {
    this.database = database;
  }

  /** Reads the setting; without a stored model the selection is `null`. */
  public async read(): Promise<ChatDecisionSettings> {
    const [row] = await this.database.query(`
      SELECT
          connection_id,
          model,
          reasoning_effort,
          revision,
          answer_threshold,
          responsibility_threshold,
          second_threshold,
          max_responders
      FROM chat_decision_settings
      WHERE id = 1;
    `);
    if (!row) throw new AgentError("profile_invalid");
    const connectionId = readNullableTextColumn(row, 0, "connection_id");
    const model = readNullableTextColumn(row, 1, "model");
    return {
      selection:
        connectionId === null || model === null
          ? null
          : {
              connectionId,
              model,
              reasoningEffort: readNullableTextColumn(
                row,
                2,
                "reasoning_effort",
              ),
            },
      rules: {
        answerThreshold: readCountColumn(row, 4, "answer_threshold"),
        responsibilityThreshold: readCountColumn(
          row,
          5,
          "responsibility_threshold",
        ),
        secondThreshold: readCountColumn(row, 6, "second_threshold"),
        maximumResponders: readCountColumn(row, 7, "max_responders"),
      },
      revision: readCountColumn(row, 3, "revision"),
    };
  }

  /**
   * Replaces the model with optimistic concurrency.
   *
   * @param settings - The new setting with the revision it was read at.
   * @throws {AgentError} `profile_conflict` when the setting changed since.
   */
  public async save(settings: ChatDecisionSettings): Promise<void> {
    const rows = await this.database.query(
      `
      UPDATE chat_decision_settings
      SET connection_id = $connection_id,
          model = $model,
          reasoning_effort = $reasoning_effort,
          answer_threshold = $answer_threshold,
          responsibility_threshold = $responsibility_threshold,
          second_threshold = $second_threshold,
          max_responders = $max_responders,
          revision = revision + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
          AND revision = $revision
      RETURNING id;
    `,
      {
        connection_id: settings.selection?.connectionId ?? null,
        model: settings.selection?.model ?? null,
        reasoning_effort: settings.selection?.reasoningEffort ?? null,
        answer_threshold: settings.rules.answerThreshold,
        responsibility_threshold: settings.rules.responsibilityThreshold,
        second_threshold: settings.rules.secondThreshold,
        max_responders: settings.rules.maximumResponders,
        revision: settings.revision,
      },
    );
    if (rows.length === 0) throw new AgentError("profile_conflict");
  }
}
