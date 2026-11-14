import { createInClause } from "@/backend/database/repositories/task/InClause";
import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { PagesEventOutboxRepository } from "@/backend/database/repositories/events/PagesEventOutboxRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { PagesEventRecord } from "@/backend/database/repositories/events/PagesEventOutboxRepository";
import type {
  ConversationNotice,
  ConversationTranscriptionState,
} from "@/definition/Conversation";

const MESSAGE_COLUMNS = `
    conversation_messages.id,
    conversation_messages.sequence,
    conversation_messages.conversation_id,
    conversation_messages.sender_id,
    conversation_messages.client_message_id,
    conversation_messages.text,
    conversation_messages.mentions,
    conversation_messages.created_at,
    conversation_messages.voice_storage_name,
    conversation_messages.voice_mime_type,
    conversation_messages.voice_size_bytes,
    conversation_messages.voice_duration_ms,
    conversation_messages.transcription_state,
    conversation_messages.notice`;

/** The stored audio of a voice message. */
export interface StoredConversationVoice {
  /** Name the file store gave the audio; never leaves the server. */
  readonly storageName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly durationMs: number;
  readonly transcriptionState: ConversationTranscriptionState;
}

/** A stored message with what only the server knows of it. */
export interface StoredConversationMessage {
  readonly id: string;
  readonly sequence: number;
  readonly conversationId: string;
  readonly senderId: string;
  readonly clientMessageId: string;
  readonly text: string;
  readonly mentions: readonly string[];
  readonly createdAt: string;
  readonly voice: StoredConversationVoice | null;
  /** Why an agent did not answer, for a hint in its name (PAGE-276); otherwise `null`. */
  readonly notice: ConversationNotice | null;
}

/** What a new message is stored with. */
export interface NewConversationMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly clientMessageId: string;
  readonly text: string;
  readonly mentions: readonly string[];
  readonly createdAt: string;
  readonly voice: StoredConversationVoice | null;
  readonly notice?: ConversationNotice | null;
}

const NOTICES: readonly ConversationNotice[] = [
  "agent_inactive",
  "agent_cost_limit",
  "agent_unavailable",
  "agent_failed",
  "agent_stopped",
  "round_limit",
];

/** The outcome of storing a message. */
export interface StoredMessageOutcome {
  readonly message: StoredConversationMessage;
  /** `false` when the sender sent this `clientMessageId` before. */
  readonly isNew: boolean;
}

type MessageDatabase = Pick<Database, "query" | "transaction">;

