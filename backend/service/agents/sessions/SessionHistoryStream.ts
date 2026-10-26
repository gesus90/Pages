import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentSessionEventPage } from "@/definition/AgentSessionJournal";

const encoder = new TextEncoder();
const POLL_MILLISECONDS = 2000;
const HEARTBEAT_MILLISECONDS = 25_000;

function frame(event: string, contents: unknown, id?: number): Uint8Array {
  const prefix = id === undefined ? "" : `id: ${id}\n`;
  return encoder.encode(
    `${prefix}event: ${event}\ndata: ${JSON.stringify(contents)}\n\n`,
  );
}

function pause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    function end(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", end);
      resolve();
    }
    const timer = setTimeout(end, POLL_MILLISECONDS);
    signal.addEventListener("abort", end, { once: true });
    if (signal.aborted) end();
  });
}

/** Pulls bounded authorized journal pages; slow readers cannot accumulate an SSE replay queue. */
export function sessionHistoryStream(input: {
  readonly signal: AbortSignal;
  readonly after: number;
  readonly read: (after: number) => Promise<AgentSessionEventPage>;
}): ReadableStream<Uint8Array> {
  let cursor = input.after;
  let isClosed = false;
  let heartbeatAt = Date.now();
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controller.enqueue(encoder.encode("retry: 3000\n\n"));
      },
      async pull(controller) {
        try {
          while (!isClosed && !input.signal.aborted) {
            const page = await input.read(cursor);
            if (isClosed || input.signal.aborted) break;
            const first = page.events[0]?.sequence;
            if (first !== undefined && first !== cursor + 1)
              controller.enqueue(
                frame("history-gap", {
                  retainedFrom: page.retainedFrom ?? first,
                }),
              );
            if (page.events.length) {
              const frames = page.events.map((event) => {
                cursor = event.sequence;
                return frame("session", event, event.sequence);
              });
              controller.enqueue(Buffer.concat(frames));
              return;
            }
            if (Date.now() - heartbeatAt >= HEARTBEAT_MILLISECONDS) {
              heartbeatAt = Date.now();
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
              return;
            }
            await pause(input.signal);
          }
          if (!isClosed) controller.close();
        } catch (error: unknown) {
          logCaughtError("SessionHistoryStream", error);
          if (!isClosed) {
            controller.enqueue(
              frame("history-error", {
                error:
                  error instanceof AgentError
                    ? error.code
                    : "plan_history_unavailable",
              }),
            );
            controller.close();
          }
        }
      },
      cancel() {
        isClosed = true;
      },
    },
    { highWaterMark: 1 },
  );
}

/** Streams a fixed authorized history prefix as text, without buffering the complete export. */
export function sessionHistoryDownload(input: {
  readonly signal: AbortSignal;
  readonly lastSequence: number;
  readonly read: (after: number) => Promise<AgentSessionEventPage>;
}): ReadableStream<Uint8Array> {
  let cursor = 0;
  let isClosed = false;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (input.signal.aborted || cursor >= input.lastSequence) {
            controller.close();
            return;
          }
          const page = await input.read(cursor);
          if (isClosed) return;
          if (page.retainedFrom !== null && cursor < page.retainedFrom - 1)
            controller.enqueue(
              encoder.encode(
                `[Earlier history no longer retained; starts at ${page.retainedFrom}]\n`,
              ),
            );
          const events = page.events.filter(
            (event) => event.sequence <= input.lastSequence,
          );
          if (!events.length) throw new AgentError("plan_history_unavailable");
          const text = events
            .map(
              (event) =>
                `[${event.sequence} ${event.createdAt} ${event.channel ?? "event"} ${event.kind}] ${event.text}${event.isTruncated ? " [truncated]" : ""}\n`,
            )
            .join("");
          cursor = events.at(-1)?.sequence ?? cursor;
          controller.enqueue(encoder.encode(text));
        } catch (error: unknown) {
          logCaughtError("SessionHistoryStream", error);
          if (!isClosed)
            controller.error(new AgentError("plan_history_unavailable"));
        }
      },
      cancel() {
        isClosed = true;
      },
    },
    { highWaterMark: 1 },
  );
}
