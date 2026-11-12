import { CONVERSATION_OBSERVER_LIMITS } from "@/definition/ConversationObserver";
import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { ConversationNotice } from "@/definition/Conversation";
import type { ConversationReplyTrigger } from "@/definition/ConversationObserver";

/** The message of a person a round of answers belongs to. */
export interface ConversationRoundOrigin {
  readonly originMessageId: string;
  readonly conversationId: string;
  /** The person who wrote it; automatic answers keep this origin. */
  readonly personId: string;
  readonly createdAt: string;
}

/** One agent asked to answer a round. */
export interface ConversationReplyClaim extends ConversationRoundOrigin {
  readonly agentId: string;
  readonly trigger: ConversationReplyTrigger;
  readonly triggerMessageId: string;
  /** The agent that handed the round over; `null` otherwise. */
  readonly requestedBy: string | null;
  readonly reason: string;
  /** Whether the answer counts against the limit of automatic answers. */
  readonly isAutomatic: boolean;
}

/**
 * What became of a claim: the agent may answer, it was asked already, or the
 * limit of automatic answers is reached.
 */
export type ConversationClaimOutcome = "claimed" | "duplicate" | "limit";

/** Where an answer of an agent stands. */
export type ConversationTargetState =
  "queued" | "running" | "answered" | "failed" | "interrupted";

/** How a routing decision of the observer ended. */
export type ConversationRoutingState =
  "running" | "routed" | "silent" | "skipped" | "failed";

/** The round a stored answer of an agent belongs to. */
export interface ConversationReplyOrigin {
  readonly originMessageId: string;
  readonly personId: string;
  readonly agentId: string;
  readonly trigger: ConversationReplyTrigger;
}

/** A round as the next hand-over needs it. */
export interface ConversationRoundState {
  readonly personId: string;
  readonly automaticCount: number;
  /** Every agent asked in the round, answered or not. */
  readonly agentIds: readonly string[];
}

type RoundDatabase = Pick<Database, "query" | "execute" | "transaction">;

const TRIGGERS: readonly ConversationReplyTrigger[] = [
  "direct",
  "mention",
  "context",
  "handoff",
  "fallback",
];

function readTrigger(value: string): ConversationReplyTrigger {
  return TRIGGERS.find((trigger) => trigger === value) ?? "mention";
}

async function ensureRoundRow(
  transaction: Pick<DatabaseTransaction, "execute">,
  origin: ConversationRoundOrigin,
): Promise<void> {
  await transaction.execute(
    `
      INSERT INTO conversation_reply_rounds (
          origin_message_id,
          conversation_id,
          person_id,
          created_at
      )
      VALUES (
          $origin_message_id,
          $conversation_id,
          $person_id,
          $created_at
      )
      ON CONFLICT (origin_message_id) DO NOTHING;
    `,
    {
      origin_message_id: origin.originMessageId,
      conversation_id: origin.conversationId,
      person_id: origin.personId,
      created_at: origin.createdAt,
    },
  );
}

async function insertTarget(
  transaction: Pick<DatabaseTransaction, "query">,
  claim: ConversationReplyClaim,
): Promise<boolean> {
  const rows = await transaction.query(
    `
      INSERT INTO conversation_reply_targets (
          origin_message_id,
          agent_id,
          conversation_id,
          trigger,
          trigger_message_id,
          requested_by,
          reason,
          is_automatic,
          created_at,
          updated_at
      )
      VALUES (
          $origin_message_id,
          $agent_id,
          $conversation_id,
          $trigger,
          $trigger_message_id,
          $requested_by,
          $reason,
          $is_automatic,
          $created_at,
          $created_at
      )
      ON CONFLICT (origin_message_id, agent_id) DO NOTHING
      RETURNING agent_id;
    `,
    {
      origin_message_id: claim.originMessageId,
      agent_id: claim.agentId,
      conversation_id: claim.conversationId,
      trigger: claim.trigger,
      trigger_message_id: claim.triggerMessageId,
      requested_by: claim.requestedBy,
      reason: claim.reason,
      is_automatic: claim.isAutomatic,
      created_at: claim.createdAt,
    },
  );
  return rows.length > 0;
}

