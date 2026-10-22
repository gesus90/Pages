import { RemoteError } from "@/backend/error/RemoteErrors";
import { CONSOLE_MAXIMUM_RETRIES } from "@/definition/RemoteConsole";

import type { RemoteSession } from "@/backend/remote/RemoteSession";
import type { SshPty } from "@/backend/remote/SshPty";
import type {
  RemoteConsoleEvent,
  RemoteConsoleSize,
  RemoteConsoleState,
} from "@/definition/RemoteConsole";

const MAXIMUM_HISTORY = 256 * 1024;
const RETRY_DELAY = 3000;
const RETRY_MESSAGES = new Set([
  "remote.failure.transport_lost",
  "remote.failure.host_unknown",
  "remote.failure.unreachable_refused",
  "remote.failure.unreachable_timeout",
  "remote.failure.unreachable_network",
  "remote.error.remote_reconnecting",
]);

function messageOf(error: unknown): string {
  if (!(error instanceof RemoteError)) return "remote.failure.remote_failed";
  if (error.failure) return `remote.failure.${error.failure}`;
  return `remote.error.${error.code}`;
}

/** Owns one person's shell, bounded replay history and reconnect budget. */
export class RemoteConsoleSession {
  private readonly target: () => Promise<{
    readonly session: RemoteSession;
    readonly path: string;
  }>;
  private readonly listeners = new Set<(event: RemoteConsoleEvent) => void>();
  private readonly history: RemoteConsoleEvent[] = [];
  private historyLength = 0;
  private sequence = 0;
  private terminal: SshPty | null = null;
  private size: RemoteConsoleSize;
  private state: RemoteConsoleState = {
    status: "connecting",
    attempts: 0,
    message: null,
    exitCode: null,
  };
  private generation = 0;
  private retryTimer: NodeJS.Timeout | null = null;

  public constructor(
    target: RemoteConsoleSession["target"],
    size: RemoteConsoleSize,
  ) {
    this.target = target;
    this.size = size;
    void this.connect();
  }

  /** Returns the current classified connection state. */
  public view(): RemoteConsoleState {
    return this.state;
  }

  /** Replays only events after the cursor and then follows live output. */
  public follow(
    after: number,
    listener: (event: RemoteConsoleEvent) => void,
  ): () => void {
    const first = this.history.at(0)?.sequence ?? this.sequence;
    if (after > 0 && after < first - 1) {
      this.close("remote.console.historyLost");
    }
    for (const event of this.history)
      if (event.sequence > after) listener(event);
    listener({ kind: "state", sequence: this.sequence, state: this.state });
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Input is never queued or replayed after a disconnect. */
  public write(input: string, attempt: number): void {
    if (
      this.state.status !== "connected" ||
      !this.terminal ||
      attempt !== this.state.attempts
    )
      throw new RemoteError("remote_transport_lost", "transport_lost");
    this.terminal.write(input);
  }

  /** Remembers the latest geometry for a shell that is still connecting. */
  public resize(size: RemoteConsoleSize): void {
    this.size = size;
    this.terminal?.resize(size.columns, size.rows);
  }

  /** An explicit reconnect continues the same budget and cannot unblock ten used attempts. */
  public reconnect(): void {
    if (
      this.state.status !== "blocked" ||
      this.state.attempts >= CONSOLE_MAXIMUM_RETRIES
    )
      return;
    if (this.state.message === "remote.failure.host_key_changed") return;
    this.scheduleRetry();
  }

  /** Cancels pending opens and retries, then terminates this shell. */
  public close(message: string | null = null): void {
    if (this.state.status === "ended") return;
    this.generation += 1;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.terminal?.close();
    this.terminal = null;
    this.update({ ...this.state, status: "ended", message });
  }

  private update(state: RemoteConsoleState): void {
    this.state = state;
    this.emit({ kind: "state", sequence: ++this.sequence, state });
  }

  private output(chunk: string): void {
    // Small frames bound HTTP buffering even when a remote program writes large chunks.
    for (let offset = 0; offset < chunk.length; offset += 8192)
      this.emit({
        kind: "output",
        sequence: ++this.sequence,
        chunk: chunk.slice(offset, offset + 8192),
      });
  }

  private emit(event: RemoteConsoleEvent): void {
    this.history.push(event);
    this.historyLength += event.kind === "output" ? event.chunk.length : 256;
    while (this.historyLength > MAXIMUM_HISTORY) {
      const removed = this.history.shift();
      if (removed)
        this.historyLength -=
          removed.kind === "output" ? removed.chunk.length : 256;
    }
    for (const listener of this.listeners) listener(event);
  }

  private async connect(): Promise<void> {
    const generation = this.generation;
    try {
      const { session, path } = await this.target();
      if (generation !== this.generation) return;
      const terminal = await session.openPty({
        ...this.size,
        path,
        onOutput: (chunk) => this.output(chunk),
      });
      if (generation !== this.generation) {
        terminal.close();
        return;
      }
      this.terminal = terminal;
      terminal.resize(this.size.columns, this.size.rows);
      this.update({
        ...this.state,
        status: "connected",
        message: null,
        exitCode: null,
      });
      void terminal.exited.then((exitCode) =>
        this.handleExit(generation, exitCode),
      );
    } catch (error: unknown) {
      if (generation !== this.generation) return;
      const message = messageOf(error);
      this.update({ ...this.state, status: "blocked", message });
      if (RETRY_MESSAGES.has(message)) this.scheduleRetry();
    }
  }

  private handleExit(generation: number, exitCode: number): void {
    if (generation !== this.generation) return;
    this.terminal = null;
    if (exitCode === 255) {
      this.update({
        ...this.state,
        status: "blocked",
        message: "remote.failure.transport_lost",
      });
      this.scheduleRetry();
      return;
    }
    this.update({ ...this.state, status: "ended", exitCode, message: null });
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.state.attempts >= CONSOLE_MAXIMUM_RETRIES)
      return;
    this.update({ ...this.state, status: "reconnecting" });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.update({ ...this.state, attempts: this.state.attempts + 1 });
      void this.connect();
    }, RETRY_DELAY);
    this.retryTimer.unref();
  }
}
