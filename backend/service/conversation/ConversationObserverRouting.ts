import { CONVERSATION_OBSERVER_LIMITS } from "@/definition/ConversationObserver";

import {
  observerLine,
  readRoutingAnswer,
  routingPrompt,
} from "./ConversationObserverPrompts";

import type { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { StoredGroupContext } from "@/backend/database/repositories/conversation/ConversationGroupContextRepository";
import type { ConversationAccounts } from "./ConversationDirectory";
import type { ConversationContextReader } from "./ConversationContextReader";
import type { ConversationObserverModel } from "./ConversationObserverModel";
import type {
  ObserverCandidate,
  ObserverContextBlock,
  ObserverLine,
  RoutingChoice,
} from "./ConversationObserverPrompts";

/** What one routing decision is asked for. */
export interface ConversationRoutingRequest {
  readonly conversation: { readonly id: string; readonly name: string };
  /** The judged message: a person's, or the answer of an agent. */
  readonly triggerMessageId: string;
  /** The person of the round, whose connection access the call uses. */
  readonly personId: string;
  readonly candidates: readonly ObserverCandidate[];
  readonly maximum: number;
  /** Set when the judged message is the answer of an agent. */
  readonly handoff: {
    readonly personName: string;
    readonly agentName: string;
  } | null;
  readonly accounts: ConversationAccounts;
}

/** What the routing decisions read and ask. */
export interface ConversationObserverRoutingDependencies {
  readonly messages: Pick<ConversationMessageRepository, "find" | "history">;
  readonly contexts: Pick<ConversationContextReader, "promptContext">;
  readonly model: Pick<ConversationObserverModel, "ask">;
}

/** The stored context as a prompt shows it. */
export function observerContextBlock(
  context: StoredGroupContext | null,
): ObserverContextBlock | null {
  if (context === null) return null;
  return {
    summary: context.summary,
    decisions: context.decisions,
    openItems: context.openItems,
    responsibilities: context.responsibilities,
    throughSequence: context.throughSequence,
    updatedAt: context.updatedAt,
  };
}

/**
 * Chooses the agents a message of a group needs, with one call of the
 * observer (PAGE-296).
 *
 * @remarks
 * The observer reads the bounded history of this group up to the judged
 * message, its stored context and the active agent members with ID, name,
 * username and job title, nothing else: no memory of an agent, no chat of
 * Pica, no other group. Its answer is validated strictly against the
 * candidates; anything else counts as invalid and starts nobody.
 */
export class ConversationObserverRouting {
  private readonly dependencies: ConversationObserverRoutingDependencies;

  public constructor(dependencies: ConversationObserverRoutingDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Asks the observer once.
   *
   * @returns The chosen agents, possibly none.
   * @throws {ConversationObserverError} When the observer gave no valid result.
   */
  public async choose(
    request: ConversationRoutingRequest,
  ): Promise<RoutingChoice[]> {
    const lines = await this.history(request);
    const { context } = await this.dependencies.contexts.promptContext(
      request.conversation.id,
    );
    const material = {
      groupName: request.conversation.name,
      candidates: request.candidates,
      context: observerContextBlock(context),
      lines,
      maximum: request.maximum,
      handoff: request.handoff,
    };
    const output = await this.dependencies.model.ask({
      conversationId: request.conversation.id,
      personIds: [request.personId],
      trigger: request.triggerMessageId,
      prompt: routingPrompt(material),
      material: { kind: "routing", routing: material },
    });
    return readRoutingAnswer(output, request.candidates, request.maximum);
  }

  /** The history up to the judged message, oldest first, within the fixed limits. */
  private async history(
    request: ConversationRoutingRequest,
  ): Promise<ObserverLine[]> {
    const { messages } = this.dependencies;
    const judged = await messages.find(
      request.conversation.id,
      request.triggerMessageId,
    );
    if (!judged) return [];
    const newestFirst = await messages.history(
      request.conversation.id,
      judged.sequence + 1,
      CONVERSATION_OBSERVER_LIMITS.routingContextMessages,
    );
    const lines: ObserverLine[] = [];
    let characters = 0;
    for (const message of newestFirst) {
      if (message.notice !== null) continue;
      const line = observerLine(
        message,
        request.accounts.participant(message.senderId),
        CONVERSATION_OBSERVER_LIMITS.routingContextCharacters,
      );
      characters += Array.from(line.text).length;
      // The judged message always stays; older ones drop out first.
      if (
        lines.length > 0 &&
        characters > CONVERSATION_OBSERVER_LIMITS.routingContextCharacters
      )
        break;
      lines.push(line);
    }
    return lines.reverse();
  }
}