function readMentions(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readState(
  row: readonly DatabaseValue[],
): ConversationTranscriptionState {
  const state = readTextColumn(row, 12, "transcription_state");
  return state === "done" || state === "failed" ? state : "pending";
}

function readVoice(
  row: readonly DatabaseValue[],
): StoredConversationVoice | null {
  const storageName = readNullableTextColumn(row, 8, "voice_storage_name");
  if (storageName === null) return null;
  return {
    storageName,
    mimeType: readTextColumn(row, 9, "voice_mime_type"),
    sizeBytes: readCountColumn(row, 10, "voice_size_bytes"),
    durationMs: readCountColumn(row, 11, "voice_duration_ms"),
    transcriptionState: readState(row),
  };
}

function readNotice(row: readonly DatabaseValue[]): ConversationNotice | null {
  const notice = readNullableTextColumn(row, 13, "notice");
  return NOTICES.find((known) => known === notice) ?? null;
}

function toMessage(row: readonly DatabaseValue[]): StoredConversationMessage {
  return {
    id: readTextColumn(row, 0, "id"),
    sequence: readCountColumn(row, 1, "sequence"),
    conversationId: readTextColumn(row, 2, "conversation_id"),
    senderId: readTextColumn(row, 3, "sender_id"),
    clientMessageId: readTextColumn(row, 4, "client_message_id"),
    text: readTextColumn(row, 5, "text"),
    mentions: readMentions(readTextColumn(row, 6, "mentions")),
    createdAt: readTextColumn(row, 7, "created_at"),
    voice: readVoice(row),
    notice: readNotice(row),
  };
}

async function findByClientId(
  transaction: Pick<DatabaseTransaction, "query">,
  message: NewConversationMessage,
): Promise<StoredConversationMessage | null> {
  const rows = await transaction.query(
    `
      SELECT${MESSAGE_COLUMNS}
      FROM conversation_messages
      WHERE conversation_id = $conversation_id
          AND sender_id = $sender_id
          AND client_message_id = $client_message_id;
    `,
    {
      conversation_id: message.conversationId,
      sender_id: message.senderId,
      client_message_id: message.clientMessageId,
    },
  );
  const [row] = rows;
  return row ? toMessage(row) : null;
}

async function insertMessage(
  transaction: Pick<DatabaseTransaction, "query">,
  message: NewConversationMessage,
): Promise<StoredConversationMessage | null> {
  const { voice } = message;
  const rows = await transaction.query(
    `
      INSERT INTO conversation_messages (
          id,
          conversation_id,
          sender_id,
          client_message_id,
          text,
          mentions,
          created_at,
          voice_storage_name,
          voice_mime_type,
          voice_size_bytes,
          voice_duration_ms,
          transcription_state,
          notice
      )
      VALUES (
          $id,
          $conversation_id,
          $sender_id,
          $client_message_id,
          $text,
          $mentions,
          $created_at,
          $voice_storage_name,
          $voice_mime_type,
          $voice_size_bytes,
          $voice_duration_ms,
          $transcription_state,
          $notice
      )
      ON CONFLICT (conversation_id, sender_id, client_message_id) DO NOTHING
      RETURNING${MESSAGE_COLUMNS};
    `,
    {
      id: message.id,
      conversation_id: message.conversationId,
      sender_id: message.senderId,
      client_message_id: message.clientMessageId,
      text: message.text,
      mentions: JSON.stringify(message.mentions),
      created_at: message.createdAt,
      voice_storage_name: voice?.storageName ?? null,
      voice_mime_type: voice?.mimeType ?? null,
      voice_size_bytes: voice?.sizeBytes ?? null,
      voice_duration_ms: voice?.durationMs ?? null,
      transcription_state: voice?.transcriptionState ?? null,
      notice: message.notice ?? null,
    },
  );
  const [row] = rows;
  return row ? toMessage(row) : null;
}

/** Moves the activity of the conversation and the sender's read state to a new message. */
async function recordActivity(
  transaction: Pick<DatabaseTransaction, "execute">,
  message: StoredConversationMessage,
): Promise<void> {
  await transaction.execute(
    `
      UPDATE conversations
      SET last_activity_at = GREATEST(last_activity_at, $created_at)
      WHERE id = $conversation_id;
    `,
    { conversation_id: message.conversationId, created_at: message.createdAt },
  );
  await transaction.execute(
    `
      UPDATE conversation_members
      SET read_sequence = GREATEST(read_sequence, $sequence)
      WHERE conversation_id = $conversation_id
          AND user_id = $sender_id;
    `,
    {
      conversation_id: message.conversationId,
      sender_id: message.senderId,
      sequence: message.sequence,
    },
  );
}

/**
 * The messages of the conversations (PAGE-278).
 *
 * @remarks
 * A message is stored once per sender, conversation and `clientMessageId`:
 * sending it again returns the stored one. A new message moves the
 * conversation's activity and counts as read for its sender, and its live
 * event commits with it. Callers check membership before they read.
 */
export class ConversationMessageRepository {
  private readonly database: MessageDatabase;

  public constructor(database: MessageDatabase) {
    this.database = database;
  }

  /**
   * Stores a message, or returns the one the sender stored with the same `clientMessageId`.
   *
   * @param message - The new message.
   * @param event - The live event that commits with a new message.
   */
  public async insert(
    message: NewConversationMessage,
    event: PagesEventRecord,
  ): Promise<StoredMessageOutcome> {
    return this.database.transaction(async (transaction) => {
      const stored = await insertMessage(transaction, message);
      if (!stored) {
        const known = await findByClientId(transaction, message);
        if (!known) throw new Error("The repeated message is missing.");
        return { message: known, isNew: false };
      }
      await recordActivity(transaction, stored);
      await new PagesEventOutboxRepository(transaction).append(event);
      return { message: stored, isNew: true };
    });
  }

  /** Returns a message of a conversation, or `null`. */
  public async find(
    conversationId: string,
    messageId: string,
  ): Promise<StoredConversationMessage | null> {
    const rows = await this.database.query(
      `
        SELECT${MESSAGE_COLUMNS}
        FROM conversation_messages
        WHERE conversation_id = $conversation_id
            AND id = $id;
      `,
      { conversation_id: conversationId, id: messageId },
    );
    const [row] = rows;
    return row ? toMessage(row) : null;
  }

  /** Counts original content between a summary cursor and the answered message. */
  public async contextCount(
    conversationId: string,
    range: { readonly afterSequence: number; readonly throughSequence: number },
  ): Promise<number> {
    const rows = await this.database.query(
      `
        SELECT COUNT(*)
        FROM conversation_messages
        WHERE conversation_id = $conversation_id
            AND sequence > $after_sequence
            AND sequence <= $through_sequence
            AND notice IS NULL;
      `,
      {
        conversation_id: conversationId,
        after_sequence: range.afterSequence,
        through_sequence: range.throughSequence,
      },
    );
    return readCountColumn(rows[0] ?? [], 0, "context_count");
  }

  /** Returns a message by its ID alone, for the rights check of its audio. */
  public async findById(
    messageId: string,
  ): Promise<StoredConversationMessage | null> {
    const rows = await this.database.query(
      `
        SELECT${MESSAGE_COLUMNS}
        FROM conversation_messages
        WHERE id = $id;
      `,
      { id: messageId },
    );
    const [row] = rows;
    return row ? toMessage(row) : null;
  }

  /**
   * Returns messages of a conversation before a sequence, newest first.
   *
   * @param conversationId - The conversation.
   * @param beforeSequence - Only older messages; `null` for the newest.
   * @param limit - Messages returned at most.
   */
  public async history(
    conversationId: string,
    beforeSequence: number | null,
    limit: number,
  ): Promise<StoredConversationMessage[]> {
    const rows = await this.database.query(
      `
        SELECT${MESSAGE_COLUMNS}
        FROM conversation_messages
        WHERE conversation_id = $conversation_id
            AND (
                CAST($before_sequence AS BIGINT) IS NULL
                OR sequence < CAST($before_sequence AS BIGINT)
            )
        ORDER BY sequence DESC
        LIMIT $limit;
      `,
      {
        conversation_id: conversationId,
        before_sequence: beforeSequence,
        limit,
      },
    );
    return rows.map(toMessage);
  }

  /**
   * Returns the content messages of a conversation after a sequence, oldest
   * first; hints of Pages why an agent did not answer stay out (PAGE-296).
   *
   * @param conversationId - The conversation.
   * @param afterSequence - Only newer messages.
   * @param limit - Messages returned at most.
   */
  public async contentAfter(
    conversationId: string,
    afterSequence: number,
    limit: number,
  ): Promise<StoredConversationMessage[]> {
    const rows = await this.database.query(
      `
        SELECT${MESSAGE_COLUMNS}
        FROM conversation_messages
        WHERE conversation_id = $conversation_id
            AND notice IS NULL
            AND sequence > $after_sequence
        ORDER BY sequence ASC
        LIMIT $limit;
      `,
      {
        conversation_id: conversationId,
        after_sequence: afterSequence,
        limit,
      },
    );
    return rows.map(toMessage);
  }

  /** Returns the newest message of each conversation that has one. */
  public async latest(
    conversationIds: readonly string[],
  ): Promise<Map<string, StoredConversationMessage>> {
    const latest = new Map<string, StoredConversationMessage>();
    if (conversationIds.length === 0) return latest;
    const list = createInClause("conversation", conversationIds);
    const rows = await this.database.query(
      `
        SELECT DISTINCT ON (conversation_messages.conversation_id)${MESSAGE_COLUMNS}
        FROM conversation_messages
        WHERE conversation_messages.conversation_id IN (${list.placeholders})
        ORDER BY
            conversation_messages.conversation_id,
            conversation_messages.sequence DESC;
      `,
      list.parameters,
    );
    for (const row of rows) {
      const message = toMessage(row);
      latest.set(message.conversationId, message);
    }
    return latest;
  }

  /**
   * Stores the outcome of the recognition of a voice message.
   *
   * @returns The changed message, or `null` when it no longer waits for its text.
   */
  public async completeTranscription(
    messageId: string,
    outcome: {
      readonly state: "done" | "failed";
      readonly text: string;
      /** The members the recognized text mentions (PAGE-277). */
      readonly mentions: readonly string[];
    },
    event: PagesEventRecord,
  ): Promise<StoredConversationMessage | null> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query(
        `
          UPDATE conversation_messages
          SET
              transcription_state = $state,
              text = $text,
              mentions = $mentions
          WHERE id = $id
              AND transcription_state = 'pending'
          RETURNING${MESSAGE_COLUMNS};
        `,
        {
          id: messageId,
          state: outcome.state,
          text: outcome.text,
          mentions: JSON.stringify(outcome.mentions),
        },
      );
      const [row] = rows;
      if (!row) return null;
      await new PagesEventOutboxRepository(transaction).append(event);
      return toMessage(row);
    });
  }

  /**
   * Deletes a message of its sender.
   *
   * @param message - The message and the account that must have sent it.
   * @param event - The live event that commits with the deletion.
   * @returns The deleted message, or `null` when the sender has none with the ID.
   */
  public async remove(
    message: { readonly id: string; readonly senderId: string },
    event: PagesEventRecord,
  ): Promise<StoredConversationMessage | null> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query(
        `
          DELETE FROM conversation_messages
          WHERE id = $id
              AND sender_id = $sender_id
              AND notice IS NULL
          RETURNING${MESSAGE_COLUMNS};
        `,
        { id: message.id, sender_id: message.senderId },
      );
      const [row] = rows;
      if (!row) return null;
      await new PagesEventOutboxRepository(transaction).append(event);
      return toMessage(row);
    });
  }

  /** Returns the audio names the database still lists, for the sweep of the file store. */
  public async voiceStorageNames(): Promise<Set<string>> {
    const rows = await this.database.query(
      `
        SELECT voice_storage_name
        FROM conversation_messages
        WHERE voice_storage_name IS NOT NULL;
      `,
    );
    return new Set(
      rows.map((row) => readTextColumn(row, 0, "voice_storage_name")),
    );
  }
}
