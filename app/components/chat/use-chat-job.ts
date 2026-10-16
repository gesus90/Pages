import { useEffect, useState } from "react";

import { chatApi, chatErrorCode } from "@/app/lib/chat-client";
import { readChatJobResult } from "@/app/lib/chat-job-client";

import {
  applyChatJobUpdate,
  isChatJobRunning,
  startChatLiveJob,
} from "./chat-job-state";

import type { ChatJob } from "@/definition/ChatJob";
import type { ChatLiveJob } from "./chat-job-state";
import type { ChatView } from "./use-chat-uploads";

/** How long the panel waits between two reads of a running job's journal. */
const POLL_INTERVAL_MS = 800;

/** The Pica job of the open conversation, as the panel follows it. */
export interface ChatJobs {
  /** The newest job of the open conversation, while it runs or when it did not complete. */
  readonly live: ChatLiveJob | null;
  readonly isRunning: boolean;
  /** Follows a job that was just started; its journal is read from the start. */
  attach(job: ChatJob): void;
  /** Asks the server to stop the running job; closing the panel never does. */
  stop(): void;
}

interface ChatJobOptions {
  readonly isOpen: boolean;
  readonly view: ChatView;
  /** Reads the conversation again; must keep its identity between renders. */
  readonly reload: (sessionId: string) => Promise<void>;
  readonly setError: (code: string) => void;
}

/**
 * Whether the journal still has entries to read: until its end entry, or
 * while the job row already ended but a page of entries is unread.
 */
function isPolling(live: ChatLiveJob | null): live is ChatLiveJob {
  return (
    live !== null &&
    live.ended === null &&
    (live.job.state === "running" || live.cursor === 0 || live.hasMore)
  );
}

/**
 * Follows the server-side Pica job of the open conversation (PAGE-68).
 *
 * @remarks
 * The job runs on the server; the panel only reads its journal after the last
 * applied entry, so leaving and returning shows the current state without a
 * gap or a repetition. A read that does not continue the cursor starts over.
 * A hidden panel stops reading and continues from its cursor when shown.
 */
export function useChatJob({
  isOpen,
  view,
  reload,
  setError,
}: ChatJobOptions): ChatJobs {
  const [live, setLive] = useState<ChatLiveJob | null>(null);
  const [attachedId, setAttachedId] = useState<string | null>(null);
  const sessionId = view.session?.id ?? null;
  const latest = view.activity?.job ?? null;

  // The newest job the conversation names replaces an older one; a completed one shows nothing.
  if (latest !== null && latest.id !== attachedId) {
    setAttachedId(latest.id);
    setLive(latest.state === "completed" ? null : startChatLiveJob(latest));
  }

  const visible = live?.job.sessionId === sessionId ? live : null;
  const polling = isOpen && isPolling(visible) ? visible : null;

  useEffect(() => {
    if (polling === null) return undefined;
    const following: ChatLiveJob = polling;
    let isCurrent = true;
    const { job, cursor } = following;
    async function read(): Promise<void> {
      try {
        const result = await chatApi({
          intent: "job",
          sessionId: job.sessionId,
          jobId: job.id,
          after: cursor,
        });
        const update = readChatJobResult(result);
        if (!isCurrent || update === null) return;
        const applied = applyChatJobUpdate(following, update);
        setLive(applied.live);
        if (applied.needsReload) await reload(job.sessionId);
      } catch {
        // A lost read is repeated from the same cursor; the job runs on regardless.
        if (isCurrent) setLive({ ...following, hasMore: false });
      }
    }
    const timer = setTimeout(
      () => void read(),
      following.hasMore ? 0 : POLL_INTERVAL_MS,
    );
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [polling, reload]);

  function attach(job: ChatJob): void {
    setAttachedId(job.id);
    setLive(startChatLiveJob(job));
  }

  function stop(): void {
    if (visible === null) return;
    void chatApi({ intent: "stop", sessionId: visible.job.sessionId }).catch(
      (failure: unknown) => setError(chatErrorCode(failure)),
    );
  }

  return {
    live:
      visible !== null && visible.ended?.state !== "completed" ? visible : null,
    isRunning: isChatJobRunning(visible),
    attach,
    stop,
  };
}
