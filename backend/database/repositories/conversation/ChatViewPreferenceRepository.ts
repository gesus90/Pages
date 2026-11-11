import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";
import type { ChatCardState } from "@/definition/ConversationContent";

/** Card states one person reads at most: the ones changed last. */
const CARD_STATE_LIMIT = 2_000;

/**
 * What a person chose for the content cards of the chat and the split view
 * (PAGE-298): collapsed or expanded per card, and the width of the panel.
 */
export class ChatViewPreferenceRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Returns the card states a person changed last, by card key. */
  public async cardStates(
    userId: string,
  ): Promise<Record<string, ChatCardState>> {
    const rows = await this.database.query(
      `
        SELECT
            card_key,
            state
        FROM chat_card_states
        WHERE user_id = $user_id
        ORDER BY updated_at DESC
        LIMIT $limit;
      `,
      { user_id: userId, limit: CARD_STATE_LIMIT },
    );
    const states: Record<string, ChatCardState> = {};
    for (const row of rows)
      states[readTextColumn(row, 0, "card_key")] =
        readTextColumn(row, 1, "state") === "collapsed"
          ? "collapsed"
          : "expanded";
    return states;
  }

  /** Stores the state a person chose for one card. */
  public async setCardState(
    userId: string,
    change: {
      readonly cardKey: string;
      readonly state: ChatCardState;
      readonly updatedAt: string;
    },
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO chat_card_states (
            user_id,
            card_key,
            state,
            updated_at
        )
        VALUES (
            $user_id,
            $card_key,
            $state,
            $updated_at
        )
        ON CONFLICT (user_id, card_key) DO UPDATE
        SET
            state = EXCLUDED.state,
            updated_at = EXCLUDED.updated_at;
      `,
      {
        user_id: userId,
        card_key: change.cardKey,
        state: change.state,
        updated_at: change.updatedAt,
      },
    );
  }

  /** Returns the width a person last gave the split view, or `null`. */
  public async splitWidth(userId: string): Promise<number | null> {
    const rows = await this.database.query(
      `
        SELECT split_width
        FROM chat_view_settings
        WHERE user_id = $user_id;
      `,
      { user_id: userId },
    );
    const [row] = rows;
    return row ? readCountColumn(row, 0, "split_width") : null;
  }

  /** Stores the width a person gave the split view. */
  public async setSplitWidth(
    userId: string,
    width: number,
    updatedAt: string,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO chat_view_settings (
            user_id,
            split_width,
            updated_at
        )
        VALUES (
            $user_id,
            $split_width,
            $updated_at
        )
        ON CONFLICT (user_id) DO UPDATE
        SET
            split_width = EXCLUDED.split_width,
            updated_at = EXCLUDED.updated_at;
      `,
      { user_id: userId, split_width: width, updated_at: updatedAt },
    );
  }
}
