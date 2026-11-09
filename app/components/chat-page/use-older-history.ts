import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import type {
  VirtualChatHistoryPage,
  VirtualChatMessage,
} from "@/definition/VirtualChat";

/** The older messages of one history the page loaded, and whether more exist. */
interface LoadedOlder {
  readonly messages: readonly VirtualChatMessage[];
  readonly hasMore: boolean;
}

/** The older messages of the opened history and the way to load the next page. */
export interface OlderHistory {
  /** The opened history with every older page loaded so far, oldest first. */
  readonly messages: readonly VirtualChatMessage[];
  /** Whether older messages can still be loaded. */
  readonly hasMore: boolean;
  readonly isLoading: boolean;
  /** Loads the page before the oldest shown message. */
  loadOlder(): void;
}

interface HistoryAnswer {
  readonly ok: boolean;
  readonly history?: VirtualChatHistoryPage;
}

function isHistoryAnswer(value: unknown): value is HistoryAnswer {
  return typeof value === "object" && value !== null && "ok" in value;
}

/** Older pages before the stored newest page; a message both hold shows once. */
function combine(
  older: readonly VirtualChatMessage[],
  newest: readonly VirtualChatMessage[],
): VirtualChatMessage[] {
  const newestIds = new Set(newest.map((message) => message.id));
  return [...older.filter((message) => !newestIds.has(message.id)), ...newest];
}

/**
 * Loads the stored history of the opened conversation with a person or of a
 * group page by page, the newest first (PAGE-275).
 *
 * @param conversationId - The stored conversation of the opened entry;
 * `null` for an agent or before the first message.
 * @param stored - The newest page of its history the page read, oldest first.
 * @param hasStoredMore - Whether the server holds older messages than `stored`.
 * @returns The history with the loaded pages and the way to load the next one.
 */
export function useOlderHistory(
  conversationId: string | null,
  stored: readonly VirtualChatMessage[],
  hasStoredMore: boolean,
): OlderHistory {
  const [loaded, setLoaded] = useState<Readonly<Record<string, LoadedOlder>>>(
    {},
  );
  const loader = useFetcher();
  const answer: unknown = loader.data;

  useEffect(() => {
    if (!isHistoryAnswer(answer) || !answer.history) return;
    const page = answer.history;
    setLoaded((current) => ({
      ...current,
      [page.conversationId]: {
        messages: combine(
          page.messages,
          current[page.conversationId]?.messages ?? [],
        ),
        hasMore: page.hasMore,
      },
    }));
  }, [answer]);

  const own = conversationId === null ? undefined : loaded[conversationId];
  const messages = own ? combine(own.messages, stored) : stored;
  const hasMore =
    conversationId !== null && (own ? own.hasMore : hasStoredMore);

  function loadOlder(): void {
    const [oldest] = messages;
    if (!hasMore || conversationId === null || !oldest) return;
    const formData = new FormData();
    formData.set("intent", "history");
    formData.set("conversationId", conversationId);
    formData.set("beforeId", oldest.id);
    void loader.submit(formData, { method: "post" });
  }

  return {
    messages,
    hasMore,
    isLoading: loader.state !== "idle",
    loadOlder,
  };
}
