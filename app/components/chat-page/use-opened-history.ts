import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";

import { rememberOpenedChat } from "@/app/lib/chat-directory";

import type {
  VirtualChatDirectory,
  VirtualChatMessage,
} from "@/definition/VirtualChat";

/** Nothing stored yet. */
const NO_MESSAGES: readonly VirtualChatMessage[] = [];

/** The history of the opened chat as far as the page holds it. */
export interface OpenedHistory {
  /**
   * The history the current reading of the page holds; while the chat's own
   * reading is on its way, the history it showed when it was last open.
   */
  readonly messages: readonly VirtualChatMessage[];
  /** The history of the current reading only, empty while it is on its way. */
  readonly loadedMessages: readonly VirtualChatMessage[];
  /** Whether the current reading of the page holds the chat's history. */
  readonly isLoaded: boolean;
  /** Whether the history is on its way and nothing of it can show yet. */
  readonly isLoading: boolean;
}

/**
 * The history of the opened chat, read when the chat opens.
 * @remarks
 * A reading of the chat page holds only the history of the chat that opens.
 * Opening another chat notes it and reads the page again, which then holds
 * that chat's history; a chat opened before shows its last history meanwhile.
 * @param directory - The current reading of the chat page.
 * @param historyId - The ID of the opened participant or group; empty for none.
 */
export function useOpenedHistory(
  directory: VirtualChatDirectory,
  historyId: string,
): OpenedHistory {
  const { revalidate } = useRevalidator();
  const revalidateRef = useRef(revalidate);
  const [shown, setShown] = useState<
    Readonly<Record<string, readonly VirtualChatMessage[]>>
  >({});
  const isLoaded =
    historyId === "" ||
    (directory.loadedHistoryIds?.includes(historyId) ?? true);
  const loaded = isLoaded
    ? (directory.histories[historyId] ?? NO_MESSAGES)
    : undefined;
  // Keeps the last history of each chat, so opening it again shows it at once.
  if (loaded && shown[historyId] !== loaded)
    setShown({ ...shown, [historyId]: loaded });

  useEffect(() => {
    revalidateRef.current = revalidate;
  }, [revalidate]);

  useEffect(() => {
    rememberOpenedChat(historyId === "" ? null : historyId);
    if (!isLoaded) void revalidateRef.current();
  }, [historyId, isLoaded]);

  useEffect(() => () => rememberOpenedChat(null), []);

  const remembered = shown[historyId];
  return {
    messages: loaded ?? remembered ?? NO_MESSAGES,
    loadedMessages: loaded ?? NO_MESSAGES,
    isLoaded,
    isLoading: !isLoaded && remembered === undefined,
  };
}
