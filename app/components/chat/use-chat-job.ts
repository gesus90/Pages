import { useEffect, useState } from "react";

import { chatApi, chatErrorCode } from "@/app/lib/chat-client";
import { readChatJobResult } from "@/app/lib/chat-job-client";

import {
  applyChatJobUpdate,
  isChatJobRunning,
  startChatLiveJob,
} from "./chat-job-state";

import type { ChatJob, ChatJobUpdate } from "@/definition/ChatJob";
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
 * Whether the journal still has entries to read: until its end entry while
 * the job runs, and for an ended job until one read found no further page.
 */
function isPolling(live: ChatLiveJob | null): live is ChatLiveJob {
  return (
    live !== null &&
    live.ended === null &&
    (live.job.state === "running" || !live.hasRead || live.hasMore)
  );
}

/** Reads the journal of a job after the cursor the panel applied last. */
async function readJournal(
  following: ChatLiveJob,
): Promise<ChatJobUpdate | null> {
  const { job, cursor } = following;
  return readChatJobResult(
    await chatApi({
      intent: "job",
      sessionId: job.sessionId,
      jobId: job.id,
      after: cursor,
    }),
  );
}

/** The job the panel shows: not one of another conversation, not a completed one. */
function shownJob(visible: ChatLiveJob | null): ChatLiveJob | null {
  return visible !== null && visible.ended?.state !== "completed"
    ? visible
    : null;
}

/**
 * Reads the journal of the followed job, page after page, then at an interval.
 *
 * @param following - The job to read, or `null` to read nothing.
 * @param setLive - Receives each applied read.
 * @param reload - Reads the conversation again after a stored answer or the end.
 */
function useJournalReads(
  following: ChatLiveJob | null,
  setLive: (live: ChatLiveJob) => void,
  reload: (sessionId: string) => Promise<void>,
): void {
  useEffect(() => {
    if (following === null) return undefined;
    const current: ChatLiveJob = following;
    let isCurrent = true;
    async function read(): Promise<void> {
      try {
        const update = await readJournal(current);
        if (!isCurrent || update === null) return;
        const applied = applyChatJobUpdate(current, update);
        setLive(applied.live);
        if (applied.needsReload) await reload(current.job.sessionId);
      } catch {
        // A lost read is repeated from the same cursor while the job runs; it runs on regardless.
        if (isCurrent) setLive({ ...current, hasMore: false, hasRead: true });
      }
    }
    const timer = setTimeout(
      () => void read(),
      current.hasMore ? 0 : POLL_INTERVAL_MS,
    );
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [following, setLive, reload]);
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
  const [namedId, setNamedId] = useState<string | null>(null);
  const sessionId = view.session?.id ?? null;
  const latest = view.activity?.job ?? null;

  // A job the conversation names anew is followed unless it is the one followed already.
  if (latest !== null && latest.id !== namedId) {
    setNamedId(latest.id);
    if (live?.job.id !== latest.id)
      setLive(latest.state === "completed" ? null : startChatLiveJob(latest));
  }

  const visible = live?.job.sessionId === sessionId ? live : null;
  useJournalReads(
    isOpen && isPolling(visible) ? visible : null,
    setLive,
    reload,
  );

  function attach(job: ChatJob): void {
    setLive(startChatLiveJob(job));
  }

  function stop(): void {
    if (visible === null) return;
    void chatApi({ intent: "stop", sessionId: visible.job.sessionId }).catch(
      (failure: unknown) => setError(chatErrorCode(failure)),
    );
  }

  return {
    live: shownJob(visible),
    isRunning: isChatJobRunning(visible),
    attach,
    stop,
  };
}
