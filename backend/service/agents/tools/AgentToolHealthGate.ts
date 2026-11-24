import { setTimeout as delay } from "node:timers/promises";

import { logEvent } from "@/backend/logging/Logger";
import { isTransientAgentToolFailure } from "@/definition/AgentTools";

import type { AgentToolId } from "@/definition/AgentTools";
import type { AgentToolDefinition } from "./AgentToolRegistry";
import type {
  AgentToolHealth,
  AgentToolHealthChecks,
  AgentToolLocation,
} from "./AgentToolContracts";

/** How long a successful check of a tool generation answers further starts. */
export const AGENT_TOOL_READY_TTL_MS = 60_000;
/** How many checks run at the same time at most; further checks wait for a free place. */
export const AGENT_TOOL_CHECK_LIMIT = 4;
/** The pause before a failure that may pass is checked once more. */
export const AGENT_TOOL_CHECK_RETRY_MS = 500;

/** Limits of the gate; tests pass short ones and their own clock. */
export interface AgentToolHealthGateOptions {
  readonly limit?: number;
  readonly readyTtlMs?: number;
  readonly retryDelayMs?: number;
  /** A monotonic clock in milliseconds. */
  readonly now?: () => number;
}

/** The generation one check starts, with the CLI an adapter runs with. */
interface CheckTarget {
  readonly tool: AgentToolDefinition;
  readonly location: AgentToolLocation;
  readonly cli: AgentToolLocation | undefined;
}

interface KeptHealth {
  readonly health: AgentToolHealth;
  readonly checkedAt: number;
}

/** What a check returns when it ended before it could run. */
const NOT_RUN: AgentToolHealth = {
  status: "failed",
  diagnostic: "execution_failed",
  version: null,
};

/**
 * Shares, bounds and repeats the functional checks of the agent tools.
 * @remarks
 * Starts that check the same tool generation at the same time share one
 * running check, and a successful result answers further starts for a
 * minute; a failure is never kept, so the next start checks again. At most
 * four checks run at once and the others wait for a free place, because the
 * process runner refuses a fifth child instead of queueing it. A failure
 * that a repeat may change, such as a probe that could not start under load,
 * is checked once more after a short pause; a missing tool, a needed sign-in
 * or an unsupported version is not repeated.
 */
export class AgentToolHealthGate implements AgentToolHealthChecks {
  private readonly checks: AgentToolHealthChecks;
  private readonly limit: number;
  private readonly readyTtlMs: number;
  private readonly retryDelayMs: number;
  private readonly now: () => number;
  private readonly running = new Map<string, Promise<AgentToolHealth>>();
  private readonly kept = new Map<string, KeptHealth>();
  private readonly waiting: (() => void)[] = [];
  private active = 0;

  public constructor(
    checks: AgentToolHealthChecks,
    options: AgentToolHealthGateOptions = {},
  ) {
    this.checks = checks;
    this.limit = options.limit ?? AGENT_TOOL_CHECK_LIMIT;
    this.readyTtlMs = options.readyTtlMs ?? AGENT_TOOL_READY_TTL_MS;
    this.retryDelayMs = options.retryDelayMs ?? AGENT_TOOL_CHECK_RETRY_MS;
    this.now = options.now ?? ((): number => performance.now());
  }

  /**
   * Answers from a fresh success, joins a running check or runs one within the limit.
   * @param tool - The tool to check.
   * @param location - The generation that is checked.
   * @param signal - Ends the check at shutdown.
   * @param cli - The CLI generation an adapter is checked with; part of the kept result.
   */
  public check(
    tool: AgentToolDefinition,
    location: AgentToolLocation,
    signal: AbortSignal,
    cli?: AgentToolLocation,
  ): Promise<AgentToolHealth> {
    const key = `${tool.id}\u0000${location.file}\u0000${cli?.file ?? ""}`;
    const kept = this.kept.get(key);
    if (kept && this.now() - kept.checkedAt < this.readyTtlMs)
      return Promise.resolve(kept.health);
    const shared = this.running.get(key);
    if (shared) return shared;
    const pending = this.repeated({ tool, location, cli }, signal).then(
      (health) => {
        if (health.status === "ready")
          this.kept.set(key, { health, checkedAt: this.now() });
        else this.kept.delete(key);
        return health;
      },
    );
    this.running.set(key, pending);
    const settle = (): void => {
      if (this.running.get(key) === pending) this.running.delete(key);
    };
    void pending.then(settle, settle);
    return pending;
  }

  /** Drops the kept successes of a tool, so an explicit check or change runs a new probe. */
  public forget(id: AgentToolId): void {
    for (const key of [...this.kept.keys()])
      if (key.startsWith(`${id}\u0000`)) this.kept.delete(key);
  }

  private async repeated(
    target: CheckTarget,
    signal: AbortSignal,
  ): Promise<AgentToolHealth> {
    const first = await this.attempt(target, signal, 1);
    if (
      first.status === "ready" ||
      !isTransientAgentToolFailure(first.diagnostic) ||
      signal.aborted
    )
      return first;
    try {
      await delay(this.retryDelayMs, undefined, { signal });
    } catch {
      // Shutdown ended the pause; the first result stands.
      return first;
    }
    return this.attempt(target, signal, 2);
  }

  private async attempt(
    target: CheckTarget,
    signal: AbortSignal,
    attempt: number,
  ): Promise<AgentToolHealth> {
    const { tool, location, cli } = target;
    if (!(await this.acquire(signal))) return NOT_RUN;
    const startedAt = this.now();
    let health: AgentToolHealth;
    try {
      health = await this.checks.check(tool, location, signal, cli);
    } finally {
      this.release();
    }
    if (health.status !== "ready")
      logEvent({
        level: "warn",
        event: "agent.tool.check_failed",
        component: "AgentToolHealthGate",
        message: "A functional check of an agent tool failed",
        metadata: {
          tool: tool.id,
          status: health.status,
          diagnostic: health.diagnostic,
          durationMs: Math.round(this.now() - startedAt),
          attempt,
          willRetry:
            attempt === 1 &&
            isTransientAgentToolFailure(health.diagnostic) &&
            !signal.aborted,
        },
      });
    return health;
  }

  /** Takes a place among the running checks; `false` when the wait was cancelled. */
  private acquire(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const admit = (): void => {
        signal.removeEventListener("abort", leave);
        this.active += 1;
        resolve(true);
      };
      const leave = (): void => {
        const index = this.waiting.indexOf(admit);
        if (index >= 0) this.waiting.splice(index, 1);
        resolve(false);
      };
      this.waiting.push(admit);
      signal.addEventListener("abort", leave, { once: true });
    });
  }

  private release(): void {
    this.active -= 1;
    this.waiting.shift()?.();
  }
}
