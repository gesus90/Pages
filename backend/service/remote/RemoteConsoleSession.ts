import { setTimeout as delay } from "node:timers/promises";

import { RemoteError } from "@/backend/error/RemoteErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { SSH_FAILURE_EXIT_CODE } from "@/backend/remote/SshFailure";
import { CONSOLE_MAXIMUM_RETRIES } from "@/definition/RemoteConsole";

import type { RemoteSession } from "@/backend/remote/RemoteSession";
import type { SshPty } from "@/backend/remote/SshPty";
import type {
  RemoteConsoleEvent,
  RemoteConsoleSize,
  RemoteConsoleState,
} from "@/definition/RemoteConsole";

/** Where one shell starts: the connection, and the checked directory or `null` for the login directory. */
export interface RemoteConsoleTarget {
  readonly session: RemoteSession;
  readonly path: string | null;
}

const MAXIMUM_HISTORY = 256 * 1024;
const RETRY_DELAY = 3000;
const DIRECTORY_TIMEOUT = 15_000;
/** A shell that stays silent this long is treated as ready. */
const FIRST_OUTPUT_TIMEOUT = 5000;
const MAXIMUM_PATH = 4096;
const PTY_UNAVAILABLE = "remote.console.ptyUnavailable";
const RETRY_MESSAGES = new Set([
  "remote.failure.transport_lost",
  "remote.failure.host_unknown",
  "remote.failure.unreachable_refused",
  "remote.failure.unreachable_timeout",
  "remote.failure.unreachable_network",
  "remote.error.remote_reconnecting",
]);

/** The local terminal module or OpenSSH client could not start a terminal. */
class TerminalUnavailableError extends Error {}

/**
 * The translation key of a console failure; SSH texts never reach the browser.
 *
 * @param error - A caught error.
 * @returns A `remote.failure.*`, `remote.error.*` or `remote.console.*` key.
 */
export function consoleMessageOf(error: unknown): string {
  if (error instanceof TerminalUnavailableError) return PTY_UNAVAILABLE;
  if (!(error instanceof RemoteError)) return "remote.failure.remote_failed";
  if (error.failure) return `remote.failure.${error.failure}`;
  return `remote.error.${error.code}`;
}

/** The login directory as the machine reports it; `pwd` also proves the connection works. */
async function startDirectory(
  target: RemoteConsoleTarget,
): Promise<string | null> {
  if (target.path !== null) return target.path;
  const result = await target.session.run("pwd", DIRECTORY_TIMEOUT);
  // Start files of the login shell may print lines of their own first.
  const directory = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/"))
    .at(-1);
  return result.exitCode === 0 && directory && directory.length <= MAXIMUM_PATH
    ? directory
    : null;
}

/** Owns one person's shell, bounded replay history and reconnect budget. */
export class RemoteConsoleSession {
  private readonly target: () => Promise<RemoteConsoleTarget>;
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
    directory: null,
  };
  private generation = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private hasConnected = false;
  // Opening a console is a person's request, just like a retry.
  private isManualRetry = true;

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

  /**
   * A person's retry continues the same budget and cannot unblock ten used attempts.
   *
   * @remarks
   * Before any shell ran it connects at once; it also restarts a shared
   * connection whose own series gave up. A changed host key is never retried.
   */
  public reconnect(): void {
    if (
      this.state.status !== "blocked" ||
      this.state.attempts >= CONSOLE_MAXIMUM_RETRIES
    )
      return;
    if (this.state.message === "remote.failure.host_key_changed") return;
    this.isManualRetry = true;
    if (this.hasConnected) {
      this.scheduleRetry(this.state.message);
      return;
    }
    this.update({
      ...this.state,
      status: "connecting",
      attempts: this.state.attempts + 1,
      message: null,
    });
    void this.connect();
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
      const target = await this.target();
      if (generation !== this.generation) return;
      await this.hurrySession(target.session);
      if (generation !== this.generation) return;
      const directory = await startDirectory(target);
      if (generation !== this.generation) return;
      const terminal = await this.openTerminal(target);
      if (generation !== this.generation) {
        terminal.close();
        return;
      }
      await this.attach(terminal, generation, directory);
    } catch (error: unknown) {
      if (generation !== this.generation) return;
      this.fail(error);
    }
  }

  private async openTerminal(target: RemoteConsoleTarget): Promise<SshPty> {
    try {
      return await target.session.openPty({
        ...this.size,
        path: target.path,
        onOutput: (chunk) => this.output(chunk),
      });
    } catch (error: unknown) {
      if (error instanceof RemoteError) throw error;
      logCaughtError("RemoteConsoleSession", error);
      throw new TerminalUnavailableError();
    }
  }

  /** The shell counts as connected once it printed something without refusing the terminal. */
  private async attach(
    terminal: SshPty,
    generation: number,
    directory: string | null,
  ): Promise<void> {
    this.terminal = terminal;
    terminal.resize(this.size.columns, this.size.rows);
    void terminal.exited.then((exitCode) =>
      this.handleExit({ generation, exitCode, terminal }),
    );
    const isShell = await Promise.race([
      terminal.firstOutput,
      delay(FIRST_OUTPUT_TIMEOUT, true, { ref: false }),
    ]);
    if (
      !isShell ||
      generation !== this.generation ||
      this.terminal !== terminal
    )
      return;
    this.hasConnected = true;
    this.update({
      ...this.state,
      status: "connected",
      message: null,
      exitCode: null,
      directory,
    });
  }

  /** A person's request does not wait for the next scheduled attempt of the shared connection. */
  private async hurrySession(session: RemoteSession): Promise<void> {
    if (!this.isManualRetry) return;
    this.isManualRetry = false;
    await session.attemptNow();
  }

  /**
   * A connect that failed before any shell ran is shown at once and waits for
   * a person; an interrupted shell is retried within the budget.
   */
  private fail(error: unknown): void {
    const message = consoleMessageOf(error);
    const isRetried =
      RETRY_MESSAGES.has(message) &&
      this.hasConnected &&
      this.scheduleRetry(message);
    if (!isRetried) this.update({ ...this.state, status: "blocked", message });
  }

  private handleExit(exit: {
    readonly generation: number;
    readonly exitCode: number;
    readonly terminal: SshPty;
  }): void {
    if (exit.generation !== this.generation) return;
    this.terminal = null;
    if (exit.terminal.wasRefused()) {
      this.update({
        ...this.state,
        status: "blocked",
        message: PTY_UNAVAILABLE,
      });
      return;
    }
    if (exit.exitCode === SSH_FAILURE_EXIT_CODE) {
      const message = "remote.failure.transport_lost";
      if (!this.hasConnected || !this.scheduleRetry(message))
        this.update({ ...this.state, status: "blocked", message });
      return;
    }
    this.update({
      ...this.state,
      status: "ended",
      exitCode: exit.exitCode,
      message: null,
    });
  }

  /** Returns whether a retry is pending; the budget is never exceeded. */
  private scheduleRetry(message: string | null): boolean {
    if (this.retryTimer) return true;
    if (this.state.attempts >= CONSOLE_MAXIMUM_RETRIES) return false;
    this.update({ ...this.state, status: "reconnecting", message });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.update({ ...this.state, attempts: this.state.attempts + 1 });
      void this.connect();
    }, RETRY_DELAY);
    this.retryTimer.unref();
    return true;
  }
}
