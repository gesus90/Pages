import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { CHAT_READ_LIMITS } from "@/definition/AgentChatSession";

import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { StoredAgentChatSession } from "@/backend/database/repositories/employee/AgentChatSessionRepository";
import type { ConversationDirectory } from "@/backend/service/conversation/ConversationDirectory";

/** One message `chat_lesen` returns. */
export interface OwnChatMessage {
  /** The number to continue from: the sequence of a group message, the position in a direct chat. */
  readonly nr: number;
  readonly from: string;
  /** ISO time the message was stored. */
  readonly at: string;
  readonly text: string;
}

/** One page of `chat_lesen`. */
export interface OwnChatPage {
  readonly messages: readonly OwnChatMessage[];
  /** The `ab` of the next page; `null` at the end of the chat. */
  readonly next: number | null;
}

/** What the reading of the own chat uses. */
export interface AgentChatReaderDependencies {
  readonly messages: Pick<ChatSessionRepository, "messages">;
  readonly conversationMessages: Pick<
    ConversationMessageRepository,
    "contentAfter"
  >;
  readonly directory: Pick<ConversationDirectory, "read">;
}

/** Reads `ab` and `limit` of `chat_lesen`; anything else counts as absent. */
function readPaging(input: unknown): { ab: number; limit: number } {
  const fields = typeof input === "object" && input !== null ? input : {};
  const ab: unknown = Reflect.get(fields, "ab");
  const limit: unknown = Reflect.get(fields, "limit");
  return {
    ab: typeof ab === "number" && Number.isSafeInteger(ab) && ab >= 0 ? ab : 0,
    limit:
      typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 1
        ? Math.min(limit, CHAT_READ_LIMITS.messages)
        : CHAT_READ_LIMITS.messages,
  };
}

function bounded(text: string): string {
  const characters = Array.from(redactCredentials(text));
  return characters.length <= CHAT_READ_LIMITS.characters
    ? characters.join("")
    : `${characters.slice(0, CHAT_READ_LIMITS.characters).join("")}\n[gekürzt]`;
}

/**
 * The tool `chat_lesen(ab)` of an agent session (PAGE-376): older or further
 * messages of the chat the session belongs to.
 *
 * @remarks
 * A session takes only the news of its chat into each round. The tool is
 * bound to the chat of its session and has no parameter that names another
 * one, so the content of a confidential chat never reaches another session
 * through it.
 */
export class AgentChatReader {
  private readonly dependencies: AgentChatReaderDependencies;

  public constructor(dependencies: AgentChatReaderDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads a page of the chat of a session.
   *
   * @param session - The session whose chat is read.
   * @param agentName - How the answers of the agent are named in a direct chat.
   * @param input - `ab` (the number after which to read) and `limit`.
   */
  public async read(
    session: Pick<StoredAgentChatSession, "sessionId" | "kind" | "chatId">,
    agentName: string,
    input: unknown,
  ): Promise<OwnChatPage> {
    const paging = readPaging(input);
    return session.kind === "group"
      ? this.readGroup(session.chatId, paging)
      : this.readDirect(session.sessionId, agentName, paging);
  }

  /** The messages of a group after a sequence; the sequence is the number. */
  private async readGroup(
    conversationId: string,
    paging: { readonly ab: number; readonly limit: number },
  ): Promise<OwnChatPage> {
    const { conversationMessages, directory } = this.dependencies;
    const [stored, accounts] = await Promise.all([
      conversationMessages.contentAfter(
        conversationId,
        paging.ab,
        paging.limit + 1,
      ),
      directory.read(),
    ]);
    const page = stored.slice(0, paging.limit);
    return {
      messages: page.map((message) => ({
        nr: message.sequence,
        from: accounts.participant(message.senderId).name,
        at: message.createdAt,
        text: bounded(message.text),
      })),
      next:
        stored.length > paging.limit ? (page.at(-1)?.sequence ?? null) : null,
    };
  }

  /** The messages of a direct chat from a position, counted from one. */
  private async readDirect(
    sessionId: string,
    agentName: string,
    paging: { readonly ab: number; readonly limit: number },
  ): Promise<OwnChatPage> {
    const transcript = await this.dependencies.messages.messages(sessionId);
    const page = transcript.slice(paging.ab, paging.ab + paging.limit);
    const end = paging.ab + page.length;
    return {
      messages: page.map((message, index) => ({
        nr: paging.ab + index + 1,
        from: message.role === "user" ? "person" : agentName,
        at: message.createdAt,
        text: bounded(message.content),
      })),
      next: end < transcript.length ? end : null,
    };
  }
}
