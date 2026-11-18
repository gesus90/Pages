import {
  readBooleanColumn,
  readCountColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";
import type {
  ChatCardState,
  ChatLastChat,
} from "@/definition/ConversationContent";

/** Card states one person reads at most: the ones changed last. */
const CARD_STATE_LIMIT = 2_000;

/** Reading positions one person reads at most: the chats left last. */
const READING_POSITION_LIMIT = 500;

/**
 * What a person chose for the content cards of the chat and the split view
 * Collapsed or expanded per card, the width of the panel, whether the list
 * of the chat page is collapsed, the chat used last and where the person
 * stopped reading in each chat.
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
    // A person who only collapsed the list has a row without a width.
    if (!row || row[0] === null || row[0] === undefined) return null;
    return readCountColumn(row, 0, "split_width");
  }

  /** Returns whether a person collapsed the list of the chat page. */
  public async isListCollapsed(userId: string): Promise<boolean> {
    const rows = await this.database.query(
      `
        SELECT list_collapsed
        FROM chat_view_settings
        WHERE user_id = $user_id;
      `,
      { user_id: userId },
    );
    const [row] = rows;
    return row ? readBooleanColumn(row, 0, "list_collapsed") : false;
  }

  /** Stores whether a person collapsed the list of the chat page. */
  public async setListCollapsed(
    userId: string,
    isCollapsed: boolean,
    updatedAt: string,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO chat_view_settings (
            user_id,
            list_collapsed,
            updated_at
        )
        VALUES (
            $user_id,
            $list_collapsed,
            $updated_at
        )
        ON CONFLICT (user_id) DO UPDATE
        SET
            list_collapsed = EXCLUDED.list_collapsed,
            updated_at = EXCLUDED.updated_at;
      `,
      {
        user_id: userId,
        list_collapsed: isCollapsed ? 1 : 0,
        updated_at: updatedAt,
      },
    );
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

  /** Returns the chat a person used last, or `null`. */
  public async lastChat(userId: string): Promise<ChatLastChat | null> {
    const rows = await this.database.query(
      `
        SELECT
            last_chat_kind,
            last_chat_id
        FROM chat_view_settings
        WHERE user_id = $user_id;
      `,
      { user_id: userId },
    );
    const [row] = rows;
    // A person who never opened a chat has a row without one, or no row.
    if (!row || row[0] === null || row[0] === undefined) return null;
    const kind = readTextColumn(row, 0, "last_chat_kind");
    if (kind !== "group" && kind !== "participant") return null;
    return { kind, id: readTextColumn(row, 1, "last_chat_id") };
  }

  /** Stores the chat a person used last. */
  public async setLastChat(
    userId: string,
    chat: ChatLastChat,
    updatedAt: string,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO chat_view_settings (
            user_id,
            last_chat_kind,
            last_chat_id,
            updated_at
        )
        VALUES (
            $user_id,
            $last_chat_kind,
            $last_chat_id,
            $updated_at
        )
        ON CONFLICT (user_id) DO UPDATE
        SET
            last_chat_kind = EXCLUDED.last_chat_kind,
            last_chat_id = EXCLUDED.last_chat_id,
            updated_at = EXCLUDED.updated_at;
      `,
      {
        user_id: userId,
        last_chat_kind: chat.kind,
        last_chat_id: chat.id,
        updated_at: updatedAt,
      },
    );
  }

  /** Returns the message at the top of the history of each chat a person left scrolled up, by chat key. */
  public async readingPositions(
    userId: string,
  ): Promise<Record<string, string>> {
    const rows = await this.database.query(
      `
        SELECT
            chat_key,
            message_id
        FROM chat_reading_positions
        WHERE user_id = $user_id
        ORDER BY updated_at DESC
        LIMIT $limit;
      `,
      { user_id: userId, limit: READING_POSITION_LIMIT },
    );
    const positions: Record<string, string> = {};
    for (const row of rows)
      positions[readTextColumn(row, 0, "chat_key")] = readTextColumn(
        row,
        1,
        "message_id",
      );
    return positions;
  }

  /** Stores the message at the top of the history of a chat the person left scrolled up. */
  public async setReadingPosition(
    userId: string,
    position: {
      readonly chatKey: string;
      readonly messageId: string;
      readonly updatedAt: string;
    },
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO chat_reading_positions (
            user_id,
            chat_key,
            message_id,
            updated_at
        )
        VALUES (
            $user_id,
            $chat_key,
            $message_id,
            $updated_at
        )
        ON CONFLICT (user_id, chat_key) DO UPDATE
        SET
            message_id = EXCLUDED.message_id,
            updated_at = EXCLUDED.updated_at;
      `,
      {
        user_id: userId,
        chat_key: position.chatKey,
        message_id: position.messageId,
        updated_at: position.updatedAt,
      },
    );
  }

  /** Forgets where a person stopped reading in a chat, because they read it to its end. */
  public async clearReadingPosition(
    userId: string,
    chatKey: string,
  ): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM chat_reading_positions
        WHERE user_id = $user_id
            AND chat_key = $chat_key;
      `,
      { user_id: userId, chat_key: chatKey },
    );
  }
}