/**
 * The rounds of answers in conversations, their asked agents and the routing
 * decisions of the observer (PAGE-296).
 *
 * @remarks
 * Everything a loop guard needs is stored, never only held in memory: a
 * claim locks its round, so concurrent jobs, repeated events and a restart
 * can neither ask an agent twice nor exceed the limit of automatic answers.
 */
export class ConversationRoundRepository {
  private readonly database: RoundDatabase;

  public constructor(database: RoundDatabase) {
    this.database = database;
  }

  /** Stores the round of a message of a person once. */
  public async ensureRound(origin: ConversationRoundOrigin): Promise<void> {
    await ensureRoundRow(this.database, origin);
  }

  /**
   * Asks an agent to answer a round, once per agent and round.
   *
   * @returns `claimed` when the agent may answer now.
   */
  public async claim(
    claim: ConversationReplyClaim,
  ): Promise<ConversationClaimOutcome> {
    return this.database.transaction(async (transaction) => {
      await ensureRoundRow(transaction, claim);
      // The lock orders concurrent claims of one round, so the limit holds.
      const rows = await transaction.query(
        `
          SELECT automatic_count
          FROM conversation_reply_rounds
          WHERE origin_message_id = $origin_message_id
          FOR UPDATE;
        `,
        { origin_message_id: claim.originMessageId },
      );
      const [row] = rows;
      const automaticCount = row
        ? readCountColumn(row, 0, "automatic_count")
        : 0;
      const known = await transaction.query(
        `
          SELECT agent_id
          FROM conversation_reply_targets
          WHERE origin_message_id = $origin_message_id
              AND agent_id = $agent_id;
        `,
        { origin_message_id: claim.originMessageId, agent_id: claim.agentId },
      );
      if (known.length > 0) return "duplicate";
      if (
        claim.isAutomatic &&
        automaticCount >= CONVERSATION_OBSERVER_LIMITS.automaticRepliesPerOrigin
      )
        return "limit";
      if (!(await insertTarget(transaction, claim))) return "duplicate";
      if (claim.isAutomatic)
        await transaction.execute(
          `
            UPDATE conversation_reply_rounds
            SET automatic_count = automatic_count + 1
            WHERE origin_message_id = $origin_message_id;
          `,
          { origin_message_id: claim.originMessageId },
        );
      return "claimed";
    });
  }

