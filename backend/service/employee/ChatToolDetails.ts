import { ConversationError } from "@/backend/error/ConversationError";
import { readConversationIdentifier } from "@/backend/service/conversation/ConversationReader";

import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { ConversationOversight } from "@/backend/service/conversation/ConversationOversight";
import type { ConversationReader } from "@/backend/service/conversation/ConversationReader";
import type { StoredAgentAnswer } from "@/definition/ConversationLiveAnswer";
import type { User } from "@/definition/User";
import type {
  VirtualChatMessage,
  VirtualToolDetails,
  VirtualToolUse,
} from "@/definition/VirtualChat";
import type { AgentToolCallView } from "./AgentToolCallView";

/** The address the chat page reads the details of a tool call from. */
export const CHAT_TOOL_DETAILS_PATH = "/chat-page-api/tool-details";

/** Where the messages of a history are stored: a conversation or the chat session with an agent. */
export type ToolDetailsSource =
  { readonly conversationId: string } | { readonly agentId: string };

/** The query of one request for the details of a tool call. */
export interface ToolDetailsQuery {
  readonly conversationId: string | null;
  readonly agentId: string | null;
  readonly messageId: string | null;
  readonly callId: string | null;
}

/** What reading the details of tool calls uses. */
export interface ChatToolDetailsDependencies {
  readonly store: EmployeeStore;
  readonly users: Pick<UserRepository, "findById">;
  readonly messages: Pick<ChatSessionRepository, "findMessage">;
  readonly conversations: Pick<ConversationReader, "agentAnswer">;
  readonly oversight?: Pick<ConversationOversight, "agentAnswer">;
  /** The tool calls of the jobs of an agent's chat session, for answers stored without them. */
  readonly toolCalls?: (
    agent: User,
    sessionId: string,
  ) => Promise<AgentToolCallView>;
}

function detailsUrl(
  source: ToolDetailsSource,
  messageId: string,
  callId: string,
): string {
  const query = new URLSearchParams(
    "conversationId" in source
      ? { conversation: source.conversationId }
      : { agent: source.agentId },
  );
  query.set("message", messageId);
  query.set("call", callId);
  return `${CHAT_TOOL_DETAILS_PATH}?${query.toString()}`;
}

function deferredUse(
  use: VirtualToolUse,
  source: ToolDetailsSource,
  messageId: string,
): VirtualToolUse {
  if (use.callId === undefined || use.status === "running") return use;
  if ((use.input ?? "") === "" && (use.output ?? "") === "") return use;
  return {
    name: use.name,
    detail: use.detail,
    callId: use.callId,
    ...(use.status === undefined ? {} : { status: use.status }),
    ...(use.durationMs === undefined ? {} : { durationMs: use.durationMs }),
    ...(use.isNative === true ? { isNative: true } : {}),
    ...(use.summary === undefined ? {} : { summary: use.summary }),
    detailsUrl: detailsUrl(source, messageId, use.callId),
  };
}

/**
 * Leaves the input and the result of the finished tool calls out of stored
 * messages and names the address that reads them when the person opens a call.
 * @param messages - Messages of one history.
 * @param source - Where the history is stored.
 * @returns The messages with their calls reduced; the calls of an answer still
 * running and calls without an ID keep their details.
 */
export function deferToolDetails(
  messages: readonly VirtualChatMessage[],
  source: ToolDetailsSource,
): VirtualChatMessage[] {
  return messages.map((message) =>
    message.toolUses.length === 0
      ? message
      : {
          ...message,
          toolUses: message.toolUses.map((use) =>
            deferredUse(use, source, message.id),
          ),
        },
  );
}

function fromStoredAnswer(
  answer: StoredAgentAnswer | null,
  callId: string,
): VirtualToolDetails | null {
  const tool = answer?.tools.find((entry) => entry.callId === callId);
  if (!tool) return null;
  return {
    ...(tool.input === undefined ? {} : { input: tool.input }),
    ...(tool.output === undefined ? {} : { output: tool.output }),
    detail: tool.error ?? "",
  };
}

function fromToolUse(
  use: VirtualToolUse | undefined,
): VirtualToolDetails | null {
  if (!use) return null;
  return {
    ...(use.input === undefined ? {} : { input: use.input }),
    ...(use.output === undefined ? {} : { output: use.output }),
    detail: use.detail,
  };
}

function requireText(value: string | null): string {
  if (value === null || value === "" || value.length > 200)
    throw new ConversationError("invalid");
  return value;
}

/**
 * Reads the input and the result of one tool call of a stored answer for the
 * chat page.
 * @remarks
 * The same rights apply as for reading the history: a stored conversation
 * only for its members or for a person who oversees it, a chat session only
 * for the person whose chat with the agent it is. Anything else answers
 * `not_found`, as a missing call does.
 */
export class ChatToolDetails {
  private readonly dependencies: ChatToolDetailsDependencies;

  public constructor(dependencies: ChatToolDetailsDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads the details of a call.
   * @throws {ConversationError} `invalid` for a malformed query, `not_found`
   * for a chat the person may not read or a call that does not exist.
   */
  public async read(
    person: User,
    query: ToolDetailsQuery,
  ): Promise<VirtualToolDetails> {
    const messageId = readConversationIdentifier(query.messageId);
    const callId = requireText(query.callId);
    const details =
      query.conversationId === null
        ? await this.fromChatSession(person, query.agentId, {
            messageId,
            callId,
          })
        : fromStoredAnswer(
            await this.conversationAnswer(
              person,
              readConversationIdentifier(query.conversationId),
              messageId,
            ),
            callId,
          );
    if (!details) throw new ConversationError("not_found");
    return details;
  }

  private async conversationAnswer(
    person: User,
    conversationId: string,
    messageId: string,
  ): Promise<StoredAgentAnswer | null> {
    try {
      return await this.dependencies.conversations.agentAnswer(
        person,
        conversationId,
        messageId,
      );
    } catch (error: unknown) {
      const { oversight } = this.dependencies;
      if (
        !oversight ||
        !(error instanceof ConversationError) ||
        error.code !== "not_found"
      )
        throw error;
      return oversight.agentAnswer(person, conversationId, messageId);
    }
  }

  private async fromChatSession(
    person: User,
    agentIdInput: string | null,
    target: { readonly messageId: string; readonly callId: string },
  ): Promise<VirtualToolDetails | null> {
    const agentId = readConversationIdentifier(agentIdInput);
    const conversation = await this.dependencies.store
      .conversations()
      .find(agentId, person.id, "chat");
    if (!conversation) return null;
    const message = await this.dependencies.messages.findMessage(
      conversation.sessionId,
      target.messageId,
    );
    if (!message) return null;
    if (message.agentAnswer)
      return fromStoredAnswer(message.agentAnswer, target.callId);
    const agent = await this.dependencies.users.findById(agentId);
    if (agent?.isAgent !== true || !this.dependencies.toolCalls) return null;
    const calls = await this.dependencies.toolCalls(
      agent,
      conversation.sessionId,
    );
    return fromToolUse(
      calls.byMessage[target.messageId]?.find(
        (use) => use.callId === target.callId,
      ),
    );
  }
}
