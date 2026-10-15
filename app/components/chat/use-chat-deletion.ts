import { useRef, useState } from "react";

import {
  chatApi,
  chatErrorCode,
  readChatDeletion,
  readChatOverview,
  readChatSessions,
} from "@/app/lib/chat-client";

import type { Dispatch, SetStateAction } from "react";
import type { ChatDeletionResult } from "@/definition/Chat";
import type { ChatNotice, ChatPicker } from "./use-chat-commands";
import type { ChatView } from "./use-chat-uploads";

interface ChatDeletionOptions {
  readonly setView: Dispatch<SetStateAction<ChatView>>;
  readonly setPicker: Dispatch<SetStateAction<ChatPicker | null>>;
  readonly setNotice: (notice: ChatNotice | null) => void;
  readonly setError: (code: string) => void;
}

async function deleteBatches(
  ids: readonly string[],
): Promise<ChatDeletionResult> {
  const deleted: string[] = [];
  const failed: { sessionId: string; error: string }[] = [];
  const cleanupFailed: string[] = [];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200);
    try {
      const result = readChatDeletion(
        (await chatApi({ intent: "delete", sessionIds: batch })).deletion,
      );
      deleted.push(...result.deleted);
      failed.push(...result.failed);
      cleanupFailed.push(...result.cleanupFailed);
    } catch (error: unknown) {
      failed.push(
        ...batch.map((sessionId) => ({
          sessionId,
          error: chatErrorCode(error),
        })),
      );
    }
  }
  return { deleted, failed, cleanupFailed };
}

/** Maintains explicit selection outcomes and recovers a deleted active session without losing failures. */
export function useChatDeletion({
  setView,
  setPicker,
  setNotice,
  setError,
}: ChatDeletionOptions): {
  readonly isDeleting: boolean;
  remove(ids: readonly string[]): Promise<void>;
} {
  const busy = useRef(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function recover(): Promise<void> {
    const fresh = readChatOverview(
      (await chatApi({ intent: "open" })).overview,
    );
    setView((current) => (current.session === null ? fresh : current));
  }

  async function remove(ids: readonly string[]): Promise<void> {
    if (busy.current || ids.length === 0) return;
    busy.current = true;
    setIsDeleting(true);
    try {
      const result = await deleteBatches([...new Set(ids)]);
      setView((current) =>
        result.deleted.includes(current.session?.id ?? "")
          ? { session: null, messages: [], pending: [] }
          : current,
      );
      setPicker((current) =>
        current
          ? {
              ...current,
              sessions: current.sessions.filter(
                ({ id }) => !result.deleted.includes(id),
              ),
              outcome: result,
            }
          : current,
      );
      // Refresh even after a partial result, while retaining the per-ID failures.
      const fresh = await chatApi({ intent: "sessions" });
      setPicker((current) =>
        current
          ? { ...current, sessions: readChatSessions(fresh.sessions) }
          : current,
      );
      await recover();
      if (result.failed.length === 0 && result.cleanupFailed.length === 0) {
        setPicker(null);
        setNotice("deleted");
      }
    } catch (failure: unknown) {
      setError(chatErrorCode(failure));
      try {
        await recover();
      } catch (recoveryFailure: unknown) {
        setError(chatErrorCode(recoveryFailure));
      }
    } finally {
      busy.current = false;
      setIsDeleting(false);
    }
  }

  return { isDeleting, remove };
}
