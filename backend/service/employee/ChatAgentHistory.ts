import { virtualAgentAnswer } from "./AgentToolCallView";
import { isShownWithAgentChat, toVirtualMessage } from "./ChatConversationView";
import { mergeByTime, type AgentHistory } from "./ChatDirectoryView";
import {
  markQueuedMessages,
  markSteeredMessages,
  queuedChatMessages,
  waitingInChat,
} from "./ChatMessageQueues";
import { deferToolDetails } from "./ChatToolDetails";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { ConversationView } from "@/backend/service/conversation/ConversationReader";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";
import type { User } from "@/definition/User";
import type { VirtualChatMessage } from "@/definition/VirtualChat";
import type { AgentToolCallView } from "./AgentToolCallView";
import type { QueuedAgentMessage } from "./AgentEmployeeSessions";
import type { AgentChatSessionService } from "./AgentChatSessionService";

/** What a job without tool calls shows. */
const NO_TOOL_CALLS: AgentToolCallView = { byMessage: {}, current: [] };

/** Messages of one history with an agent the page shows at most. */
const HISTORY_MESSAGES = 200;

/** What the history of a person with an agent reads. */
export interface ChatAgentHistoryDependencies {
  readonly store: EmployeeStore;
  readonly messages: Pick<ChatSessionRepository, "newestMessages">;
  /** Whether a job of the agent's conversation with the person runs now. */
  readonly isWorking: (agent: User, sessionId: string) => Promise<boolean>;
  /** The tool calls of the newest job of an agent's conversation. */
  readonly toolCalls?: (
    agent: User,
    sessionId: string,
  ) => Promise<AgentToolCallView>;
  /** The messages of a direct chat with an agent its running job took into its answer. */
  readonly injectedInJob?: (
    agent: User,
    sessionId: string,
  ) => Promise<ReadonlySet<string>>;
  /** The messages of a direct chat with an agent its running job holds back. */
  readonly waitingInJob?: (
    agent: User,
    sessionId: string,
  ) => Promise<ReadonlySet<string>>;
  /**
   * Adds the files the person sent in a direct chat with an agent to the
   * messages they went with; absent shows the messages without files.
   */
  readonly withFiles?: (
    agentId: string,
    sessionId: string,
    messages: readonly VirtualChatMessage[],
  ) => Promise<VirtualChatMessage[]>;
  /** The sessions of agents in the chats, for the head of the chat. */
  readonly agentSessions?: Pick<
    AgentChatSessionService,
    "directBrief" | "groupBriefs"
  >;
  /** The person's messages to an agent that wait for a free place. */
  readonly queuedAgentMessages?: (
    agentId: string,
    personId: string,
  ) => readonly QueuedAgentMessage[];
}

/** What one reading of the history with an agent covers. */
export interface AgentHistoryRequest {
  /** The direct conversation in which the agent wrote to the person. */
  readonly agentChat?: ConversationView | undefined;
  /**
   * Whether the messages are read; without them only the state the list
   * shows is read, for a chat that is not opened.
   */
  readonly withMessages: boolean;
}

/** The facts of an existing chat session with an agent one reading starts from. */
interface SessionReading {
  readonly person: User;
  readonly agent: User;
  readonly sessionId: string;
  readonly written: readonly VirtualChatMessage[];
  readonly queued: readonly VirtualChatMessage[];
  readonly accessLevel: AgentEmployeeAccess | undefined;
}

/**
 * The history of a person with an agent: the agent's chat session with the
 * messages the agent wrote to the person on its own, and what its job does now.
 */
export class ChatAgentHistories {
  private readonly dependencies: ChatAgentHistoryDependencies;

