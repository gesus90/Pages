import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

/** Why a stored hand-over waits for a message of a person (PAGE-349). */
export type ConversationHandoffPause = "agent_streak" | "restart";

/** One explicit @ hand-over between agents, stored before it starts. */
export interface ConversationHandoffRequest {
  readonly triggerMessageId: string;
  readonly agentId: string;
  readonly originMessageId: string;
  readonly conversationId: string;
  readonly requestedBy: string | null;
  readonly reason: string;
}

/** A new hand-over and whether it may start now or waits for a person. */
export interface NewConversationHandoff extends ConversationHandoffRequest {
  /** The person who opened the round; the round row is created on demand. */
  readonly personId: string;
  readonly state: "pending" | "paused";
  readonly pauseReason: ConversationHandoffPause | null;
  readonly createdAt: string;
}

type HandoffDatabase = Pick<Database, "query" | "execute" | "transaction">;

function toRequest(row: readonly DatabaseValue[]): ConversationHandoffRequest {
  return {
    triggerMessageId: readTextColumn(row, 0, "trigger_message_id"),
    agentId: readTextColumn(row, 1, "agent_id"),
    originMessageId: readTextColumn(row, 2, "origin_message_id"),
    conversationId: readTextColumn(row, 3, "conversation_id"),
    requestedBy: readNullableTextColumn(row, 4, "requested_by"),
    reason: readTextColumn(row, 5, "reason"),
  };
}

const REQUEST_COLUMNS = `
    trigger_message_id,
    agent_id,
    origin_message_id,
    conversation_id,
    requested_by,
    reason
`;

/**
 * Takes a stored hand-over inside the claim of its answer, so the answer and
 * the end of the request commit together (PAGE-349).
 *
 * @returns `false` when it is taken already or was never stored in that state.
 */
export async function takeHandoff(
  transaction: Pick<DatabaseTransaction, "query">,
  key: {
    readonly triggerMessageId: string;
    readonly agentId: string;
    readonly expected: "pending" | "paused";
    readonly now: string;
  },
): Promise<boolean> {
  const rows = await transaction.query(
    `
      UPDATE conversation_handoff_requests
      SET state = 'done', pause_reason = NULL, updated_at = $now
      WHERE trigger_message_id = $trigger_message_id
          AND agent_id = $agent_id
          AND state = $expected
      RETURNING agent_id;
    `,
    {
      trigger_message_id: key.triggerMessageId,
      agent_id: key.agentId,
      expected: key.expected,
      now: key.now,
    },
  );
  return rows.length > 0;
}

/**
 * The explicit @ hand-overs between agents of a group (PAGE-349).
 *
 * @remarks
 * Nothing is dropped silently: a hand-over is stored before it starts, as
 * `pending`. At the chain pause it is stored `paused` right away, and a
 * restart turns every hand-over that was stored but never began into
 * `paused`. The next message of a person starts the paused ones; the claim of
 * the answer ends the request in the same transaction, so each starts once.
 */
export class ConversationHandoffRepository {
  private readonly database: HandoffDatabase;

  public constructor(database: HandoffDatabase) {
    this.database = database;
  }

  /**
   * Stores new hand-overs once; a repeated store keeps the first state.
   *
   * @returns The hand-overs this call stored; repeated ones are left out.
   */
  public async request(
    handoffs: readonly NewConversationHandoff[],
  ): Promise<NewConversationHandoff[]> {
    if (handoffs.length === 0) return [];
    return this.database.transaction(async (transaction) => {
      const stored: NewConversationHandoff[] = [];
      for (const handoff of handoffs) {
        await transaction.execute(
          `
            INSERT INTO conversation_reply_rounds (
                origin_message_id, conversation_id, person_id, created_at
            )
            VALUES ($origin_message_id, $conversation_id, $person_id, $created_at)
            ON CONFLICT (origin_message_id) DO NOTHING;
          `,
          {
            origin_message_id: handoff.originMessageId,
            conversation_id: handoff.conversationId,
            person_id: handoff.personId,
            created_at: handoff.createdAt,
          },
        );
        const rows = await transaction.query(
          `
            INSERT INTO conversation_handoff_requests (
                trigger_message_id,
                agent_id,
                origin_message_id,
                conversation_id,
                requested_by,
                reason,
                state,
                pause_reason,
                created_at,
                updated_at
            )
            VALUES (
                $trigger_message_id,
                $agent_id,
                $origin_message_id,
                $conversation_id,
                $requested_by,
                $reason,
                $state,
                $pause_reason,
                $created_at,
                $created_at
            )
            ON CONFLICT (trigger_message_id, agent_id) DO NOTHING
            RETURNING agent_id;
          `,
          {
            trigger_message_id: handoff.triggerMessageId,
            agent_id: handoff.agentId,
            origin_message_id: handoff.originMessageId,
            conversation_id: handoff.conversationId,
            requested_by: handoff.requestedBy,
            reason: handoff.reason,
            state: handoff.state,
            pause_reason: handoff.pauseReason,
            created_at: handoff.createdAt,
          },
        );
        if (rows.length > 0) stored.push(handoff);
      }
      return stored;
    });
  }

  /** The paused hand-overs of a conversation, oldest first. */
  public async paused(
    conversationId: string,
  ): Promise<ConversationHandoffRequest[]> {
    const rows = await this.database.query(
      `
        SELECT ${REQUEST_COLUMNS}
        FROM conversation_handoff_requests
        WHERE conversation_id = $conversation_id
            AND state = 'paused'
        ORDER BY created_at, trigger_message_id, agent_id;
      `,
      { conversation_id: conversationId },
    );
    return rows.map(toRequest);
  }

  /**
   * Pauses what an earlier process stored or claimed but never began, so it
   * is not lost and does not start a wave at startup: pending requests, and
   * claimed hand-overs whose answer was still queued. Their targets become
   * `interrupted`; the next message of a person resumes them.
   *
   * @param before - The start of this process.
   * @returns The paused hand-overs.
   */
  public async pauseUnstarted(
    before: string,
  ): Promise<ConversationHandoffRequest[]> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.query(
        `
          UPDATE conversation_handoff_requests AS requests
          SET state = 'paused', pause_reason = 'restart', updated_at = $before
          WHERE requests.created_at < $before
              AND (
                  requests.state = 'pending'
                  OR (
                      requests.state = 'done'
                      AND EXISTS (
                          SELECT 1
                          FROM conversation_reply_targets AS targets
                          WHERE targets.trigger_message_id = requests.trigger_message_id
                              AND targets.agent_id = requests.agent_id
                              AND targets.state = 'queued'
                      )
                  )
              )
          RETURNING ${REQUEST_COLUMNS};
        `,
        { before },
      );
      await transaction.execute(
        `
          UPDATE conversation_reply_targets AS targets
          SET state = 'interrupted', updated_at = $before
          FROM conversation_handoff_requests AS requests
          WHERE requests.trigger_message_id = targets.trigger_message_id
              AND requests.agent_id = targets.agent_id
              AND requests.state = 'paused'
              AND targets.state = 'queued'
              AND targets.created_at < $before;
        `,
        { before },
      );
      return rows.map(toRequest);
    });
  }
}
