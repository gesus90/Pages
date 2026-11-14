import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** One durable question and the first addressed reply of each asked agent. */
export interface ConversationFollowUp {
  readonly questionMessageId: string;
  readonly originMessageId: string;
  readonly conversationId: string;
  readonly personId: string;
  readonly agentId: string;
  readonly deadlineAt: string;
  readonly answers: {
    readonly agentId: string;
    readonly replyMessageId: string | null;
  }[];
}

/** Stores pending questions independently of process timers. */
export class ConversationFollowUpRepository {
  private readonly database: Pick<
    Database,
    "query" | "execute" | "transaction"
  >;

  public constructor(
    database: Pick<Database, "query" | "execute" | "transaction">,
  ) {
    this.database = database;
  }

  /** Registers a question before any of the addressed agents starts answering. */
  public async open(question: {
    readonly questionMessageId: string;
    readonly originMessageId: string;
    readonly conversationId: string;
    readonly agentId: string;
    readonly askedAgentIds: readonly string[];
    readonly deadlineAt: string;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
        INSERT INTO conversation_follow_up_questions (
            question_message_id, origin_message_id, conversation_id, agent_id, deadline_at
        )
        VALUES ($question, $origin, $conversation, $agent, $deadline)
        ON CONFLICT (question_message_id) DO NOTHING;
      `,
        {
          question: question.questionMessageId,
          origin: question.originMessageId,
          conversation: question.conversationId,
          agent: question.agentId,
          deadline: question.deadlineAt,
        },
      );
      for (const agentId of question.askedAgentIds) {
        await transaction.execute(
          `
          INSERT INTO conversation_follow_up_answers (question_message_id, agent_id)
          VALUES ($question, $agent)
          ON CONFLICT (question_message_id, agent_id) DO NOTHING;
        `,
          { question: question.questionMessageId, agent: agentId },
        );
      }
    });
  }

  /**
   * Records an asked agent's later reply that explicitly mentions the
   * questioner into the questioner's open questions of the round.
   *
   * @remarks
   * The question rows are locked first, so a reply either joins a batch
   * before it is consumed or stays outside it and starts its own hand-over.
   *
   * @returns The questioners whose batch holds this reply, also on a repeated call.
   */
  public async record(
    originMessageId: string,
    answer: {
      readonly id: string;
      readonly senderId: string;
      readonly mentions: readonly string[];
    },
  ): Promise<Set<string>> {
    return this.database.transaction(async (transaction) => {
      const bundled = new Set<string>();
      for (const mentionedId of new Set(answer.mentions)) {
        if (mentionedId === answer.senderId) continue;
        await transaction.query(
          `
          SELECT question_message_id
          FROM conversation_follow_up_questions
          WHERE origin_message_id = $origin
              AND agent_id = $questioner
              AND consumed_at IS NULL
          FOR UPDATE;
        `,
          { origin: originMessageId, questioner: mentionedId },
        );
        await transaction.execute(
          `
          UPDATE conversation_follow_up_answers AS answers
          SET reply_message_id = $reply
          FROM conversation_follow_up_questions AS questions
          INNER JOIN conversation_messages AS question
              ON question.id = questions.question_message_id
          INNER JOIN conversation_messages AS reply
              ON reply.id = $reply
          WHERE answers.question_message_id = questions.question_message_id
              AND questions.origin_message_id = $origin
              AND questions.agent_id = $questioner
              AND questions.consumed_at IS NULL
              AND answers.agent_id = $sender
              AND answers.reply_message_id IS NULL
              AND reply.sequence > question.sequence;
        `,
          {
            reply: answer.id,
            origin: originMessageId,
            questioner: mentionedId,
            sender: answer.senderId,
          },
        );
        const rows = await transaction.query(
          `
          SELECT 1
          FROM conversation_follow_up_answers AS answers
          INNER JOIN conversation_follow_up_questions AS questions
              ON questions.question_message_id = answers.question_message_id
          WHERE answers.reply_message_id = $reply
              AND questions.agent_id = $questioner
          LIMIT 1;
        `,
          { reply: answer.id, questioner: mentionedId },
        );
        if (rows.length > 0) bundled.add(mentionedId);
      }
      return bundled;
    });
  }

  /** Reads pending questions after events and at startup, including their original deadline. */
  public async pending(
    filter: {
      readonly originMessageId?: string;
      readonly conversationId?: string;
    } = {},
  ): Promise<ConversationFollowUp[]> {
    const rows = await this.database.query(
      `
      SELECT
          questions.question_message_id,
          questions.origin_message_id,
          questions.conversation_id,
          rounds.person_id,
          questions.agent_id,
          questions.deadline_at,
          answers.agent_id,
          answers.reply_message_id
      FROM conversation_follow_up_questions AS questions
      INNER JOIN conversation_reply_rounds AS rounds
          ON rounds.origin_message_id = questions.origin_message_id
      INNER JOIN conversation_follow_up_answers AS answers
          ON answers.question_message_id = questions.question_message_id
      WHERE questions.consumed_at IS NULL
          AND ($origin::TEXT IS NULL OR questions.origin_message_id = $origin)
          AND ($conversation::TEXT IS NULL OR questions.conversation_id = $conversation)
      ORDER BY questions.deadline_at, questions.question_message_id, answers.agent_id;
    `,
      {
        origin: filter.originMessageId ?? null,
        conversation: filter.conversationId ?? null,
      },
    );
    const questions = new Map<string, ConversationFollowUp>();
    for (const row of rows) {
      const id = readTextColumn(row, 0, "question_message_id");
      let question = questions.get(id);
      if (!question) {
        question = {
          questionMessageId: id,
          originMessageId: readTextColumn(row, 1, "origin_message_id"),
          conversationId: readTextColumn(row, 2, "conversation_id"),
          personId: readTextColumn(row, 3, "person_id"),
          agentId: readTextColumn(row, 4, "agent_id"),
          deadlineAt: readTextColumn(row, 5, "deadline_at"),
          answers: [],
        };
        questions.set(id, question);
      }
      question.answers.push({
        agentId: readTextColumn(row, 6, "agent_id"),
        replyMessageId: readNullableTextColumn(row, 7, "reply_message_id"),
      });
    }
    return [...questions.values()];
  }

  /** Takes one completed or expired batch once, across concurrent events and restarts. */
  public async consume(
    questionMessageId: string,
    now: string,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
      UPDATE conversation_follow_up_questions AS questions
      SET consumed_at = $now
      WHERE question_message_id = $question
          AND consumed_at IS NULL
          AND (deadline_at <= $now OR NOT EXISTS (
              SELECT 1
              FROM conversation_follow_up_answers AS answers
              WHERE answers.question_message_id = questions.question_message_id
                  AND answers.reply_message_id IS NULL
          ))
      RETURNING question_message_id;
    `,
      { question: questionMessageId, now },
    );
    return rows.length > 0;
  }

  /** All stored round replies since the questioner's last message, oldest first. */
  public async context(
    originMessageId: string,
    questionMessageId: string,
  ): Promise<string[]> {
    const rows = await this.database.query(
      `
      SELECT replies.id
      FROM conversation_reply_targets AS targets
      INNER JOIN conversation_messages AS replies
          ON replies.id = targets.reply_message_id
      INNER JOIN conversation_messages AS question
          ON question.id = $question
      WHERE targets.origin_message_id = $origin
          AND replies.sequence > question.sequence
          AND replies.notice IS NULL
      ORDER BY replies.sequence;
    `,
      { origin: originMessageId, question: questionMessageId },
    );
    return rows.map((row) => readTextColumn(row, 0, "id"));
  }
}
