import { vi } from "vitest";

import { AgentChatHistoryService } from "@/backend/service/conversation/AgentChatHistoryService";

import type {
  AgentChatHistoryRepository,
  HistoryFilter,
  StoredHistoryMessage,
} from "@/backend/database/repositories/conversation/AgentChatHistoryRepository";
import type { AgentHistoryCurrentChat } from "@/definition/AgentChatHistory";

/** A stored message of the direct chat of Igor with the agent, unless overridden. */
export function storedMessage(
  overrides: Partial<StoredHistoryMessage> = {},
): StoredHistoryMessage {
  return {
    source: "direct",
    chatKind: "direct",
    chatId: "igor",
    chatName: "Chat mit Igor",
    conversationId: null,
    messageId: "message-2",
    position: 2,
    senderName: "Igor",
    createdAt: "2026-10-10T08:01:00.000Z",
    text: "Wir haben entschieden: die Ruhezeit beträgt 11 Stunden.",
    ...overrides,
  };
}

/** The repository calls the service made and what it answers. */
export interface HistoryWorld {
  readonly service: AgentChatHistoryService;
  readonly search: ReturnType<
    typeof vi.fn<
      (
        agentId: string,
        current: AgentHistoryCurrentChat | null,
        filter: HistoryFilter,
      ) => Promise<StoredHistoryMessage[]>
    >
  >;
  readonly around: ReturnType<
    typeof vi.fn<AgentChatHistoryRepository["around"]>
  >;
}

/**
 * A history service over a repository that answers the prepared rows; the
 * repository decides what is visible, so the rows stand for what it found.
 */
export function historyWorld(
  options: {
    readonly found?: readonly StoredHistoryMessage[];
    readonly excerpt?: readonly StoredHistoryMessage[];
  } = {},
): HistoryWorld {
  const search = vi.fn<AgentChatHistoryRepository["search"]>(
    async (...args) => {
      const filter = args[2];
      return [...(options.found ?? [])].slice(0, filter.limit);
    },
  );
  const around = vi.fn<AgentChatHistoryRepository["around"]>(
    async (...args) => {
      const target = args[2];
      const messages = options.excerpt ?? [];
      const hit = messages.find(
        (message) => message.messageId === target.messageId,
      );
      return hit ? { hit, messages } : null;
    },
  );
  return {
    service: new AgentChatHistoryService({ history: { search, around } }),
    search,
    around,
  };
}
