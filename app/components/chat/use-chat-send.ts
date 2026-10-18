import { useEffect, useRef, useState } from "react";

import {
  chatApi,
  chatErrorCode,
  readChatSessionView,
} from "@/app/lib/chat-client";
import { readChatSendResult } from "@/app/lib/chat-job-client";
import { createRandomUuid } from "@/app/lib/random-uuid";

import { applyChatSessionRead } from "./use-chat-uploads";

import type { Dispatch, SetStateAction } from "react";
import type { ChatView } from "./use-chat-uploads";
import type { ChatTemporaryPassword } from "@/definition/AgentAdministration";
import type { ChatReply } from "@/definition/Chat";
import type { ChatJob } from "@/definition/ChatJob";

/** Whether the input field keeps its text after a submission. */
export type ChatSubmitOutcome = "clear" | "restore";

/** The message that is being answered, shown until the answer arrives. */
export interface ChatSending {
  readonly requestId: string;
  /** Wall-clock start retained while the panel is hidden or the session refreshes. */
  readonly startedAt: number;
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
  /** Follows a job a Codex agent started for the message (PAGE-68). */
  readonly onJob: (job: ChatJob) => void;
  /** Reads the conversation again, after the server stored a message. */
  readonly refresh: (sessionId: string) => Promise<void>;
}

/** A message whose sending is not confirmed; sent again unchanged, it keeps its ID. */
interface UnconfirmedMessage {
  /** Session, text and attachments of the message. */
  readonly key: string;
  readonly clientMessageId: string;
}

/** Client message IDs: the same one for a message sent again unchanged until it is confirmed. */
interface ClientMessageIds {
  /** The ID of the message with this key: the unconfirmed one's, or a new one. */
  idFor(key: string): string;
  /** The server stored the message; the next message gets a new ID. */
  confirm(): void;
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

function useClientMessageIds(): ClientMessageIds {
  const unconfirmed = useRef<UnconfirmedMessage | null>(null);
  return {
    idFor(key) {
      if (unconfirmed.current?.key !== key)
        unconfirmed.current = { key, clientMessageId: createRandomUuid() };
      return unconfirmed.current.clientMessageId;
    },
    confirm() {
      unconfirmed.current = null;
    },
  };
}

/**
 * Sends one message at a time with the unsent attachments.
 *
 * @remarks
 * After a failure the session is read again: a message the server already
 * stored stays in the conversation, otherwise its text returns to the input.
 * The answer and the session read again only replace the view while their own
 * session is open, so they never land in another session. Every message
 * carries a client message ID; sent again unchanged after a failure, it keeps
 * that ID, so the server stores it once even when it had stored the first
 * attempt already (PAGE-68).
 */
export function useChatSend({
  isOpen,
  view,
  setView,
  setError,
  onJob,
  refresh,
}: ChatSendOptions): ChatSender {
  const [sending, setSending] = useState<ChatSending | null>(null);
  const [temporaryPasswords, setTemporaryPasswords] = useState<
    readonly ChatTemporaryPassword[]
  >([]);
  const abort = useRef<AbortController | null>(null);
  const clientMessageIds = useClientMessageIds();
  const openSessionId = view.session?.id;

  useEffect(() => {
    setTemporaryPasswords([]);
  }, [isOpen, openSessionId]);

  async function reload(sessionId: string, before: number): Promise<boolean> {
    try {
      const result = await chatApi({ intent: "session", sessionId });
      const fresh = readChatSessionView(result.view);
      setView((current) => applyChatSessionRead(current, fresh));
      return fresh.messages.length > before;
    } catch {
      return false;
    }
  }

  async function send(text: string): Promise<ChatSubmitOutcome> {
    const outcome = await deliver(text);
    if (outcome === "clear") clientMessageIds.confirm();
    return outcome;
  }

  async function deliver(text: string): Promise<ChatSubmitOutcome> {
    const { session } = view;
    // The ref is set at once, unlike the state, so a second submission in the same moment is refused.
    if (session === null || abort.current !== null) return "restore";
    const requestId = createRandomUuid();
    const attachmentIds = view.pending.map(({ id }) => id);
    const controller = new AbortController();
    abort.current = controller;
    setSending({
      requestId,
      sessionId: session.id,
      text,
      startedAt: Date.now(),
    });
    setTemporaryPasswords([]);
    try {
      const result = await chatApi(
        {
          intent: "send",
          message: {
            requestId,
            clientMessageId: clientMessageIds.idFor(
              JSON.stringify([session.id, text, attachmentIds]),
            ),
            sessionId: session.id,
            text,
            attachmentIds,
          },
        },
        controller.signal,
      );
      const sent = readChatSendResult(result);
      if (sent.kind === "reply") {
        setTemporaryPasswords(sent.reply.temporaryPasswords ?? []);
        setView((current) => addReply(current, sent.reply, session.id));
        return "clear";
      }
      // A Codex job runs on the server; the stored message and its steer status are read back.
      if (sent.kind === "job") onJob(sent.job.job);
      await refresh(session.id);
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
