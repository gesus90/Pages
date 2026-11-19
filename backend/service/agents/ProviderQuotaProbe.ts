import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";

/** Upper bound of one query, beyond the CLI's own stage timeout. */
const PROBE_TIMEOUT_MILLISECONDS = 30_000;

/**
 * How long a finished query answers further requests of the same connection.
 * @remarks
 * Several open pages share one query instead of starting a CLI each, while
 * every minute push still reads anew.
 */
const REUSE_MILLISECONDS = 10_000;

/**
 * How many CLIs the probe runs at once, whatever the number of cards and
 * pages asking.
 * @remarks
 * Queries beyond it wait for a free place, so a page with many cards never
 * starts a burst of CLIs, while one slow connection holds only one place.
 */
const MAX_PARALLEL_QUERIES = 3;

/**
 * Failures that mean "no sign-in to ask with", not "the query failed": the
 * connection was never signed in or has no key, or the provider rejected its
 * sign-in or key. Another attempt cannot help until someone signs in again
 * or replaces the key.
 */
const SIGNED_OUT_CODES: ReadonlySet<AgentErrorCode> = new Set<AgentErrorCode>([
  "cli_not_logged_in",
  "cli_auth_failed",
  "api_key_required",
  "provider_auth_failed",
  "provider_permission_denied",
]);

/** A provider whose running session holds the sign-in exclusively names it so; Pages then does not ask. */
const BUSY_CODE: AgentErrorCode = "check_in_progress";

/**
 * The result of one usage query of a connection: read and stored, not asked
 * because a running session holds the sign-in (`busy`; Claude and Codex
 * queries run beside a session and never end so), not askable without
 * a sign-in (`signed_out`), or failed with a code.
 */
export type QuotaProbeOutcome =
  | { readonly status: "read" }
  | { readonly status: "busy" }
  | { readonly status: "signed_out" }
  | { readonly status: "failed"; readonly errorCode: AgentErrorCode };

interface ProviderQuotaProbeDependencies {
  /**
   * Asks the provider about a connection and stores the answer.
   * @throws {AgentError} The failure of the query.
   */
  readonly query: (
    connection: AgentConnectionRecord,
    signal: AbortSignal,
  ) => Promise<void>;
  /** Names the probe in the log. */
  readonly component: string;
  readonly clock?: () => Date;
}

interface FinishedProbe {
  readonly at: number;
  readonly outcome: QuotaProbeOutcome;
}

/**
 * Runs the usage queries of one provider: one at a time per connection,
 * a few CLIs side by side.
 * @remarks
 * A connection has at most one query at a time; requests during a query and
 * shortly after it share its result. A skipped query is tried again because
 * the session may have ended meanwhile. Different connections are queried
 * side by side, up to a fixed number of CLIs at once.
 */
export class ProviderQuotaProbe {
  private readonly dependencies: ProviderQuotaProbeDependencies;
  private readonly running = new Map<string, Promise<QuotaProbeOutcome>>();
  private readonly finished = new Map<string, FinishedProbe>();
  private readonly waitingQueries: Array<() => void> = [];
  private activeQueries = 0;

  public constructor(dependencies: ProviderQuotaProbeDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Queries the usage of a connection, or shares a running or recent query.
   * @param connection - An active connection the reader may use.
   * @returns The outcome; it never throws.
   */
  public refresh(
    connection: AgentConnectionRecord,
  ): Promise<QuotaProbeOutcome> {
    const recent = this.finished.get(connection.id);
    if (
      recent &&
      recent.outcome.status !== "busy" &&
      this.now().getTime() - recent.at < REUSE_MILLISECONDS
    )
      return Promise.resolve(recent.outcome);
    const running = this.running.get(connection.id);
    if (running) return running;
    const probe = this.probe(connection).finally(() => {
      this.running.delete(connection.id);
    });
    this.running.set(connection.id, probe);
    return probe;
  }

  /** Keeps a failed or skipped status when a card reopens. */
  public latestMissedReading(connectionId: string): QuotaProbeOutcome | null {
    const outcome = this.finished.get(connectionId)?.outcome;
    return outcome?.status === "failed" || outcome?.status === "busy"
      ? outcome
      : null;
  }

  private async probe(
    connection: AgentConnectionRecord,
  ): Promise<QuotaProbeOutcome> {
    await this.takePlace();
    try {
      const outcome = await this.read(connection);
      this.finished.set(connection.id, { at: this.now().getTime(), outcome });
      return outcome;
    } finally {
      this.freePlace();
    }
  }

  private takePlace(): Promise<void> {
    if (this.activeQueries < MAX_PARALLEL_QUERIES) {
      this.activeQueries += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waitingQueries.push(resolve);
    });
  }

  private freePlace(): void {
    const next = this.waitingQueries.shift();
    // A waiting query takes over the place, so the count stays.
    if (next) next();
    else this.activeQueries -= 1;
  }

  private async read(
    connection: AgentConnectionRecord,
  ): Promise<QuotaProbeOutcome> {
    try {
      await this.dependencies.query(
        connection,
        AbortSignal.timeout(PROBE_TIMEOUT_MILLISECONDS),
      );
      return { status: "read" };
    } catch (error: unknown) {
      if (error instanceof AgentError && error.code === BUSY_CODE)
        return { status: "busy" };
      if (error instanceof AgentError && SIGNED_OUT_CODES.has(error.code))
        return { status: "signed_out" };
      logCaughtError(this.dependencies.component, error);
      return {
        status: "failed",
        errorCode:
          error instanceof AgentError ? error.code : "cli_check_failed",
      };
    }
  }

  private now(): Date {
    return (this.dependencies.clock ?? (() => new Date()))();
  }
}
