import { useState } from "react";

import {
  chatApi,
  chatErrorCode,
  readChatOverview,
  readChatSessionView,
  readChatSessions,
} from "@/app/lib/chat-client";

import type { Dispatch, SetStateAction } from "react";
import type { ChatCommand, ChatSession } from "@/definition/Chat";
import type { ChatView } from "./use-chat-uploads";

/** A short confirmation the panel shows after a command. */
export type ChatNotice =
  "newSession" | "switched" | "deleted" | "unknownCommand";

/** The own sessions a command listed, to switch to one or to delete one. */
export interface ChatPicker {
  readonly mode: "sessions" | "delete";
  readonly sessions: readonly ChatSession[];
}

/** The chat commands and what they show. */
export interface ChatCommands {
  readonly picker: ChatPicker | null;
  readonly notice: ChatNotice | null;
  setNotice(notice: ChatNotice | null): void;
  run(command: ChatCommand): Promise<void>;
  choose(sessionId: string): Promise<void>;
  remove(sessionId: string, confirmation: string): Promise<void>;
  closePicker(): void;
}

interface ChatCommandOptions {
  readonly view: ChatView;
  readonly setView: Dispatch<SetStateAction<ChatView>>;
  readonly setError: (code: string) => void;
}

/** Keeps the session fields of an overview; the limits stay as loaded. */
export function toChatView(view: ChatView): ChatView {
  return {
    session: view.session,
    messages: view.messages,
    pending: view.pending,
  };
}

/**
 * Runs `/new`, `/sessions` and `/delete` on the person's own sessions (T6.12.3).
 *
 * @remarks
 * `/delete` only lists the sessions; the deletion itself needs the typed
 * confirmation word and is final. Deleting the open session opens the most
 * recent remaining one, or a new one.
 */
export function useChatCommands({
  view,
  setView,
  setError,
}: ChatCommandOptions): ChatCommands {
  const [picker, setPicker] = useState<ChatPicker | null>(null);
  const [notice, setNotice] = useState<ChatNotice | null>(null);

  async function run(command: ChatCommand): Promise<void> {
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

  async function remove(
    sessionId: string,
    confirmation: string,
  ): Promise<void> {
    try {
      await chatApi({ intent: "delete", sessionId, confirmation });
      if (view.session?.id === sessionId) {
        const result = await chatApi({ intent: "open" });
        setView(toChatView(readChatOverview(result.overview)));
      }
      setPicker(null);
      setNotice("deleted");
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
    remove,
    closePicker: () => setPicker(null),
  };
}
