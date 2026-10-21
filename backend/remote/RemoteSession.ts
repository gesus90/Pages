import { RemoteError } from "@/backend/error/RemoteErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { PLAN_RETRY_DELAYS } from "@/backend/service/agents/AgentPlanStepRetry";
import { PLAN_MAXIMUM_RETRIES } from "@/definition/AgentPlanRetry";
import { isRemoteFailureCode } from "@/definition/RemoteConnection";

import { SSH_FAILURE_EXIT_CODE } from "./SshFailure";

import type {
  RemoteFailureCode,
  RemoteSessionStatus,
  RemoteSessionView,
} from "@/definition/RemoteConnection";
import type { SshClient, SshMaster, SshMasterResult } from "./SshClient";
import type { SshTarget } from "./SshOptions";
import type { SshProcessResult } from "./SshProcess";

/** What a logical connection needs from its surroundings. */
export interface RemoteSessionDependencies {
  readonly client: Pick<SshClient, "openMaster">;
  /** Reads the stored connection and its credentials again before every connect. */
  readonly target: () => Promise<SshTarget>;
  /** Records the outcome of every connect for the connection's status. */
  readonly record: (failure: RemoteFailureCode | null) => Promise<void>;
  /** How long an unused connection stays open. */
  readonly idleMilliseconds?: number;
  readonly delays?: readonly number[];
}

const DEFAULT_IDLE_MILLISECONDS = 10 * 60_000;

/**
 * Failures of a first connect that start a series: the machine is not
 * reachable yet or its host key is not confirmed yet. A confirmed key that
 * differs, a refused sign-in or a missing secret need a person's input, so
 * they are refused at once.
 */
const SERIES_FAILURES: ReadonlySet<RemoteFailureCode> = new Set([
  "host_unknown",
  "unreachable_refused",
  "unreachable_timeout",
  "unreachable_network",
  "not_ssh",
  "transport_lost",
  "host_key_unconfirmed",
  "host_key_unavailable",
]);

/**
 * The logical SSH connection of one remote connection.
 *
 * @remarks
 * It is opened when a step needs it and closed after a quiet period, so no
 * permanently open socket is assumed. While it is open, keepalive probes
 * watch the transport. A lost transport, or a first connect that fails
 * because the machine is not reachable or not confirmed yet, starts a series
 * of at most {@link PLAN_MAXIMUM_RETRIES} reconnect attempts at the growing
 * intervals of the agent plan retries; after the last failure the connection
 * stays blocked until a person starts a new series. A command whose transport
 * was lost or whose connect failed is reported as such and never repeated, so
 * no step runs twice silently.
 */
export class RemoteSession {
  private readonly dependencies: RemoteSessionDependencies;
  private status: RemoteSessionStatus = "idle";
  private master: SshMaster | null = null;
  private connecting: Promise<SshMaster> | null = null;
  private attempts = 0;
  private nextAttemptAt: string | null = null;
  private cause: RemoteFailureCode | null = null;
  private connectedAt: string | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private activeCommands = 0;
  // Each close or new series invalidates the callbacks of the previous one.
  private generation = 0;

  public constructor(dependencies: RemoteSessionDependencies) {
    this.dependencies = dependencies;
  }

  /** The state a person sees: connected, reconnecting with count, next attempt and cause, or blocked. */
  public view(): RemoteSessionView {
    return {
      status: this.status,
      attempts: this.attempts,
      maximumAttempts: PLAN_MAXIMUM_RETRIES,
      nextAttemptAt: this.nextAttemptAt,
      cause: this.cause,
      connectedAt: this.connectedAt,
    };
  }

  /**
   * Runs one command over the logical connection, opening it when needed.
   *
   * @param command - A command line for the remote POSIX shell.
   * @param timeoutMs - Time limit of the command.
   * @returns The finished command.
   * @throws {RemoteError} `remote_reconnecting` or `remote_blocked` while the
   * connection is not usable, `remote_check_failed` when it cannot be opened,
   * and `remote_transport_lost` when the transport ended during the command.
   */
  public async run(
    command: string,
    timeoutMs: number,
  ): Promise<SshProcessResult> {
    if (this.status === "reconnecting")
      throw new RemoteError("remote_reconnecting", this.cause);
    if (this.status === "blocked")
      throw new RemoteError("remote_blocked", this.cause);
    const master = await this.ensureMaster();
    this.activeCommands += 1;
    this.clearIdleTimer();
    try {
      const result = await master.run(command, timeoutMs);
      if (result.isTimedOut)
        throw new RemoteError("remote_check_failed", "unreachable_timeout");
      if (result.isUnavailable || result.exitCode === SSH_FAILURE_EXIT_CODE)
        throw new RemoteError("remote_transport_lost", "transport_lost");
      return result;
    } finally {
      this.activeCommands -= 1;
      this.scheduleIdleClose();
    }
  }

