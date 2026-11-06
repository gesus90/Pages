import { logCaughtError } from "@/backend/logging/Logger";
import { isResyncEvent } from "@/backend/service/events/LiveChangeAudience";
import { LIVE_CHANGE_EVENT } from "@/definition/LiveChange";

import type { LiveChangeAudience } from "@/backend/service/events/LiveChangeAudience";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { User } from "@/definition/User";

const encoder = new TextEncoder();
/** Collects an event storm into one round of checks. */
const GATHER_MILLISECONDS = 50;
/** Keeps proxies from closing the stream and re-reads the account's rights. */
const HEARTBEAT_MILLISECONDS = 25_000;
/** More waiting events than this become one `resync`. */
const MAXIMUM_PENDING_EVENTS = 256;
/** How long the browser waits before it connects again. */
const RETRY_MILLISECONDS = 3000;

/** The account behind one open stream, read again for every round. */
export interface LiveAccount {
  readonly user: User;
  /** The authorization fingerprint the pages compare. */
  readonly version: string;
}

/** What one stream needs: who reads it, from which state, and until when. */
export interface LiveStreamInput {
  /** Reads the account again; `null` once the session no longer holds. */
  readonly account: () => Promise<LiveAccount | null>;
  /** The fingerprint the browser's page was loaded with. */
  readonly version: string;
  readonly signal: AbortSignal;
}

/** Where the hub learns about committed changes. */
export interface LiveChangeSource {
  subscribe(listener: (event: PagesEvent) => void): () => void;
}

function frame(event: string, contents: unknown): Uint8Array {
  return encoder.encode(
    `event: ${event}\ndata: ${JSON.stringify(contents)}\n\n`,
  );
}

/** One open stream: waiting events, the account baseline and the timers. */
class LiveConnection {
  private readonly input: LiveStreamInput;
  private readonly audience: LiveChangeAudience;
  private readonly controller: ReadableStreamDefaultController<Uint8Array>;
  private readonly pending = new Map<string, PagesEvent>();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private readonly release: () => void;
  private gatherTimer: ReturnType<typeof setTimeout> | undefined;
  private version: string;
  private isResyncDue = false;
  private isChecking = false;
  private isAccountDue = true;
  private isClosed = false;

  public constructor(
    input: LiveStreamInput,
    audience: LiveChangeAudience,
    controller: ReadableStreamDefaultController<Uint8Array>,
    release: () => void,
  ) {
    this.input = input;
    this.audience = audience;
    this.controller = controller;
    this.release = release;
    this.version = input.version;
    this.heartbeat = setInterval(() => {
      this.write(encoder.encode(": keep-alive\n\n"));
      this.isAccountDue = true;
      this.schedule();
    }, HEARTBEAT_MILLISECONDS);
    input.signal.addEventListener("abort", () => this.close(), { once: true });
  }

  /** Starts with the retry hint and an account check against the page's state. */
  public start(): void {
    this.write(encoder.encode(`retry: ${RETRY_MILLISECONDS}\n\n`));
    if (this.input.signal.aborted) this.close();
    else this.schedule();
  }

