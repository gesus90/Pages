import {
  readCountColumn,
  readNullableCountColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { createInClause } from "@/backend/database/repositories/task/InClause";
import {
  CONVERSATION_DEFAULT_REPLY_MODE,
  CONVERSATION_NO_RULE_OVERRIDES,
  CONVERSATION_REPLY_MODES,
} from "@/definition/ConversationDecision";

import { conversationRoundLimits } from "@/definition/ConversationObserver";

import type { Database } from "@/backend/database/Database";
import type {
  ConversationReplyMode,
  ConversationReplySettings,
} from "@/definition/ConversationDecision";

/** Who changed the settings and when, stored with them. */
export interface ConversationReplySettingsChange {
  readonly settings: ConversationReplySettings;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

function readMode(value: string): ConversationReplyMode {
  return (
    CONVERSATION_REPLY_MODES.find((mode) => mode === value) ??
    CONVERSATION_DEFAULT_REPLY_MODE
  );
}

/**
 * How each group decides who answers a message without an @ (PAGE-317,
 * PAGE-379).
 *
 * @remarks
 * A group without a stored row has the default mode and follows the rules of
 * the instance; so does a stored value that is `NULL`.
 */
export class ConversationReplySettingsRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Reads the settings of a group, or its defaults. */
  public async find(
    conversationId: string,
  ): Promise<ConversationReplySettings> {
    const [row] = await this.database.query(
      `
        SELECT
            mode,
            answer_threshold,
            responsibility_threshold,
            second_threshold,
            max_responders,
            replies_per_round
        FROM conversation_reply_settings
        WHERE conversation_id = $conversation_id;
      `,
      { conversation_id: conversationId },
    );
    if (!row)
      return {
        conversationId,
        mode: CONVERSATION_DEFAULT_REPLY_MODE,
        overrides: CONVERSATION_NO_RULE_OVERRIDES,
        ...conversationRoundLimits({}),
      };
    return {
      conversationId,
      mode: readMode(readTextColumn(row, 0, "mode")),
      overrides: {
        answerThreshold: readNullableCountColumn(row, 1, "answer_threshold"),
        responsibilityThreshold: readNullableCountColumn(
          row,
          2,
          "responsibility_threshold",
        ),
        secondThreshold: readNullableCountColumn(row, 3, "second_threshold"),
        maximumResponders: readNullableCountColumn(row, 4, "max_responders"),
      },
      ...conversationRoundLimits({
        automaticRepliesPerOrigin: readCountColumn(row, 5, "replies_per_round"),
      }),
    };
  }

  /**
   * Reads the mode of several groups at once.
   *
   * @param conversationIds - The groups.
   * @returns The mode of each group that has stored settings; a group
   * missing from the map has the default mode.
   */
  public async modes(
    conversationIds: readonly string[],
  ): Promise<ReadonlyMap<string, ConversationReplyMode>> {
    const modes = new Map<string, ConversationReplyMode>();
    if (conversationIds.length === 0) return modes;
    const ids = createInClause("conversation", conversationIds);
    const rows = await this.database.query(
      `
        SELECT
            conversation_id,
            mode
        FROM conversation_reply_settings
        WHERE conversation_id IN (${ids.placeholders});
      `,
      ids.parameters,
    );
    for (const row of rows)
      modes.set(
        readTextColumn(row, 0, "conversation_id"),
        readMode(readTextColumn(row, 1, "mode")),
      );
    return modes;
  }

  /** Stores the settings of a group, replacing the earlier ones. */
  public async save(change: ConversationReplySettingsChange): Promise<void> {
    const { settings } = change;
    const { overrides } = settings;
    const limits = conversationRoundLimits(settings);
    await this.database.execute(
      `
        INSERT INTO conversation_reply_settings (
            conversation_id,
            mode,
            answer_threshold,
            responsibility_threshold,
            second_threshold,
            max_responders,
            replies_per_round,
            updated_by,
            updated_at
        )
        VALUES (
            $conversation_id,
            $mode,
            $answer_threshold,
            $responsibility_threshold,
            $second_threshold,
            $max_responders,
            $replies_per_round,
            $updated_by,
            $updated_at
        )
        ON CONFLICT (conversation_id) DO UPDATE
        SET mode = EXCLUDED.mode,
            answer_threshold = EXCLUDED.answer_threshold,
            responsibility_threshold = EXCLUDED.responsibility_threshold,
            second_threshold = EXCLUDED.second_threshold,
            max_responders = EXCLUDED.max_responders,
            replies_per_round = EXCLUDED.replies_per_round,
            updated_by = EXCLUDED.updated_by,
            updated_at = EXCLUDED.updated_at;
      `,
      {
        conversation_id: settings.conversationId,
        mode: settings.mode,
        answer_threshold: overrides.answerThreshold,
        responsibility_threshold: overrides.responsibilityThreshold,
        second_threshold: overrides.secondThreshold,
        max_responders: overrides.maximumResponders,
        replies_per_round: limits.automaticRepliesPerOrigin,
        updated_by: change.updatedBy,
        updated_at: change.updatedAt,
      },
    );
  }
}
