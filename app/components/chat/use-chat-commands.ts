import { useState } from "react";

import {
  chatApi,
  chatErrorCode,
  readChatSessionView,
  readChatSessions,
} from "@/app/lib/chat-client";

import { useChatDeletion } from "./use-chat-deletion";

import type { Dispatch, SetStateAction } from "react";

import type {
  ChatCommand,
  ChatSession,
  ChatDeletionResult,
} from "@/definition/Chat";
import type { ChatView } from "./use-chat-uploads";

/** A short confirmation the panel shows after a command. */
export type ChatNotice =
  | "newSession"
  | "switched"
  | "deleted"
  | "unknownCommand"
  | "compacted"
  | "notNeeded"
  | "compacting";

/** The own sessions a command listed, to switch to one or to delete one. */
export interface ChatPicker {
  readonly mode: "sessions" | "delete";
  readonly sessions: readonly ChatSession[];
  readonly outcome?: ChatDeletionResult;
}

/** The chat commands and what they show. */
export interface ChatCommands {
  readonly picker: ChatPicker | null;
  readonly notice: ChatNotice | null;
  readonly isDeleting: boolean;
  setNotice(notice: ChatNotice | null): void;
  run(command: Exclude<ChatCommand, "/compact">): Promise<void>;
  choose(sessionId: string): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
  closePicker(): void;
}

interface ChatCommandOptions {
  readonly setView: Dispatch<SetStateAction<ChatView>>;
  readonly setError: (code: string) => void;
}

/** Keeps the session fields of an overview; the limits stay as loaded. */
export function toChatView(view: ChatView): ChatView {
  return {
    session: view.session,
    messages: view.messages,
    pending: view.pending,
    ...(view.activity ? { activity: view.activity } : {}),
  };
}

/**
 * Lists own sessions and opens a deletion selection whose button confirms the explicit IDs.
 */
export function useChatCommands({
  setView,
  setError,
}: ChatCommandOptions): ChatCommands {
  const [picker, setPicker] = useState<ChatPicker | null>(null);
  const [notice, setNotice] = useState<ChatNotice | null>(null);
  const deletion = useChatDeletion({ setView, setPicker, setNotice, setError });

  async function run(command: Exclude<ChatCommand, "/compact">): Promise<void> {
    try {
      if (command === "/new") {
        setView(readChatSessionView((await chatApi({ intent: "new" })).view));
        setPicker(null);
        setNotice("newSession");
        return;
      }
      const result = await chatApi({ intent: "sessions" });
      setPicker({
        mode: command === "/sessions" ? "sessions" : "delete",
        sessions: readChatSessions(result.sessions),
      });
    } catch (failure: unknown) {
      setError(chatErrorCode(failure));
    }
  }

  async function choose(sessionId: string): Promise<void> {
    try {
      const result = await chatApi({ intent: "session", sessionId });
      setView(readChatSessionView(result.view));
      setPicker(null);
      setNotice("switched");
    } catch (failure: unknown) {
      setError(chatErrorCode(failure));
    }
  }

  return {
    picker,
    notice,
    setNotice,
    run,
    choose,
    ...deletion,
    closePicker: () => {
      if (!deletion.isDeleting) setPicker(null);
    },
  };
}
