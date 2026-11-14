import { ConversationError } from "@/backend/error/ConversationError";
import { CONVERSATION_AGENT_CONTEXT_MESSAGES } from "@/definition/Conversation";

import {
  conversationAgentMessages,
  createConversationAgentPrompt,
} from "./ConversationAgentPrompt";

import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { User } from "@/definition/User";
import type { ConversationAgentTurn } from "./ConversationAgentReplies";
import type { ConversationAgentPromptInput } from "./ConversationAgentPrompt";
import type { ConversationAccounts } from "./ConversationDirectory";
import type {
  ConversationReplyJob,
  ConversationReplyRunnerDependencies,
} from "./ConversationReplyRunner";

interface ContextRound {
  readonly job: ConversationReplyJob;
  readonly agent: User;
  readonly accounts: ConversationAccounts;
  readonly answered: StoredConversationMessage;
  readonly origin: StoredConversationMessage;
  readonly afterSequence: number | null;
  /**
   * The newest message the session of the chat received already, above zero
   * for a session that knows the chat (PAGE-376); only the news follow then.
   */
  readonly deliveredThrough: number;
}

/** Selects the bounded opening context or every unseen message of a kept session. */
export class ConversationReplyContext {
  private readonly dependencies: ConversationReplyRunnerDependencies;

  public constructor(dependencies: ConversationReplyRunnerDependencies) {
    this.dependencies = dependencies;
  }

  /** Rechecks membership and reads attachments only for the messages actually delivered. */
  public async forTurn(round: ContextRound): Promise<ConversationAgentTurn> {
    const { job, agent, accounts, answered, origin, afterSequence } = round;
    const { deliveredThrough } = round;
    const isOpening = afterSequence === null && deliveredThrough === 0;
    const { conversation } = job.round;
    const member = await this.dependencies.conversations.findForMember(
      conversation.id,
      agent.id,
    );
    if (!member) throw new ConversationError("not_found");
    const newestFirst = await this.history(round);
    const throughSequence = Math.max(
      answered.sequence,
      newestFirst[0]?.sequence ?? 0,
    );
    // The stored context is part of the opening of a chat, not of its later rounds.
    const stored =
      conversation.kind === "group" && isOpening
        ? await this.dependencies.contexts.promptContext(conversation.id)
        : null;
    const context =
      isOpening && (stored?.context?.throughSequence ?? 0) <= throughSequence
        ? (stored?.context ?? null)
        : null;
    const pendingMessages = isOpening
      ? await this.dependencies.messages.contextCount(conversation.id, {
          afterSequence: context?.throughSequence ?? 0,
          throughSequence,
        })
      : newestFirst.length;
    const input: ConversationAgentPromptInput = {
      conversation,
      agentId: agent.id,
      newestFirst,
      answeredMessage: answered,
      accounts,
      context,
      afterSequence,
      ...(deliveredThrough > 0 ? { deliveredThrough } : {}),
      pendingMessages,
      trigger: {
        kind: job.trigger,
        reason: job.reason,
        personId: job.round.person.id,
        originSequence: origin.sequence,
      },
      memberIds: job.round.memberIds,
    };
    const selected = conversationAgentMessages(input);
    const content = await this.dependencies.content.describe(selected);
    return {
      prompt: createConversationAgentPrompt({ ...input, content }),
      attachments: selected.flatMap(
        (message) => content.get(message.id)?.attachments ?? [],
      ),
      throughSequence,
    };
  }

  private async history(
    round: ContextRound,
  ): Promise<StoredConversationMessage[]> {
    const { job, afterSequence } = round;
    const messages: StoredConversationMessage[] = [];
    let beforeSequence: number | null = null;
    for (;;) {
      const page = await this.dependencies.messages.history(
        job.round.conversation.id,
        beforeSequence,
        CONVERSATION_AGENT_CONTEXT_MESSAGES,
      );
      messages.push(
        ...page.filter(
          (message) =>
            afterSequence === null || message.sequence > afterSequence,
        ),
      );
      const oldest = page.at(-1);
      if (
        afterSequence === null ||
        !oldest ||
        oldest.sequence <= afterSequence ||
        page.length < CONVERSATION_AGENT_CONTEXT_MESSAGES
      )
        return messages;
      beforeSequence = oldest.sequence;
    }
  }
}