  /** Ends the stream; the browser connects again and catches up on its own. */
  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.release();
    clearInterval(this.heartbeat);
    clearTimeout(this.gatherTimer);
    this.pending.clear();
    try {
      this.controller.close();
    } catch (caughtError: unknown) {
      // The reader already went away; there is nothing left to close.
      logCaughtError("LiveChangeHub", caughtError);
    }
  }

  /**
   * Queues one committed event for the next round.
   *
   * @remarks
   * A purged page or a project that changed its departments cannot be decided
   * for those who lost it, so its event becomes a `resync`, which names nothing.
   */
  public receive(event: PagesEvent): void {
    if (this.isClosed) return;
    if (
      isResyncEvent(event.type) ||
      this.pending.size >= MAXIMUM_PENDING_EVENTS
    )
      this.isResyncDue = true;
    else this.pending.set(`${event.type}:${event.id}`, event);
    this.schedule();
  }

  /** Sends `resync` in the next round, because events may have been missed. */
  public resync(): void {
    if (this.isClosed) return;
    this.isResyncDue = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.isClosed || this.gatherTimer !== undefined) return;
    this.gatherTimer = setTimeout(() => {
      this.gatherTimer = undefined;
      void this.check();
    }, GATHER_MILLISECONDS);
  }

  /** One round: read the account, then decide each waiting event with it. */
  private async check(): Promise<void> {
    if (this.isChecking || this.isClosed) return;
    this.isChecking = true;
    try {
      await this.deliver();
    } catch (caughtError: unknown) {
      logCaughtError("LiveChangeHub", caughtError);
      this.close();
    } finally {
      this.isChecking = false;
    }
    if (this.pending.size > 0 || this.isResyncDue) this.schedule();
  }

  private async deliver(): Promise<void> {
    const events = [...this.pending.values()];
    const isResyncDue = this.isResyncDue;
    const isAccountDue = this.isAccountDue;
    this.pending.clear();
    this.isResyncDue = false;
    this.isAccountDue = false;
    if (events.length === 0 && !isResyncDue && !isAccountDue) return;
    const account = await this.input.account();
    if (!account) {
      this.close();
      return;
    }
    if (account.version !== this.version || isResyncDue) {
      this.version = account.version;
      this.write(frame(LIVE_CHANGE_EVENT.RESYNC, {}));
    }
    const sent = new Set<string>();
    for (const event of events) {
      const notice = await this.audience.notice(account.user, event);
      const key = notice ? `${notice.kind}:${notice.id}` : "";
      if (!notice || sent.has(key)) continue;
      sent.add(key);
      this.write(frame(LIVE_CHANGE_EVENT.CHANGE, notice));
    }
  }

  /** Writes a frame; a reader that falls behind is dropped instead of buffered. */
  private write(chunk: Uint8Array): void {
    if (this.isClosed) return;
    const room = this.controller.desiredSize;
    if (room !== null && room <= 0) {
      this.close();
      return;
    }
    this.controller.enqueue(chunk);
  }
}

/**
 * Sends committed changes to the open pages as SSE, per account and per object.
 *
 * @remarks
 * A notice holds only the kind and the id of the changed object. Before each
 * round the account is read again, and every event is decided with the rights
 * it has now, so a revoked right or an ended session holds back the very next
 * notice. Nothing is kept for a stream that is gone: after a reconnect the
 * browser reads its page again, which is the complete catch-up.
 */
export class LiveChangeHub {
  private readonly audience: LiveChangeAudience;
  private readonly connections = new Set<LiveConnection>();

  /**
   * Creates the hub and follows the publisher of this process.
   *
   * @param source - The publisher of committed Pages events.
   * @param audience - Decides which account may learn about which object.
   */
  public constructor(source: LiveChangeSource, audience: LiveChangeAudience) {
    this.audience = audience;
    source.subscribe((event) => this.receive(event));
  }

  /**
   * Hands one committed event to every open stream, also one another process relayed.
   *
   * @param event - A committed Pages event; each stream decides it for its account.
   */
  public receive(event: PagesEvent): void {
    for (const connection of this.connections) connection.receive(event);
  }

  /** Asks every open stream to read everything again, after events may have been lost. */
  public resyncAll(): void {
    for (const connection of this.connections) connection.resync();
  }

  /**
   * Opens one stream for one signed-in page.
   *
   * @param input - The account reader, the page's fingerprint and the request's end.
   * @returns The SSE body; it ends with the request.
   */
  public open(input: LiveStreamInput): ReadableStream<Uint8Array> {
    let connection: LiveConnection | undefined;
    return new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          const opened = new LiveConnection(
            input,
            this.audience,
            controller,
            () => this.connections.delete(opened),
          );
          connection = opened;
          this.connections.add(opened);
          opened.start();
        },
        cancel: () => {
          connection?.close();
        },
      },
      { highWaterMark: 64 },
    );
  }
}
