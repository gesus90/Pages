import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import type { AgentToolUpdateSearch } from "./AgentToolUpdateSearch";

/** Server-wide daily interval for compatible agent tool release checks. */
export const AGENT_TOOL_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

const MAX_TIMER_DELAY_MS = 60 * 60 * 1_000;
const BUSY_RETRY_MS = 60_000;
const MIN_TIMER_DELAY_MS = 1_000;

/** Timing and clock overrides; tests pass short intervals and a controlled clock. */
export interface AgentToolUpdateSchedulerOptions {
  readonly intervalMs?: number;
  readonly maxDelayMs?: number;
  readonly busyRetryMs?: number;
  /** Epoch clock in milliseconds. */
  readonly now?: () => number;
}

/**
 * Triggers a server-wide agent tool update search once per day in the background.
 * @remarks
 * Reuses the shared update search and its persisted timestamp and cross-process
 * lock, so restarts within the daily interval and parallel manual searches do
 * not trigger duplicate automatic searches. Searching never installs or activates
 * any tool generation.
 */
export class AgentToolUpdateScheduler {
  private readonly updates: Pick<
    AgentToolUpdateSearch,
    "restore" | "searchedAt" | "isDue" | "searchIfDue"
  >;
  private readonly intervalMs: number;
  private readonly maxDelayMs: number;
  private readonly busyRetryMs: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private pendingRun: Promise<boolean> | null = null;
  private controller = new AbortController();
  private isRunning = false;

  public constructor(
    updates: Pick<
      AgentToolUpdateSearch,
      "restore" | "searchedAt" | "isDue" | "searchIfDue"
    >,
    options: AgentToolUpdateSchedulerOptions = {},
  ) {
    this.updates = updates;
    this.intervalMs = options.intervalMs ?? AGENT_TOOL_UPDATE_INTERVAL_MS;
    this.maxDelayMs = options.maxDelayMs ?? MAX_TIMER_DELAY_MS;
    this.busyRetryMs = options.busyRetryMs ?? BUSY_RETRY_MS;
    this.now = options.now ?? ((): number => Date.now());
  }

  /** Starts the background daily schedule without blocking server startup. */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.controller = new AbortController();
    void this.tick();
  }

  /**
   * Checks once whether the daily interval elapsed and runs the release search if due.
   * @returns `true` when this call performed a fresh update search.
   */
  public async runIfDue(): Promise<boolean> {
    if (this.pendingRun !== null) return this.pendingRun;
    const operation = this.execute();
    this.pendingRun = operation;
    try {
      return await operation;
    } finally {
      if (this.pendingRun === operation) this.pendingRun = null;
    }
  }

  /** Stops future ticks, aborts an active automatic search and waits for it to settle. */
  public async shutdown(): Promise<void> {
    this.isRunning = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.controller.abort();
    await this.pendingRun;
  }

  private async tick(): Promise<void> {
    await this.runIfDue();
    if (!this.isRunning) return;
    this.armTimer();
  }

  private async execute(): Promise<boolean> {
    try {
      await this.updates.restore();
      if (this.controller.signal.aborted) return false;
      return await this.updates.searchIfDue(
        this.controller.signal,
        this.intervalMs,
      );
    } catch (error: unknown) {
      logCaughtError("AgentToolUpdateScheduler", error);
      logDiagnostic(
        "AgentToolUpdateScheduler",
        "warn",
        "Pages daily agent tool update search could not complete.",
      );
      return false;
    }
  }

  private armTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    const delayMs = this.nextDelayMs();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delayMs);
    this.timer.unref();
  }

  private nextDelayMs(): number {
    if (this.updates.isDue(this.intervalMs))
      return Math.min(this.busyRetryMs, this.maxDelayMs);
    const searchedAt = this.updates.searchedAt();
    if (searchedAt === null) return Math.min(this.busyRetryMs, this.maxDelayMs);
    const remaining = Date.parse(searchedAt) + this.intervalMs - this.now();
    if (!Number.isFinite(remaining) || remaining <= 0)
      return Math.min(this.busyRetryMs, this.maxDelayMs);
    return Math.max(MIN_TIMER_DELAY_MS, Math.min(remaining, this.maxDelayMs));
  }
}
