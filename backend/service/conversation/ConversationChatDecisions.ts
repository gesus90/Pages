import { ConversationObserverError } from "@/backend/error/ConversationObserverError";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import {
  CONVERSATION_DECISION_LIMITS,
  probabilityPercent,
  resolveDecisionRules,
} from "@/definition/ConversationDecision";

import { agentSpecialization } from "../employee/profile/AgentProfileText";
import { settleDecision } from "./ConversationDecisionOutcome";
import { observerLine } from "./ConversationObserverPrompts";

import type { AgentEmployeeRepository } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { ConversationDecisionRepository } from "@/backend/database/repositories/conversation/ConversationDecisionRepository";
import type { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { ConversationMessage } from "@/definition/Conversation";
import type { ConversationReplySettings } from "@/definition/ConversationDecision";
import type { User } from "@/definition/User";
import type { ChatDecisionSettingsService } from "../chat/ChatDecisionSettingsService";
import type {
  ConversationAccount,
  ConversationAccounts,
} from "./ConversationDirectory";
import type { ConversationDecisionModel } from "./ConversationDecisionModel";
import type { DecisionCandidate } from "./ConversationDecisionPrompt";
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
  /** The default thresholds of the instance, which a group follows without values of its own. */
  readonly defaults: Pick<ChatDecisionSettingsService, "rules">;
  /** The `AGENT.md` of the agents, for their specialization. */
  readonly agents: Pick<AgentEmployeeRepository, "find">;
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
  readonly trigger: "context";
  readonly reason: string;
}

/** The message of a person that named agents with @. */
export interface ConversationMentionRecord {
  readonly conversationId: string;
  readonly messageId: string;
  readonly agentIds: readonly string[];
}

/** The text the agent reads as its reason: how the model weighed the options. */
function reasonText(
  settled: SettledDecision,
  accounts: ConversationAccounts,
): string {
  const options = settled.options.map((option) => {
    const name =
      option.agentId === null
        ? "niemand"
        : (accounts.find(option.agentId)?.user.displayName ?? "—");
    return `${name} ${String(probabilityPercent(option.probability))} %`;
  });
  const expected = probabilityPercent(settled.answerProbability ?? 0);
  return `Das Decision-Modell hat dich gewählt: Antwort erwartet ${String(expected)} % · ${options.join(", ")}.`;
}

function candidatesOf(
  request: ConversationDecisionRequest,
): ConversationAccount[] {
  return request.memberIds
    .filter((id) => id !== request.message.sender.id)
    .map((id) => request.accounts.find(id))
    .filter(
      (account): account is ConversationAccount =>
        account?.user.isAgent === true && account.isAvailable,
    );
}

/**
 * Decides which agents answer a message of a person without an @ in a group
 * (PAGE-317, PAGE-379).
 *
 * @remarks
 * One call of the decision model asks two typed questions: whether the
 * message expects an answer of an agent, and which agent is meant, with every
 * agent of the group and nobody as options. The model reads the message, the
 * newest messages of the group and the specialization of each agent from its
 * `AGENT.md`, nothing else. Pages decides with the thresholds of the group;
 * the model only gives probabilities. A missing model, a failed call or an
 * invalid answer starts nobody, as in "Nur @". Every decision, also one that
 * starts nobody, is stored once per message with the model, the
 * probabilities and the outcome; it starts no agent itself.
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
    const rules = resolveDecisionRules(
      await this.dependencies.defaults.rules(),
      request.settings.overrides,
    );
    const settled = settleDecision(
      await this.ask(request, candidates),
      rules,
    );
    await this.store(request, settled);
    const reason = reasonText(settled, request.accounts);
    await rounds.finishRouting(request.message.id, {
      state: this.routingState(settled),
      selection: settled.responderIds.map((agentId) => ({ agentId, reason })),
      errorCode: settled.fallback === "none" ? null : settled.fallback,
      finishedAt: this.now(),
    });
    return settled.responderIds.map((agentId) => ({
      agentId,
      trigger: "context",
      reason,
    }));
  }

  /**
   * Stores that a person named agents with @, so the list of decisions of the
   * group shows it; the model was not asked.
   *
   * @param mention - The message and the agents it named.
   */
  public async recordMention(
    mention: ConversationMentionRecord,
  ): Promise<void> {
    await this.dependencies.decisions.record({
      messageId: mention.messageId,
      conversationId: mention.conversationId,
      outcome: "mention",
      fallback: "none",
      responderIds: mention.agentIds,
      model: null,
      answerProbability: null,
      choices: [],
      createdAt: this.now(),
    });
    this.dependencies.publisher.publish({
      type: "conversation.changed",
      id: mention.conversationId,
    });
  }

  private routingState(settled: SettledDecision): "routed" | "silent" | "failed" {
    if (settled.outcome === "unavailable") return "failed";
    return settled.outcome === "responders" ? "routed" : "silent";
  }

  /** Asks the model; any failure becomes a fallback and never stops the chat. */
  private async ask(
    request: ConversationDecisionRequest,
    candidates: readonly ConversationAccount[],
  ): Promise<DecisionInput> {
    try {
      const answer = await this.dependencies.model.ask({
        groupName: request.conversation.name,
        candidates: await this.describe(candidates),
        lines: await this.history(request),
      });
      return {
        kind: "answer",
        model: answer.model,
        probabilities: answer.probabilities,
      };
    } catch (error: unknown) {
      const isNoModel =
        error instanceof ConversationObserverError &&
        error.code === "decision_no_model";
      if (!(error instanceof ConversationObserverError))
        logCaughtError(COMPONENT, error);
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
      return {
        kind: "failure",
        fallback: isNoModel ? "no_model" : "model_failed",
      };
    }
  }

  /** The agents with their job title and the specialization their `AGENT.md` states. */
  private async describe(
    accounts: readonly ConversationAccount[],
  ): Promise<DecisionCandidate[]> {
    return Promise.all(
      accounts.map(async (account) => {
        const stored = await this.dependencies.agents.find(account.user.id);
        return {
          id: account.user.id,
          name: account.user.displayName,
          username: account.user.username,
          role: account.role,
          specialization: agentSpecialization(
            stored?.instructions ?? "",
            CONVERSATION_DECISION_LIMITS.specializationCharacters,
          ),
        };
      }),
    );
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
      model: settled.model,
      answerProbability: settled.answerProbability,
      choices: settled.options,
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
