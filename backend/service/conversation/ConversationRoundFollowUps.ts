import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { CONVERSATION_OBSERVER_LIMITS } from "@/definition/ConversationObserver";

import { isAgentChainPaused } from "./ConversationAgentChain";

import type { ConversationFollowUp } from "@/backend/database/repositories/conversation/ConversationFollowUpRepository";
import type { ConversationMessage } from "@/definition/Conversation";
import type { ConversationAgentRepliesDependencies } from "./ConversationAgentReplies";
import type { ConversationRound } from "./ConversationReplyRunner";

/** One bundled continuation, uniquely identified by the agent's question. */
export interface ConversationFollowUpStart {
  readonly agentId: string;
  readonly questionMessageId: string;
  readonly reason: string;
}

/** The stored round of a message, as a batch or a stored hand-over refers to it. */
export interface ConversationStoredRound {
  readonly originMessageId: string;
  readonly conversationId: string;
  readonly personId: string;
}

const COMPONENT = "ConversationRoundFollowUps";

/**
 * Coordinates durable batches and their timers without holding an agent
 * session open (PAGE-337, PAGE-349).
 *
 * @remarks
 * Every explicit @ mention of other agents in an answer opens a batch for
 * its author, whatever the sentence says. The replies of the mentioned
 * agents that mention the author back are collected until all arrived or the
 * deadline passed; then the author answers once to all of them. At the chain
 * pause a ready batch waits and starts with the next message of a person.
 */
export class ConversationRoundFollowUps {
  private readonly dependencies: ConversationAgentRepliesDependencies;
  private readonly start: (
    round: ConversationRound,
    start: ConversationFollowUpStart,
  ) => Promise<void>;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private isStopped = false;

  public constructor(
    dependencies: ConversationAgentRepliesDependencies,
    start: (
      round: ConversationRound,
      start: ConversationFollowUpStart,
    ) => Promise<void>,
  ) {
    this.dependencies = dependencies;
    this.start = start;
  }

  /** Stops owned timers when this instance's event subscription is replaced. */
  public stop(): void {
    this.isStopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** Restores pending deadlines; consumed batches never run a second time. */
  public async recover(): Promise<void> {
    await this.flushStored(await this.dependencies.rounds.followUps.pending());
  }

  /** Starts the batches of a conversation that waited at the chain pause; a person wrote. */
  public async resume(conversationId: string): Promise<void> {
    await this.flushStored(
      await this.dependencies.rounds.followUps.pending({ conversationId }),
    );
  }

  /**
   * Opens a batch for every explicit @ mention of other agents and collects
   * the replies that mention an earlier questioner.
   *
   * @param mentioned - The other agent members the answer mentions with @.
   * @returns The questioners whose batch holds this answer; they get no separate hand-over.
   */
  public async observe(
    round: ConversationRound,
    answer: ConversationMessage,
    mentioned: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const repository = this.dependencies.rounds.followUps;
    const asked = mentioned.filter((id) => id !== answer.sender.id);
    if (asked.length > 0)
      await repository.open({
        questionMessageId: answer.id,
        originMessageId: round.originMessageId,
        conversationId: round.conversation.id,
        agentId: answer.sender.id,
        askedAgentIds: asked,
        deadlineAt: new Date(
          this.now().getTime() +
            CONVERSATION_OBSERVER_LIMITS.followUpTimeoutMilliseconds,
        ).toISOString(),
      });
    const bundled = await repository.record(round.originMessageId, {
      id: answer.id,
      senderId: answer.sender.id,
      mentions: asked,
    });
    await this.flush(round);
    return bundled;
  }

  /**
   * Restores the round of a stored batch or hand-over.
   *
   * @returns `null` when the person or the conversation is gone.
   */
  public async restore(
    stored: ConversationStoredRound,
  ): Promise<ConversationRound | null> {
    const accounts = await this.dependencies.directory.read();
    const person = accounts.find(stored.personId)?.user;
    if (!person) return null;
    const conversation = await this.dependencies.conversations.findForMember(
      stored.conversationId,
      person.id,
    );
    if (!conversation) return null;
    const members = await this.dependencies.conversations.memberIds([
      stored.conversationId,
    ]);
    return {
      originMessageId: stored.originMessageId,
      conversation,
      person,
      memberIds: members.get(stored.conversationId) ?? [],
    };
  }

  private async flushStored(
    pending: readonly ConversationFollowUp[],
  ): Promise<void> {
    const flushed = new Set<string>();
    for (const question of pending) {
      if (flushed.has(question.originMessageId)) continue;
      flushed.add(question.originMessageId);
      const round = await this.restore(question);
      if (round) await this.flush(round);
    }
  }

  private async flush(round: ConversationRound): Promise<void> {
    if (this.isStopped) return;
    const repository = this.dependencies.rounds.followUps;
    const pending = await repository.pending({
      originMessageId: round.originMessageId,
    });
    for (const question of pending) {
      const isReady = question.answers.every(
        (answer) => answer.replyMessageId !== null,
      );
      if (!isReady && question.deadlineAt > this.now().toISOString()) {
        this.schedule(round, question);
        continue;
      }
      const timer = this.timers.get(question.questionMessageId);
      if (timer) clearTimeout(timer);
      this.timers.delete(question.questionMessageId);
      if (!question.answers.some((answer) => answer.replyMessageId !== null)) {
        await repository.consume(
          question.questionMessageId,
          this.now().toISOString(),
        );
        continue;
      }
      const accounts = await this.dependencies.directory.read();
      if (
        await isAgentChainPaused(
          this.dependencies.messages,
          accounts,
          round.conversation.id,
        )
      ) {
        this.logPaused(round, question);
        continue;
      }
      const missing = question.answers
        .filter((answer) => answer.replyMessageId === null)
        .map((answer) => accounts.participant(answer.agentId).name);
      const reason =
        missing.length > 0
          ? `Die Frist für deine Rückfrage ist abgelaufen. Fehlende Antworten: ${missing.join(", ")}. Nenne diese fehlenden Antworten ausdrücklich und fasse die vorhandenen Beiträge zusammen.`
          : "Alle gefragten Agents haben auf deine Rückfrage geantwortet. Antworte einmal auf die Beiträge zusammen und führe die Abstimmung zu einem Ergebnis.";
      await this.start(round, {
        agentId: question.agentId,
        questionMessageId: question.questionMessageId,
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

  /** A ready batch met the chain pause: it stays stored, nothing shows in the chat. */
  private logPaused(
    round: ConversationRound,
    question: ConversationFollowUp,
  ): void {
    logEvent({
      level: "info",
      event: "conversation.agent_reply.paused",
      component: COMPONENT,
      message:
        "A bundled follow-up waits at the chain pause until a person writes.",
      metadata: {
        conversationId: round.conversation.id,
        agentId: question.agentId,
        triggerMessageId: question.questionMessageId,
        reason: "agent_streak",
      },
    });
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}
