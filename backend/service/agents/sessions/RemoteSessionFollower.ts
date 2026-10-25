import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentSessionEventPage } from "@/definition/AgentSessionJournal";
import type { AgentSessionEventListener } from "./AgentSessionJournal";

/** Follows the transactional remote journal, checking current rights before every incremental read. */
export async function followRemoteSession(
  read: (after: number) => Promise<AgentSessionEventPage>,
  after: number,
  listener: AgentSessionEventListener,
): Promise<() => void> {
  let cursor = after;
  let isClosed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function refresh(): Promise<void> {
    do {
      const page = await read(cursor);
      if (isClosed) return;
      for (const event of page.events) {
        listener(event);
        cursor = event.sequence;
      }
      if (!page.hasMore || !page.events.length) break;
    } while (!isClosed);
  }
  async function poll(): Promise<void> {
    try {
      await refresh();
      if (!isClosed)
        timer = setTimeout(() => {
          void poll();
        }, 2_000);
    } catch (error: unknown) {
      isClosed = true;
      logCaughtError("RemoteSessionFollower", error);
    }
  }
  await refresh();
  timer = setTimeout(() => {
    void poll();
  }, 2_000);
  return () => {
    isClosed = true;
    clearTimeout(timer);
  };
}
