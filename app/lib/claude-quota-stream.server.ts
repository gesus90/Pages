import { logCaughtError } from "@/backend/logging/Logger";

import type { QuotaSnapshot } from "@/definition/AgentQuota";

/** How often the server pushes new figures to an open quota page. */
export const CLAUDE_QUOTA_PUSH_MILLISECONDS = 60_000;

/** A comment line keeps proxies from closing a quiet stream between pushes. */
const HEARTBEAT_MILLISECONDS = 25_000;

const encoder = new TextEncoder();

function frame(event: string, contents: unknown, id: number): Uint8Array {
  return encoder.encode(
    `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(contents)}\n\n`,
  );
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    function end(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", end);
      resolve();
    }
    const timer = setTimeout(end, milliseconds);
    signal.addEventListener("abort", end, { once: true });
    if (signal.aborted) end();
  });
}

/**
 * Pushes the quota figures of one open page once a minute.
 * @param input - The request's end, the authorized read and whether the
 * browser reconnects after a lost stream.
 * @returns The event stream: `quotas` with a snapshot, or `quota-error` with
 * the time of a failed read; the next minute reads again either way.
 * @remarks
 * The page queries once itself when it opens, so a new stream first pushes
 * after a minute; a reconnecting browser, which sends the last event id,
 * missed its push and gets one at once. The stream lives exactly as long as
 * the page holds it: leaving the page ends the request, and with it every
 * further read. The browser waits a minute before it reconnects a lost
 * stream.
 */
export function claudeQuotaStream(input: {
  readonly signal: AbortSignal;
  readonly isReconnect: boolean;
  readonly read: () => Promise<QuotaSnapshot>;
}): ReadableStream<Uint8Array> {
  const { signal, read } = input;
  let nextPushAt =
    Date.now() + (input.isReconnect ? 0 : CLAUDE_QUOTA_PUSH_MILLISECONDS);
  let sequence = 0;
  let isClosed = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // The first id makes every reconnect carry Last-Event-ID, even one
      // before the first push, so it is answered at once.
      controller.enqueue(
        encoder.encode(`retry: ${CLAUDE_QUOTA_PUSH_MILLISECONDS}\nid: 0\n\n`),
      );
    },
    async pull(controller) {
      const wait = Math.min(
        HEARTBEAT_MILLISECONDS,
        Math.max(0, nextPushAt - Date.now()),
      );
      await pause(wait, signal);
      if (isClosed) return;
      if (signal.aborted) {
        isClosed = true;
        controller.close();
        return;
      }
      if (Date.now() < nextPushAt) {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
        return;
      }
      // The beat stays on the minute however long a read takes.
      nextPushAt = Math.max(
        nextPushAt + CLAUDE_QUOTA_PUSH_MILLISECONDS,
        Date.now() + 1_000,
      );
      sequence += 1;
      try {
        const snapshot = await read();
        if (!isClosed) controller.enqueue(frame("quotas", snapshot, sequence));
      } catch (error: unknown) {
        logCaughtError("claude_quota_stream", error);
        if (!isClosed)
          controller.enqueue(
            frame(
              "quota-error",
              { failedAt: new Date().toISOString() },
              sequence,
            ),
          );
      }
    },
    cancel() {
      isClosed = true;
    },
  });
}
