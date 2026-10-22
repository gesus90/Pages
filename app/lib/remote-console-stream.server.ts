import type { RemoteConsoleSession } from "@/backend/service/remote/RemoteConsoleSession";

const encoder = new TextEncoder();

/** Streams bounded terminal frames and renews the shell lease after checking current rights. */
export function remoteConsoleStream(input: {
  readonly signal: AbortSignal;
  readonly session: RemoteConsoleSession;
  readonly after: number;
  readonly check: () => Promise<unknown>;
}): ReadableStream<Uint8Array> {
  let stopFollowing: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let isClosed = false;
  let end: () => void = () => undefined;
  function cleanup(): void {
    isClosed = true;
    stopFollowing?.();
    if (timer) clearInterval(timer);
    input.signal.removeEventListener("abort", end);
  }
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        end = () => {
          if (isClosed) return;
          cleanup();
          controller.close();
        };
        function send(frame: string): void {
          if (isClosed) return;
          if ((controller.desiredSize ?? 0) < -256 * 1024) {
            end();
            return;
          }
          controller.enqueue(encoder.encode(frame));
        }
        if (input.signal.aborted) {
          end();
          return;
        }
        input.signal.addEventListener("abort", end, { once: true });
        send("retry: 3000\n\n");
        stopFollowing = input.session.follow(input.after, (event) => {
          send(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
        });
        if (isClosed) {
          stopFollowing();
          return;
        }
        timer = setInterval(() => {
          void input
            .check()
            .then(() => send(": heartbeat\n\n"))
            .catch(() => end());
        }, 15_000);
      },
      cancel: cleanup,
    },
    { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength },
  );
}
