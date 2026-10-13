import { useEffect, useRef, useState } from "react";

import {
  chatApi,
  chatErrorCode,
  readChatReply,
  readChatSessionView,
} from "@/app/lib/chat-client";
import { createRandomUuid } from "@/app/lib/random-uuid";

import type { Dispatch, SetStateAction } from "react";
import type { ChatView } from "./use-chat-uploads";
import type { ChatTemporaryPassword } from "@/definition/AgentAdministration";
import type { ChatReply } from "@/definition/Chat";

/** Whether the input field keeps its text after a submission. */
export type ChatSubmitOutcome = "clear" | "restore";

/** The message that is being answered, shown until the answer arrives. */
export interface ChatSending {
  readonly requestId: string;
  /** The session the message went to; its answer belongs to this session only. */
  readonly sessionId: string;
  readonly text: string;
}

/** Sending a message and cancelling its answer. */
export interface ChatSender {
  readonly sending: ChatSending | null;
  readonly temporaryPasswords: readonly ChatTemporaryPassword[];
  send(text: string): Promise<ChatSubmitOutcome>;
  cancel(): void;
  dismissTemporaryPasswords(): void;
}

interface ChatSendOptions {
  readonly isOpen: boolean;
  readonly view: ChatView;
  readonly setView: Dispatch<SetStateAction<ChatView>>;
  readonly setError: (code: string) => void;
}

/** Adds the reply once, and only while the session it belongs to is open. */
function addReply(
  current: ChatView,
  reply: ChatReply,
  sessionId: string,
): ChatView {
  if (current.session?.id !== sessionId) return current;
  const added = new Set([reply.question.id, reply.answer.id]);
  return {
    session: reply.session,
    messages: [
      ...current.messages.filter(({ id }) => !added.has(id)),
      reply.question,
      reply.answer,
    ],
    pending: [],
  };
}

/**
 * Sends one message at a time with the unsent attachments.
 *
 * @remarks
 * After a failure the session is read again: a message the server already
 * stored stays in the conversation, otherwise its text returns to the input.
 * The answer and the session read again only replace the view while their own
 * session is open, so they never land in another session.
 */
export function useChatSend({
  isOpen,
  view,
  setView,
  setError,
}: ChatSendOptions): ChatSender {
  const [sending, setSending] = useState<ChatSending | null>(null);
  const [temporaryPasswords, setTemporaryPasswords] = useState<
    readonly ChatTemporaryPassword[]
  >([]);
  const abort = useRef<AbortController | null>(null);
  const openSessionId = view.session?.id;

  useEffect(() => {
    setTemporaryPasswords([]);
  }, [isOpen, openSessionId]);

  async function reload(sessionId: string, before: number): Promise<boolean> {
    try {
      const result = await chatApi({ intent: "session", sessionId });
      const fresh = readChatSessionView(result.view);
      setView((current) =>
        current.session?.id === sessionId ? fresh : current,
      );
      return fresh.messages.length > before;
    } catch {
      return false;
    }
  }

  async function send(text: string): Promise<ChatSubmitOutcome> {
    const { session } = view;
    // The ref is set at once, unlike the state, so a second submission in the same moment is refused.
    if (session === null || abort.current !== null) return "restore";
    const requestId = createRandomUuid();
    const controller = new AbortController();
    abort.current = controller;
    setSending({ requestId, sessionId: session.id, text });
    setTemporaryPasswords([]);
    try {
      const result = await chatApi(
        {
          intent: "send",
          message: {
            requestId,
            sessionId: session.id,
            text,
            attachmentIds: view.pending.map(({ id }) => id),
          },
        },
        controller.signal,
      );
      const reply = readChatReply(result.reply);
      setTemporaryPasswords(reply.temporaryPasswords ?? []);
      setView((current) => addReply(current, reply, session.id));
      return "clear";
    } catch (failure: unknown) {
      const isStored = await reload(session.id, view.messages.length);
      // Set after reading again, so the error appears together with the end of the loading state.
      setError(chatErrorCode(failure));
      return isStored ? "clear" : "restore";
    } finally {
      abort.current = null;
      setSending(null);
    }
  }

  function cancel(): void {
    if (sending === null) return;
    void chatApi({ intent: "cancel", requestId: sending.requestId }).catch(
      (failure: unknown) => setError(chatErrorCode(failure)),
    );
    abort.current?.abort();
  }

  function dismissTemporaryPasswords(): void {
    setTemporaryPasswords([]);
  }

  return {
    sending,
    send,
    cancel,
    temporaryPasswords,
    dismissTemporaryPasswords,
  };
}
