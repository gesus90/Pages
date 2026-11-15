import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** A sent message of a chat whose text may hold a link (PAGE-387). */
export interface StoredLinkedMessage {
  readonly messageId: string;
  readonly senderId: string;
  readonly sentAt: string;
  readonly text: string;
}

/**
 * The messages "Medien & Dateien" reads the links of (PAGE-387).
 *
 * @remarks
 * A deleted message is gone with its row, and a dissolved group with all of
 * its messages, so neither appears. Callers check that the reader is a
 * member of the conversation now.
 */
export class ConversationMediaOverviewRepository {
  private readonly database: Pick<Database, "query">;

  public constructor(database: Pick<Database, "query">) {
    this.database = database;
  }

  /** Returns the messages of a conversation that name an address, newest first. */
  public async linkedMessages(
    conversationId: string,
  ): Promise<StoredLinkedMessage[]> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            sender_id,
            created_at,
            text
        FROM conversation_messages
        WHERE conversation_id = $conversation_id
            AND notice IS NULL
            AND text ILIKE $address_pattern
        ORDER BY sequence DESC;
      `,
      { conversation_id: conversationId, address_pattern: "%http%" },
    );
    return rows.map((row) => ({
      messageId: readTextColumn(row, 0, "id"),
      senderId: readTextColumn(row, 1, "sender_id"),
      sentAt: readTextColumn(row, 2, "created_at"),
      text: readTextColumn(row, 3, "text"),
    }));
  }
}
