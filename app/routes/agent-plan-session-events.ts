import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  readSessionCursor,
  readSessionKey,
} from "@/app/lib/agent-session-request.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { agentFailureResponse } from "@/app/lib/settings-actions/settings-agents-response.server";
import { AgentError } from "@/backend/error/AgentErrors";

import type { Route } from "./+types/agent-plan-session-events";
import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";

// A comment line now and then keeps proxies from closing a quiet stream; rights are read again with it.
const HEARTBEAT_INTERVAL = 25_000;
// How long the browser waits before it reconnects a closed stream.
const RETRY_DELAY = 3000;

const encoder = new TextEncoder();

function eventFrame(event: AgentSessionEvent): Uint8Array {
  return encoder.encode(
    `id: ${event.sequence}\nevent: session\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

/** Where a session stream reads from and how it checks that it may go on. */
interface SessionStreamSource {
  readonly signal: AbortSignal;
  readonly follow: (
    listener: (event: AgentSessionEvent) => void,
  ) => Promise<() => void>;
  /** Reads rights and session again; rejects once either is gone. */
  readonly check: () => Promise<void>;
}

/**
 * Ends the following once the browser leaves, also when it left before or during the replay.
 *
 * @remarks
 * The stream is never errored: a failed replay or a lost right closes it,
 * so closing it again cannot throw inside an abort listener.
 */
function sessionStream(
  source: SessionStreamSource,
): ReadableStream<Uint8Array> {
  let isClosed = false;
  let stopFollowing: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  function stop(): void {
    isClosed = true;
    stopFollowing?.();
    if (heartbeat !== null) clearInterval(heartbeat);
  }
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(chunk: Uint8Array): void {
        if (!isClosed) controller.enqueue(chunk);
      }
      function end(): void {
        if (isClosed) return;
        stop();
        controller.close();
      }
      if (source.signal.aborted) {
        end();
        return;
      }
      source.signal.addEventListener("abort", end, { once: true });
      // The browser reports the stream as open only once the first bytes arrive.
      send(encoder.encode(`retry: ${RETRY_DELAY}\n\n`));
      try {
        stopFollowing = await source.follow((event) => send(eventFrame(event)));
      } catch (error: unknown) {
        console.warn(
          "[pages] A PageAgentCLI session stream could not read its history.",
          error,
        );
        end();
        return;
      }
      if (isClosed) {
        stopFollowing();
        return;
      }
      heartbeat = setInterval(() => {
        send(encoder.encode(": keep-alive\n\n"));
        void source.check().catch(() => end());
      }, HEARTBEAT_INTERVAL);
    },
    cancel: stop,
  });
}

/**
 * Streams the history of one node attempt after a cursor, then its live events, each once.
 *
 * @remarks
 * A reconnect sends the last received sequence as `Last-Event-ID`, so it
 * continues without duplicates or gaps. Following reads the journal only:
 * it starts no process, extends no lease, and closing it leaves the agent
 * running. Rights and session are read again with every heartbeat; once
 * either is gone the stream ends.
 */
export async function loader({
  request,
  params,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const search = new URL(request.url).searchParams;
    const key = readSessionKey(params, search);
    const after = readSessionCursor(
      request.headers.get("Last-Event-ID") ?? search.get("after"),
    );
    const sessions = (await getApplicationServices()).agentSessionService;
    // Rights and key are checked before the stream opens, so a refusal is a plain error response.
    await sessions.view(user.id, key);
    const stream = sessionStream({
      signal: request.signal,
      follow: (listener) => sessions.follow(user.id, key, after, listener),
      check: async () => {
        await sessions.view(user.id, key);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        // Reverse proxies such as nginx would otherwise hold events back in their buffer.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error: unknown) {
    return agentFailureResponse(error, "session-follow");
  }
}
