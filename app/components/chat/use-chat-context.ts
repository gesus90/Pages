import { useEffect, useRef, useState } from "react";

import {
  chatApi,
  chatErrorCode,
  readChatCompaction,
  readChatContext,
} from "@/app/lib/chat-client";

import type { ChatContextSize } from "@/definition/Chat";
import type { ChatContextUsage } from "@/definition/ChatJob";
import type { ChatNotice } from "./use-chat-commands";
import type { ChatView } from "./use-chat-uploads";

interface ChatContextOptions {
  readonly isOpen: boolean;
  readonly view: ChatView;
  /** The occupancy the running job of the session reported last; `undefined` while none runs. */
  readonly reported: ChatContextUsage | null | undefined;
  readonly setError: (code: string) => void;
  readonly setNotice: (notice: ChatNotice | null) => void;
}

/**
 * The context of the session as a read of the server returns it: while a job
 * runs, its adapter's latest report replaces the one loaded with the last
 * message (PAGE-90). An estimate of Pages is never replaced.
 */
function currentContext(
  loaded: ChatContextSize | null,
  reported: ChatContextUsage | null | undefined,
): ChatContextSize | null {
  if (reported === undefined || loaded?.source !== "adapter") return loaded;
  return {
    tokens: reported?.used ?? null,
    limit: reported?.size ?? null,
    isEstimated: false,
    source: "adapter",
  };
}

/** Loads the active context and keeps compaction bound to the session that started it. */
export function useChatContext({
  isOpen,
  view,
  reported,
  setError,
  setNotice,
}: ChatContextOptions): {
  readonly context: ChatContextSize | null;
  readonly isCompacting: boolean;
  compact(): Promise<void>;
} {
  const [snapshot, setSnapshot] = useState<{
    sessionId: string;
    context: ChatContextSize;
  } | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const busy = useRef(false);
  const sessionId = view.session?.id;
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!isOpen || !sessionId) return undefined;
    let isCurrent = true;
    async function load(): Promise<void> {
      try {
        const result = await chatApi({ intent: "context", sessionId });
        const context = readChatContext(result.context);
        if (isCurrent) setSnapshot({ sessionId: sessionId ?? "", context });
      } catch {
        if (isCurrent) setSnapshot(null);
      }
    }
    void load();
    return () => {
      isCurrent = false;
    };
  }, [isOpen, sessionId, view.messages, revision]);

  async function compact(): Promise<void> {
    if (!sessionId) {
      setError("sessionMissing");
      return;
    }
    if (busy.current) return;
    busy.current = true;
    setIsCompacting(true);
    setNotice("compacting");
    try {
      const result = await chatApi({ intent: "compact", sessionId });
      const completed = readChatCompaction(result.compaction);
      setSnapshot({ sessionId, context: completed.context });
      setNotice(completed.status);
    } catch (failure: unknown) {
      setNotice(null);
      setError(chatErrorCode(failure));
    } finally {
      busy.current = false;
      setIsCompacting(false);
      setRevision((current) => current + 1);
    }
  }

  return {
    context: currentContext(
      snapshot !== null && snapshot.sessionId === sessionId
        ? snapshot.context
        : null,
      reported,
    ),
    isCompacting,
    compact,
  };
}
