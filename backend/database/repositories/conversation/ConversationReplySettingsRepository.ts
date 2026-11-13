import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import {
  CONVERSATION_DEFAULT_MAXIMUM_RESPONDERS,
  CONVERSATION_DEFAULT_REPLY_MODE,
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
 * How each group decides who answers a message without an @ (PAGE-317).
 *
 * @remarks
 * A group without a stored row has the defaults: the observer of PAGE-296,
 * no default responder and two answering agents at most.
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
            default_responder_id,
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
        defaultResponderId: null,
        maximumResponders: CONVERSATION_DEFAULT_MAXIMUM_RESPONDERS,
        ...conversationRoundLimits({}),
      };
    return {
      conversationId,
      mode: readMode(readTextColumn(row, 0, "mode")),
      defaultResponderId: readNullableTextColumn(
        row,
        1,
        "default_responder_id",
      ),
      maximumResponders: readCountColumn(row, 2, "max_responders"),
      ...conversationRoundLimits({
        automaticRepliesPerOrigin: readCountColumn(row, 3, "replies_per_round"),
      }),
    };
  }

  /** Stores the settings of a group, replacing the earlier ones. */
  public async save(change: ConversationReplySettingsChange): Promise<void> {
    const { settings } = change;
    const limits = conversationRoundLimits(settings);
    await this.database.execute(
      `
        INSERT INTO conversation_reply_settings (
            conversation_id,
            mode,
            default_responder_id,
            max_responders,
            replies_per_round,
            updated_by,
            updated_at
        )
        VALUES (
            $conversation_id,
            $mode,
            $default_responder_id,
            $max_responders,
            $replies_per_round,
            $updated_by,
            $updated_at
        )
        ON CONFLICT (conversation_id) DO UPDATE
        SET mode = EXCLUDED.mode,
            default_responder_id = EXCLUDED.default_responder_id,
            max_responders = EXCLUDED.max_responders,
            replies_per_round = EXCLUDED.replies_per_round,
            updated_by = EXCLUDED.updated_by,
            updated_at = EXCLUDED.updated_at;
      `,
      {
        conversation_id: settings.conversationId,
        mode: settings.mode,
        default_responder_id: settings.defaultResponderId,
        max_responders: settings.maximumResponders,
        replies_per_round: limits.automaticRepliesPerOrigin,
        updated_by: change.updatedBy,
        updated_at: change.updatedAt,
      },
    );
  }
}