  /** Records where the answer of an asked agent stands. */
  public async setTargetState(
    target: { readonly originMessageId: string; readonly agentId: string },
    change: {
      readonly state: ConversationTargetState;
      readonly replyMessageId?: string | null;
      readonly notice?: ConversationNotice | null;
      readonly updatedAt: string;
    },
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE conversation_reply_targets
        SET
            state = $state,
            reply_message_id = COALESCE($reply_message_id, reply_message_id),
            notice = COALESCE($notice, notice),
            updated_at = $updated_at
        WHERE origin_message_id = $origin_message_id
            AND agent_id = $agent_id;
      `,
      {
        origin_message_id: target.originMessageId,
        agent_id: target.agentId,
        state: change.state,
        reply_message_id: change.replyMessageId ?? null,
        notice: change.notice ?? null,
        updated_at: change.updatedAt,
      },
    );
  }

  /** Returns a round with every agent asked in it, or `null`. */
  public async round(
    originMessageId: string,
  ): Promise<ConversationRoundState | null> {
    const rows = await this.database.query(
      `
        SELECT
            conversation_reply_rounds.person_id,
            conversation_reply_rounds.automatic_count,
            conversation_reply_targets.agent_id
        FROM conversation_reply_rounds
        LEFT JOIN conversation_reply_targets
            ON conversation_reply_targets.origin_message_id = conversation_reply_rounds.origin_message_id
        WHERE conversation_reply_rounds.origin_message_id = $origin_message_id;
      `,
      { origin_message_id: originMessageId },
    );
    const [first] = rows;
    if (!first) return null;
    return {
      personId: readTextColumn(first, 0, "person_id"),
      automaticCount: readCountColumn(first, 1, "automatic_count"),
      agentIds: rows
        .map((row) => readNullableTextColumn(row, 2, "agent_id"))
        .filter((id): id is string => id !== null),
    };
  }

  /** Returns the round a stored answer of an agent belongs to, or `null`. */
  public async findByReply(
    replyMessageId: string,
  ): Promise<ConversationReplyOrigin | null> {
    const rows = await this.database.query(
      `
        SELECT
            conversation_reply_targets.origin_message_id,
            conversation_reply_rounds.person_id,
            conversation_reply_targets.agent_id,
            conversation_reply_targets.trigger
        FROM conversation_reply_targets
        INNER JOIN conversation_reply_rounds
            ON conversation_reply_rounds.origin_message_id = conversation_reply_targets.origin_message_id
        WHERE conversation_reply_targets.reply_message_id = $reply_message_id;
      `,
      { reply_message_id: replyMessageId },
    );
    const [row] = rows;
    if (!row) return null;
    return {
      originMessageId: readTextColumn(row, 0, "origin_message_id"),
      personId: readTextColumn(row, 1, "person_id"),
      agentId: readTextColumn(row, 2, "agent_id"),
      trigger: readTrigger(readTextColumn(row, 3, "trigger")),
    };
  }

  /**
   * Takes the one routing decision of a message.
   *
   * @returns `false` when it was taken before, by this or an earlier process.
   */
  public async claimRouting(routing: {
    readonly triggerMessageId: string;
    readonly origin: ConversationRoundOrigin;
  }): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      await ensureRoundRow(transaction, routing.origin);
      const rows = await transaction.query(
        `
          INSERT INTO conversation_observer_routings (
              trigger_message_id,
              origin_message_id,
              conversation_id,
              created_at
          )
          VALUES (
              $trigger_message_id,
              $origin_message_id,
              $conversation_id,
              $created_at
          )
          ON CONFLICT (trigger_message_id) DO NOTHING
          RETURNING trigger_message_id;
        `,
        {
          trigger_message_id: routing.triggerMessageId,
          origin_message_id: routing.origin.originMessageId,
          conversation_id: routing.origin.conversationId,
          created_at: routing.origin.createdAt,
        },
      );
      return rows.length > 0;
    });
  }

  /** Records how a routing decision ended. */
  public async finishRouting(
    triggerMessageId: string,
    outcome: {
      readonly state: Exclude<ConversationRoutingState, "running">;
      readonly selection: readonly {
        readonly agentId: string;
        readonly reason: string;
      }[];
      readonly errorCode: string | null;
      readonly finishedAt: string;
    },
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE conversation_observer_routings
        SET
            state = $state,
            selection = $selection,
            error_code = $error_code,
            finished_at = $finished_at
        WHERE trigger_message_id = $trigger_message_id;
      `,
      {
        trigger_message_id: triggerMessageId,
        state: outcome.state,
        selection: JSON.stringify(outcome.selection),
        error_code: outcome.errorCode,
        finished_at: outcome.finishedAt,
      },
    );
  }

  /**
   * Ends the answers and decisions an earlier process left open: none of
   * them is started again, so a restart causes no wave of answers.
   *
   * @param before - Only what was created before this moment.
   * @returns How many answers were marked interrupted.
   */
  public async interruptStale(before: string): Promise<number> {
    const rows = await this.database.query(
      `
        UPDATE conversation_reply_targets
        SET
            state = 'interrupted',
            updated_at = $before
        WHERE state IN ('queued', 'running')
            AND created_at < $before
        RETURNING agent_id;
      `,
      { before },
    );
    await this.database.execute(
      `
        UPDATE conversation_observer_routings
        SET
            state = 'failed',
            error_code = 'observer_interrupted',
            finished_at = $before
        WHERE state = 'running'
            AND created_at < $before;
      `,
      { before },
    );
    return rows.length;
  }
}