  public constructor(dependencies: ChatAgentHistoryDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads the person's history with an agent.
   * @returns The history, or `null` for a person.
   */
  public async read(
    person: User,
    agent: User,
    request: AgentHistoryRequest,
  ): Promise<AgentHistory | null> {
    if (agent.isAgent !== true) return null;
    const [conversation, employee] = await Promise.all([
      this.dependencies.store.conversations().find(agent.id, person.id, "chat"),
      this.dependencies.store.employees().find(agent.id),
    ]);
    const accessLevel = employee?.access;
    const queued = queuedChatMessages(
      this.dependencies.queuedAgentMessages?.(agent.id, person.id) ?? [],
    );
    const { agentChat } = request;
    // What the agent wrote to the person on its own joins the chat by time.
    const written =
      request.withMessages && agentChat
        ? deferToolDetails(
            agentChat.messages
              .filter((message) => isShownWithAgentChat(message, agent.id))
              .map((message) => toVirtualMessage(message, person)),
            { conversationId: agentChat.summary.id },
          )
        : [];
    if (!conversation)
      return {
        messages: request.withMessages ? [...written, ...queued] : [],
        isWorking: queued.length > 0,
        liveTools: [],
        accessLevel,
      };
    const reading = {
      person,
      agent,
      sessionId: conversation.sessionId,
      written,
      queued,
      accessLevel,
    };
    return request.withMessages
      ? this.sessionHistory(reading)
      : this.sessionState(reading);
  }

  /** What the list shows of a chat session that is not opened: its state, no messages. */
  private async sessionState(reading: SessionReading): Promise<AgentHistory> {
    const { person, agent, sessionId, queued, accessLevel } = reading;
    const [isWorking, waiting] = await Promise.all([
      this.dependencies.isWorking(agent, sessionId),
      this.dependencies.waitingInJob?.(agent, sessionId) ?? new Set<string>(),
    ]);
    const isBusy = isWorking || queued.length > 0;
    return {
      messages: [],
      isWorking: isBusy,
      liveTools: [],
      accessLevel,
      session: await this.dependencies.agentSessions?.directBrief(
        agent.id,
        person.id,
        { isWorking: isBusy, waitingMessages: waiting.size + queued.length },
      ),
    };
  }

  /** Reads the newest stored messages and the live state of an existing chat session. */
  private async sessionHistory(reading: SessionReading): Promise<AgentHistory> {
    const { person, agent, sessionId, written, queued, accessLevel } = reading;
    const [stored, isWorking, calls, waiting, injected] = await Promise.all([
      this.dependencies.messages.newestMessages(sessionId, HISTORY_MESSAGES),
      this.dependencies.isWorking(agent, sessionId),
      this.dependencies.toolCalls?.(agent, sessionId) ?? NO_TOOL_CALLS,
      this.dependencies.waitingInJob?.(agent, sessionId) ?? new Set<string>(),
      this.dependencies.injectedInJob?.(agent, sessionId) ?? new Set<string>(),
    ]);
    const history: VirtualChatMessage[] = stored.map((message) => ({
      id: message.id,
      authorId: message.role === "user" ? null : agent.id,
      content: message.content,
      ...virtualAgentAnswer(message.agentAnswer, calls.byMessage[message.id]),
      ...(written.length > 0 ? { createdAt: message.createdAt } : {}),
      ...(message.isFromPreview === true ? { isFromPreview: true } : {}),
    }));
    const messages = deferToolDetails(
      (await this.dependencies.withFiles?.(agent.id, sessionId, history)) ??
        history,
      { agentId: agent.id },
    );
    const isBusy = isWorking || queued.length > 0;
    const chat = markSteeredMessages(
      markQueuedMessages(messages, waitingInChat(messages, waiting)),
      new Map([...injected].map((id) => [id, [agent.id]] as const)),
    );
    return {
      messages: [
        ...(written.length === 0 ? chat : mergeByTime(chat, written)),
        ...queued,
      ],
      // A message waiting for a place keeps the page reading the history.
      isWorking: isBusy,
      liveTools: calls.current,
      accessLevel,
      session: await this.dependencies.agentSessions?.directBrief(
        agent.id,
        person.id,
        { isWorking: isBusy, waitingMessages: waiting.size + queued.length },
      ),
    };
  }
}