  /**
   * Starts a series after a failed first connect or a failed test of a closed connection.
   *
   * @remarks
   * Does nothing while the connection is open, opening, in a series or
   * blocked, and for a failure that needs a person's input.
   *
   * @param failure - The classified failure of the first connect.
   */
  public retryAfter(failure: RemoteFailureCode): void {
    if (this.status !== "idle" || !SERIES_FAILURES.has(failure)) return;
    this.startSeries(failure);
  }

  /** Starts a new series of reconnect attempts after a blocked series; otherwise does nothing. */
  public reconnect(): void {
    if (this.status !== "blocked") return;
    this.generation += 1;
    this.status = "reconnecting";
    this.attempts = 0;
    void this.attempt(this.generation);
  }

  /** Ends the connection and any series on purpose, for example after the connection changed. */
  public async close(): Promise<void> {
    this.generation += 1;
    this.clearIdleTimer();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const master = this.master;
    this.master = null;
    this.status = "idle";
    this.attempts = 0;
    this.nextAttemptAt = null;
    this.cause = null;
    this.connectedAt = null;
    await master?.close();
  }

  private async ensureMaster(): Promise<SshMaster> {
    if (this.master) return this.master;
    this.connecting ??= this.connectFirst();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  /** A first connect fails the step at once; an unreachable or unconfirmed machine also starts a series. */
  private async connectFirst(): Promise<SshMaster> {
    const generation = this.generation;
    this.status = "connecting";
    const opened = await this.open();
    if (generation !== this.generation) {
      await opened.master?.close();
      throw new RemoteError("remote_transport_lost", "transport_lost");
    }
    if (opened.master === null) {
      this.status = "idle";
      this.cause = opened.failure;
      this.retryAfter(opened.failure);
      throw new RemoteError("remote_check_failed", opened.failure);
    }
    this.attach(opened.master);
    return opened.master;
  }

  private async open(): Promise<SshMasterResult> {
    let opened: SshMasterResult;
    try {
      opened = await this.dependencies.client.openMaster(
        await this.dependencies.target(),
      );
    } catch (error: unknown) {
      logCaughtError("RemoteSession", error);
      const failure =
        error instanceof RemoteError && isRemoteFailureCode(error.failure)
          ? error.failure
          : "remote_failed";
      opened = { master: null, failure };
    }
    await this.record(opened.failure);
    return opened;
  }

  private attach(master: SshMaster): void {
    const generation = this.generation;
    this.master = master;
    this.status = "connected";
    this.connectedAt = new Date().toISOString();
    this.attempts = 0;
    this.nextAttemptAt = null;
    this.cause = null;
    this.scheduleIdleClose();
    void master.exited.then(() => this.handleExit(master, generation));
  }

  private handleExit(master: SshMaster, generation: number): void {
    if (this.master !== master || generation !== this.generation) return;
    this.master = null;
    this.connectedAt = null;
    this.clearIdleTimer();
    this.startSeries("transport_lost");
  }

  private startSeries(cause: RemoteFailureCode): void {
    this.status = "reconnecting";
    this.attempts = 0;
    this.cause = cause;
    this.scheduleAttempt();
  }

  private scheduleAttempt(): void {
    const delays = this.dependencies.delays ?? PLAN_RETRY_DELAYS;
    const delay = delays[Math.min(this.attempts, delays.length - 1)];
    const generation = this.generation;
    this.nextAttemptAt = new Date(Date.now() + delay).toISOString();
    this.retryTimer = setTimeout(() => {
      void this.attempt(generation);
    }, delay);
    this.retryTimer.unref();
  }

  private async attempt(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    this.retryTimer = null;
    this.nextAttemptAt = null;
    const opened = await this.open();
    if (generation !== this.generation) {
      await opened.master?.close();
      return;
    }
    if (opened.master !== null) {
      this.attach(opened.master);
      return;
    }
    this.attempts += 1;
    this.cause = opened.failure;
    if (this.attempts >= PLAN_MAXIMUM_RETRIES) {
      this.status = "blocked";
      return;
    }
    this.scheduleAttempt();
  }

  private async record(failure: RemoteFailureCode | null): Promise<void> {
    try {
      await this.dependencies.record(failure);
    } catch (error: unknown) {
      logCaughtError("RemoteSession", error);
    }
  }

  private scheduleIdleClose(): void {
    this.clearIdleTimer();
    if (this.activeCommands > 0 || this.master === null) return;
    this.idleTimer = setTimeout(() => {
      if (this.activeCommands === 0) void this.close();
    }, this.dependencies.idleMilliseconds ?? DEFAULT_IDLE_MILLISECONDS);
    this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
