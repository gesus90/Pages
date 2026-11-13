import { ConversationObserverError } from "@/backend/error/ConversationObserverError";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { CONVERSATION_DECISION_LIMITS } from "@/definition/ConversationDecision";

import { readDecisionAnswer } from "./ConversationDecisionPrompt";
import { settleDecision } from "./ConversationDecisionOutcome";
import { observerLine } from "./ConversationObserverPrompts";

import type { ConversationDecisionRepository } from "@/backend/database/repositories/conversation/ConversationDecisionRepository";
import type { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { ConversationMessage } from "@/definition/Conversation";
import type { ConversationReplySettings } from "@/definition/ConversationDecision";
import type { User } from "@/definition/User";
import type {
  ConversationAccount,
  ConversationAccounts,
} from "./ConversationDirectory";
import type { ConversationDecisionModel } from "./ConversationDecisionModel";
import type {
  DecisionCandidate,
  DecisionMaterial,
} from "./ConversationDecisionPrompt";
import type {
  DecisionInput,
  SettledDecision,
} from "./ConversationDecisionOutcome";
import type { ObserverLine } from "./ConversationObserverPrompts";

const COMPONENT = "ConversationChatDecisions";

/** What the decision of a message reads and stores. */
export interface ConversationChatDecisionsDependencies {
  readonly messages: Pick<ConversationMessageRepository, "find" | "history">;
  readonly rounds: Pick<
    ConversationRoundRepository,
    "claimRouting" | "finishRouting"
  >;
  readonly decisions: Pick<ConversationDecisionRepository, "record">;
  /** The decision model; swapped for a stand-in where no real model is called. */
  readonly model: Pick<ConversationDecisionModel, "ask">;
  /** Tells the live view of this process about a change. */
  readonly publisher: { publish(event: PagesEvent): void };
  readonly now?: () => Date;
}

/** The message of a person without an @ that is to be decided. */
export interface ConversationDecisionRequest {
  readonly conversation: { readonly id: string; readonly name: string };
  readonly originMessageId: string;
  readonly person: User;
  readonly message: ConversationMessage;
  readonly memberIds: readonly string[];
  readonly settings: ConversationReplySettings;
  readonly accounts: ConversationAccounts;
}

/** The agents a decision starts, each with why. */
export interface ConversationDecisionStart {
  readonly agentId: string;
  readonly trigger: "context" | "fallback";
  readonly reason: string;
}

/** The text a fallback hands the default responder: the suggested agents with their @ names. */
function suggestionText(
  settled: SettledDecision,
  accounts: ConversationAccounts,
): string {
  const names = settled.suggestedIds
    .filter((id) => !settled.responderIds.includes(id))
    .flatMap((id) => {
      const account = accounts.find(id);
      return account
        ? [`@${account.user.username} (${account.user.displayName})`]
        : [];
    });
  return Array.from(names.join(", "))
    .slice(0, CONVERSATION_DECISION_LIMITS.reasonCharacters)
    .join("");
}

function candidatesOf(
  request: ConversationDecisionRequest,
): DecisionCandidate[] {
  return request.memberIds
    .filter((id) => id !== request.message.sender.id)
    .map((id) => request.accounts.find(id))
    .filter(
      (account): account is ConversationAccount =>
        account?.user.isAgent === true && account.isAvailable,
    )
    .map((account) => ({
      id: account.user.id,
      name: account.user.displayName,
      username: account.user.username,
      role: account.role,
    }));
}

/**
 * Decides which agents answer a message of a person without an @ in a group
 * (PAGE-317).
 *
 * @remarks
 * The decision model reads the message, the newest messages of the group
 * and the agents with their role, nothing else. Pages takes only agents that
 * are participants of the chat and at most the configured number. A missing
 * model, a failed call or an invalid answer, and a question without a chosen
 * agent, fall back to the default responder of the group, or to a hint when
 * there is none; a message that needs no answer starts nobody. The decision
 * is stored once per message and shown in the chat; it starts no agent
 * itself.
 */
export class ConversationChatDecisions {
  private readonly dependencies: ConversationChatDecisionsDependencies;

  public constructor(dependencies: ConversationChatDecisionsDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Decides once per message.
   *
   * @returns The agents to start; empty when nobody answers or the message
   * was decided before.
   */
  public async decide(
    request: ConversationDecisionRequest,
  ): Promise<ConversationDecisionStart[]> {
    const candidates = candidatesOf(request);
    if (candidates.length === 0) return [];
    const { rounds } = this.dependencies;
    const isClaimed = await rounds.claimRouting({
      triggerMessageId: request.message.id,
      origin: {
        originMessageId: request.originMessageId,
        conversationId: request.conversation.id,
        personId: request.person.id,
        createdAt: this.now(),
      },
    });
    if (!isClaimed) return [];
    const input = await this.ask(request, candidates);
    const settled = settleDecision(input, {
      candidateIds: candidates.map((candidate) => candidate.id),
      defaultResponderId: request.settings.defaultResponderId,
      maximum: 1,
    });
    await this.store(request, settled);
    await rounds.finishRouting(request.message.id, {
      state: settled.responderIds.length > 0 ? "routed" : "silent",
      selection: settled.responderIds.map((agentId) => ({
        agentId,
        reason: settled.reason,
      })),
      errorCode: settled.fallback === "none" ? null : settled.fallback,
      finishedAt: this.now(),
    });
    return this.starts(request, settled);
  }

  private starts(
    request: ConversationDecisionRequest,
    settled: SettledDecision,
  ): ConversationDecisionStart[] {
    const trigger = settled.fallback === "none" ? "context" : "fallback";
    const reason =
      settled.fallback === "none"
        ? settled.reason || "Das Entscheidungsmodell hat dich gewählt."
        : suggestionText(settled, request.accounts);
    return settled.responderIds.map((agentId) => ({
      agentId,
      trigger,
      reason,
    }));
  }

  /** Asks the model; any failure becomes a fallback and never stops the chat. */
  private async ask(
    request: ConversationDecisionRequest,
    candidates: readonly DecisionCandidate[],
  ): Promise<DecisionInput> {
    try {
      const material: DecisionMaterial = {
        groupName: request.conversation.name,
        candidates,
        lines: await this.history(request),
        maximum: 1,
      };
      const output = await this.dependencies.model.ask({
        personId: request.person.id,
        material,
      });
      return { kind: "answer", answer: readDecisionAnswer(output, candidates) };
    } catch (error: unknown) {
      const isNoModel =
        error instanceof ConversationObserverError &&
        error.code === "decision_no_model";
      if (!(error instanceof ConversationObserverError))
        logCaughtError(COMPONENT, error);
      const fallback = isNoModel ? "no_model" : "model_failed";
      logEvent({
        level: "warn",
        event: "conversation.decision.fallback",
        component: COMPONENT,
        message: "The decision model gave no usable answer.",
        metadata: {
          conversationId: request.conversation.id,
          code:
            error instanceof ConversationObserverError ? error.code : "failed",
        },
      });
      return { kind: "failure", fallback };
    }
  }

  private async store(
    request: ConversationDecisionRequest,
    settled: SettledDecision,
  ): Promise<void> {
    await this.dependencies.decisions.record({
      messageId: request.message.id,
      conversationId: request.conversation.id,
      outcome: settled.outcome,
      fallback: settled.fallback,
      responderIds: settled.responderIds,
      suggestedIds: settled.suggestedIds,
      reason: settled.reason,
      needsAnswer: settled.needsAnswer,
      createdAt: this.now(),
    });
    this.dependencies.publisher.publish({
      type: "conversation.changed",
      id: request.conversation.id,
    });
  }

  /** The newest messages up to the judged one, oldest first, within the fixed limits. */
  private async history(
    request: ConversationDecisionRequest,
  ): Promise<ObserverLine[]> {
    const { messages } = this.dependencies;
    const judged = await messages.find(
      request.conversation.id,
      request.message.id,
    );
    if (!judged) return [];
    const newestFirst = await messages.history(
      request.conversation.id,
      judged.sequence + 1,
      CONVERSATION_DECISION_LIMITS.historyMessages,
    );
    const lines: ObserverLine[] = [];
    let characters = 0;
    for (const message of newestFirst) {
      if (message.notice !== null) continue;
      const line = observerLine(
        message,
        request.accounts.participant(message.senderId),
        CONVERSATION_DECISION_LIMITS.historyCharacters,
      );
      characters += Array.from(line.text).length;
      // The judged message always stays; older ones drop out first.
      if (
        lines.length > 0 &&
        characters > CONVERSATION_DECISION_LIMITS.historyCharacters
      )
        break;
      lines.push(line);
    }
    return lines.reverse();
  }

  private now(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString();
  }
}
