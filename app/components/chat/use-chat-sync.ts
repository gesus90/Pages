import { useEffect } from "react";

import {
  chatApi,
  chatErrorCode,
  readChatOverview,
} from "@/app/lib/chat-client";
import { readChatSessionStateResult } from "@/app/lib/chat-job-client";

import { toChatView } from "./use-chat-commands";

import type { Dispatch, SetStateAction } from "react";
import type { ChatView } from "./use-chat-uploads";

/** How long the panel waits between two checks of the open conversation. */
const SYNC_INTERVAL_MS = 3_000;

interface ChatSyncOptions {
  readonly isOpen: boolean;
  readonly view: ChatView;
  /** An own message is on its way; its answer reads the conversation anyway. */
  readonly isSending: boolean;
  /** Reads the conversation again; keeps unsent attachments and must keep its identity between renders. */
  readonly reload: (sessionId: string) => Promise<void>;
  readonly setView: Dispatch<SetStateAction<ChatView>>;
}

/** Opens the most recently used conversation, as opening the panel does. */
async function reopenLatest(
  setView: Dispatch<SetStateAction<ChatView>>,
): Promise<void> {
  try {
    const result = await chatApi({ intent: "open" });
    setView(toChatView(readChatOverview(result.overview)));
  } catch {
    // The next check asks again.
  }
}

/**
 * Keeps the open conversation in step with other devices, such as Pica Mobile.
 *
 * @remarks
 * While the panel is open, the page visible and no own message on its way,
 * the panel asks every three seconds for the small state of the conversation.
 * Only when the last message or the newest job differs from the view is the
 * conversation read again; the draft and unsent attachments stay, and the
 * job hook follows a new job on its own. A conversation that no longer exists
 * gives way to the most recently used one. A failed check shows nothing.
 */
export function useChatSync({
  isOpen,
  view,
  isSending,
  reload,
  setView,
}: ChatSyncOptions): void {
  const sessionId = view.session?.id ?? null;
  const lastMessageAt = view.session?.lastMessageAt ?? null;
  const jobId = view.activity?.job?.id ?? null;

  useEffect(() => {
    if (!isOpen || isSending || sessionId === null) return undefined;
    const openId: string = sessionId;
    let isCurrent = true;
    let isChecking = false;
    async function check(): Promise<void> {
      if (document.visibilityState !== "visible" || isChecking) return;
      isChecking = true;
      try {
        const state = readChatSessionStateResult(
          await chatApi({ intent: "sessionState", sessionId: openId }),
        );
        if (
          isCurrent &&
          (state.lastMessageAt !== lastMessageAt || state.jobId !== jobId)
        )
          await reload(openId);
      } catch (failure: unknown) {
        if (isCurrent && chatErrorCode(failure) === "sessionMissing")
          await reopenLatest(setView);
      } finally {
        isChecking = false;
      }
    }
    const timer = window.setInterval(() => void check(), SYNC_INTERVAL_MS);
    return () => {
      isCurrent = false;
      window.clearInterval(timer);
    };
  }, [isOpen, isSending, sessionId, lastMessageAt, jobId, reload, setView]);
}
