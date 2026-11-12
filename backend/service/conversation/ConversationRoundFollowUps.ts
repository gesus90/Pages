import { randomUUID } from "node:crypto";

import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError } from "@/backend/logging/Logger";
import { CONVERSATION_OBSERVER_LIMITS } from "@/definition/ConversationObserver";

import { toConversationMessage } from "./ConversationReader";

import type { ConversationFollowUp } from "@/backend/database/repositories/conversation/ConversationFollowUpRepository";
import type { ConversationMessage } from "@/definition/Conversation";
import type { ConversationAgentRepliesDependencies } from "./ConversationAgentReplies";
import type { ConversationRound } from "./ConversationReplyRunner";

/** One bundled continuation, uniquely identified by the agent's question. */
export interface ConversationFollowUpStart {
  readonly agentId: string;
  readonly questionMessageId: string;
  readonly contextMessageIds: readonly string[];
  readonly reason: string;
}

const REQUEST =
  /\?|\b(?:bitte|please|could you|can you)\b|(?:^|[.!]\s+|@[\p{L}\p{N}._-]+\s+)(?:prüf(?:e|t)?|beurteil(?:e|t)?|bewert(?:e|et)?|klär(?:e|t)?|vergleich(?:e|t)?|schau(?:t)?|review|check|assess)\b/iu;

/** Coordinates durable batches and their timers without holding an agent session open. */
export class ConversationRoundFollowUps {
  private readonly dependencies: ConversationAgentRepliesDependencies;
  private readonly resume: (
    round: ConversationRound,
    start: ConversationFollowUpStart,
  ) => Promise<void>;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private isStopped = false;

  public constructor(
    dependencies: ConversationAgentRepliesDependencies,
    resume: (
      round: ConversationRound,
      start: ConversationFollowUpStart,
    ) => Promise<void>,
  ) {
    this.dependencies = dependencies;
    this.resume = resume;
  }

  /** Stops owned timers when this instance's event subscription is replaced. */
  public stop(): void {
    this.isStopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** Restores pending deadlines; consumed batches never run a second time. */
  public async recover(): Promise<void> {
    const pending = await this.dependencies.rounds.followUps.pending();
    for (const question of pending) {
      const round = await this.restoreRound(question);
      if (round) await this.flush(round);
    }
    for (const ended of await this.dependencies.rounds.unannouncedEnds()) {
      const round = await this.restoreRound(ended);
      if (round) await this.end(round);
    }
  }

  /** Stores a new question and collects explicitly addressed replies to earlier questions. */
  public async observe(
    round: ConversationRound,
    answer: ConversationMessage,
    mentioned: readonly string[],
  ): Promise<void> {
    const repository = this.dependencies.rounds.followUps;
    if (mentioned.length > 0 && REQUEST.test(answer.text)) {
      await repository.open({
        questionMessageId: answer.id,
        originMessageId: round.originMessageId,
        conversationId: round.conversation.id,
        agentId: answer.sender.id,
        askedAgentIds: mentioned.filter((id) => id !== answer.sender.id),
        deadlineAt: new Date(
          this.now().getTime() +
            CONVERSATION_OBSERVER_LIMITS.followUpTimeoutMilliseconds,
        ).toISOString(),
      });
    }
    await repository.record(round.originMessageId, {
      id: answer.id,
      senderId: answer.sender.id,
      mentions: mentioned,
    });
    await this.flush(round);
  }

  /** Stops the round durably and publishes one quiet, idempotent Pages notice. */
  public async end(round: ConversationRound): Promise<void> {
    const { rounds, messages, directory } = this.dependencies;
    await rounds.end(round.originMessageId, this.now().toISOString());
    const state = await rounds.round(round.originMessageId);
    const senderId = [...(state?.agentIds ?? [])].sort()[0] ?? round.person.id;
    const event = {
      type: "conversation.changed",
      id: round.conversation.id,
    } as const;
    const outcome = await messages.insert(
      {
        id: randomUUID(),
        conversationId: round.conversation.id,
        senderId,
        clientMessageId: `round-limit-${round.originMessageId}`,
        text: "Abstimmung beendet, Grenze erreicht",
        mentions: [],
        voice: null,
        notice: "round_limit",
        createdAt: this.now().toISOString(),
      },
      event,
    );
    if (!outcome.isNew) return;
    this.dependencies.publisher.publish(event);
    this.dependencies.events.publish({
      kind: "message",
      message: toConversationMessage(outcome.message, await directory.read()),
      recipientIds: round.memberIds,
    });
  }

  private async flush(round: ConversationRound): Promise<void> {
    if (this.isStopped) return;
    const repository = this.dependencies.rounds.followUps;
    const pending = await repository.pending(round.originMessageId);
    for (const question of pending) {
      const isReady = question.answers.every(
        (answer) => answer.replyMessageId !== null,
      );
      if (!isReady && question.deadlineAt > this.now().toISOString()) {
        this.schedule(round, question);
        continue;
      }
      if (
        !(await repository.consume(
          question.questionMessageId,
          this.now().toISOString(),
        ))
      )
        continue;
      const timer = this.timers.get(question.questionMessageId);
      if (timer) clearTimeout(timer);
      this.timers.delete(question.questionMessageId);
      if (!question.answers.some((answer) => answer.replyMessageId !== null))
        continue;
      const accounts = await this.dependencies.directory.read();
      const missing = question.answers
        .filter((answer) => answer.replyMessageId === null)
        .map((answer) => accounts.participant(answer.agentId).name);
      const reason =
        missing.length > 0
          ? `Die Frist für deine Rückfrage ist abgelaufen. Fehlende Antworten: ${missing.join(", ")}. Nenne diese fehlenden Antworten ausdrücklich und fasse die vorhandenen Beiträge zusammen.`
          : "Alle gefragten Agents haben auf deine Rückfrage geantwortet. Antworte einmal auf die Beiträge zusammen und führe die Abstimmung zu einem Ergebnis.";
      await this.resume(round, {
        agentId: question.agentId,
        questionMessageId: question.questionMessageId,
        contextMessageIds: await repository.context(
          round.originMessageId,
          question.questionMessageId,
        ),
        reason,
      });
    }
  }

  private schedule(
    round: ConversationRound,
    question: ConversationFollowUp,
  ): void {
    if (this.timers.has(question.questionMessageId) || this.isStopped) return;
    const milliseconds = Math.max(
      1,
      Date.parse(question.deadlineAt) - this.now().getTime(),
    );
    const timer = setTimeout(() => {
      this.timers.delete(question.questionMessageId);
      void withBackgroundDatabaseWork("conversation_follow_up", () =>
        this.flush(round),
      ).catch((error: unknown) => {
        logCaughtError("ConversationRoundFollowUps", error);
      });
    }, milliseconds);
    timer.unref();
    this.timers.set(question.questionMessageId, timer);
  }

  private async restoreRound(
    question: Pick<
      ConversationFollowUp,
      "originMessageId" | "conversationId" | "personId"
    >,
  ): Promise<ConversationRound | null> {
    const accounts = await this.dependencies.directory.read();
    const person = accounts.find(question.personId)?.user;
    if (!person) return null;
    const conversation = await this.dependencies.conversations.findForMember(
      question.conversationId,
      person.id,
    );
    if (!conversation) return null;
    const members = await this.dependencies.conversations.memberIds([
      question.conversationId,
    ]);
    return {
      originMessageId: question.originMessageId,
      conversation,
      person,
      memberIds: members.get(question.conversationId) ?? [],
    };
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}
