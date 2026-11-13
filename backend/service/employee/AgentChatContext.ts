import {
  parseMemoryDocument,
  renderMemoryDocument,
} from "./AgentMemoryDocument";

import type {
  ChatSessionRepository,
  StoredChatMessage,
} from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { AgentConversationPurpose } from "@/backend/database/repositories/employee/AgentConversationRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { AgentMemoryChat } from "@/definition/AgentMemory";
import type { User } from "@/definition/User";
import type {
  AgentArchiveMatch,
  AgentMemoryService,
} from "./AgentMemoryService";
import type { AgentMemoryAudience } from "./AgentMemorySharing";

/**
 * The newest messages of a chat a new or restarted session gets even when a
 * summary covers them, so it never starts without the end of the chat
 * (PAGE-376).
 */
const RECENT_MESSAGES = 10;

/** The chat a job of an agent answers in. */
export interface AgentChatTarget {
  readonly agentId: string;
  /** The person of a direct chat; `null` for a run without one. */
  readonly person: User | null;
  /** The stored conversation; absent for a direct chat. */
  readonly conversationId?: string;
}

/** What a session of an agent receives about its chat (PAGE-305). */
export interface AgentChatContextBrief {
  readonly audience: AgentMemoryAudience;
  /** `MEMORY.md` with the topics the rules of sharing give this chat. */
  readonly memory: string;
  /** `DREAM.md`, loaded in every chat. */
  readonly dream: string;
  /** Archive entries related to the message, with their source. */
  readonly related: readonly AgentArchiveMatch[];
  /** The messages after the summary, the oldest first. */
  readonly history: readonly StoredChatMessage[];
  readonly summary: string | null;
}

/** A job as the context reads it: whom it answers and why. */
export interface AgentChatJob {
  readonly agent: Pick<User, "id">;
  readonly person: User | null;
  readonly purpose: AgentConversationPurpose;
  readonly conversationId?: string;
}

/** What the context reads. */
export interface AgentChatContextDependencies {
  readonly store: EmployeeStore;
  readonly messages: Pick<ChatSessionRepository, "messages">;
  readonly memory: Pick<AgentMemoryService, "share" | "related">;
}

/**
 * The chat of a job: the direct chat of its person or its stored conversation.
 *
 * @returns `null` for a run without a chat.
 */
export function chatOfTarget(target: AgentChatTarget): AgentMemoryChat | null {
  if (target.conversationId !== undefined)
    return { kind: "conversation", conversationId: target.conversationId };
  return target.person ? { kind: "person", personId: target.person.id } : null;
}

/**
 * Builds what a session of an agent knows about its chat (PAGE-305): the
 * history after the summary and at least its last messages (PAGE-376), the
 * summary itself, the topics of `MEMORY.md` and the related archive entries
 * its chat may receive.
 */
export class AgentChatContext {
  private readonly dependencies: AgentChatContextDependencies;

  public constructor(dependencies: AgentChatContextDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * The context of a job: a chat or a conversation gets its own, a run of
   * the agent's own, such as the dream run, an empty one.
   */
  public async forJob(
    job: AgentChatJob,
    input: { readonly sessionId: string; readonly message: string },
  ): Promise<AgentChatContextBrief & { readonly isChat: boolean }> {
    const isChat = job.purpose === "chat" || job.purpose === "conversation";
    const target: AgentChatTarget = {
      agentId: job.agent.id,
      person: isChat ? job.person : null,
      ...(job.purpose === "conversation" && job.conversationId !== undefined
        ? { conversationId: job.conversationId }
        : {}),
    };
    if (isChat) return { ...(await this.brief(target, input)), isChat };
    return {
      audience: await this.audience(target),
      memory: "",
      dream: "",
      related: [],
      history: [],
      summary: null,
      isChat,
    };
  }

  /** The people and the chat whose rules of sharing a session applies. */
  public async audience(target: AgentChatTarget): Promise<AgentMemoryAudience> {
    const chat = chatOfTarget(target);
    if (chat === null) return { agentId: target.agentId, chat, people: [] };
    const people =
      chat.kind === "person"
        ? [chat.personId]
        : await this.dependencies.store
            .chats()
            .conversationPeople(chat.conversationId);
    return { agentId: target.agentId, chat, people };
  }

  /**
   * Reads the context of one message of a chat.
   *
   * @param target - The chat.
   * @param input - The chat session and the message the job answers.
   */
  public async brief(
    target: AgentChatTarget,
    input: { readonly sessionId: string; readonly message: string },
  ): Promise<AgentChatContextBrief> {
    const { store, messages, memory } = this.dependencies;
    const audience = await this.audience(target);
    const [employee, transcript, stored] = await Promise.all([
      store.employees().find(target.agentId),
      messages.messages(input.sessionId),
      store.chats().summary(input.sessionId),
    ]);
    const document = parseMemoryDocument(employee?.memory ?? "");
    const entries = await memory.share(audience, document.entries);
    const boundary = stored
      ? transcript.findIndex((message) => message.id === stored.throughId)
      : -1;
    return {
      audience,
      memory: renderMemoryDocument({
        // Free text has no source; it reaches only a chat of one person.
        preamble: audience.people.length <= 1 ? document.preamble : "",
        entries,
      }),
      dream: employee?.dream ?? "",
      related: (
        await memory.related(target.agentId, input.message, audience)
      ).filter(
        // A topic already loaded with MEMORY.md is not repeated.
        (match) => !entries.some((entry) => entry.title === match.title),
      ),
      history:
        boundary < 0
          ? transcript
          : transcript.slice(
              Math.min(
                boundary + 1,
                Math.max(0, transcript.length - RECENT_MESSAGES),
              ),
            ),
      // A stale boundary never hides the transcript behind a summary.
      summary: stored && boundary >= 0 ? stored.summary : null,
    };
  }
}
