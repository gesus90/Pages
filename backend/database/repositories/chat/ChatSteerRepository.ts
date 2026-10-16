import { readTextColumn } from "@/backend/database/RowValue";
import { CHAT_STEER_STATUSES } from "@/definition/ChatJob";
import { readChatSelectionItems } from "@/definition/ChatJobReader";

import type { Database } from "@/backend/database/Database";
import type {
  ChatSelection,
  ChatSteer,
  ChatSteerStatus,
} from "@/definition/ChatJob";

function readStatus(input: string): ChatSteerStatus {
  const status = CHAT_STEER_STATUSES.find((entry) => entry === input);
  if (status === undefined) throw new Error("Invalid chat steer status");
  return status;
}

/**
 * Messages sent while Pica answered and the selection snapshots of messages.
 *
 * @remarks
 * Callers check the ownership of the conversation first. A selection snapshot
 * is written once and never changed; a steer only moves between statuses.
 */
export class ChatSteerRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Records a message sent while a job runs, as pending. */
  public async create(
    steer: Omit<ChatSteer, "status">,
    sessionId: string,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO chat_steers (
          message_id,
          job_id,
          session_id,
          status
      )
      VALUES (
          $message_id,
          $job_id,
          $session_id,
          'pending'
      );
    `,
      {
        message_id: steer.messageId,
        job_id: steer.jobId,
        session_id: sessionId,
      },
    );
  }

  /** Moves a steer to its next status. */
  public async update(
    messageId: string,
    status: ChatSteerStatus,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE chat_steers
      SET
          status = $status,
          updated_at = utc_now()
      WHERE message_id = $message_id;
    `,
      { message_id: messageId, status },
    );
  }

  /** Records the answer of the follow-up turn a steer got; its status stays `followUp`. */
  public async answer(
    messageId: string,
    answerMessageId: string,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE chat_steers
      SET
          answer_message_id = $answer_message_id,
          updated_at = utc_now()
      WHERE message_id = $message_id;
    `,
      { message_id: messageId, answer_message_id: answerMessageId },
    );
  }

  /** Lists the steers of a conversation. */
  public async list(sessionId: string): Promise<readonly ChatSteer[]> {
    const rows = await this.database.query(
      `
      SELECT
          message_id,
          job_id,
          status
      FROM chat_steers
      WHERE session_id = $session_id;
    `,
      { session_id: sessionId },
    );
    return rows.map((row) => ({
      messageId: readTextColumn(row, 0, "message_id"),
      jobId: readTextColumn(row, 1, "job_id"),
      status: readStatus(readTextColumn(row, 2, "status")),
    }));
  }

  /** Writes the selection snapshot of a message; there is no way to change it later. */
  public async select(
    sessionId: string,
    selection: ChatSelection,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO chat_selections (
          message_id,
          session_id,
          items
      )
      VALUES (
          $message_id,
          $session_id,
          $items
      );
    `,
      {
        message_id: selection.messageId,
        session_id: sessionId,
        items: JSON.stringify(selection.items),
      },
    );
  }

  /** Lists the selection snapshots of a conversation. */
  public async selections(
    sessionId: string,
  ): Promise<readonly ChatSelection[]> {
    const rows = await this.database.query(
      `
      SELECT
          message_id,
          items
      FROM chat_selections
      WHERE session_id = $session_id;
    `,
      { session_id: sessionId },
    );
    return rows.map((row) => ({
      messageId: readTextColumn(row, 0, "message_id"),
      items: readChatSelectionItems(
        JSON.parse(readTextColumn(row, 1, "items")),
      ),
    }));
  }
}
