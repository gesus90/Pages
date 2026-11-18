import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import type { ClaudeQuotaRepository } from "@/backend/database/repositories/agent/ClaudeQuotaRepository";
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

/** Failures that mean "not queryable now", not "the query failed". */
const SKIPPED_CODES: ReadonlySet<AgentErrorCode> = new Set<AgentErrorCode>([
  "cli_not_logged_in",
  "check_in_progress",
]);

/**
 * The result of one usage query of a connection: read and stored, not
 * queryable now (not signed in, or a native session holds the sign-in), or
 * failed with a code.
 */
export type ClaudeQuotaProbeOutcome =
  | { readonly status: "read" }
  | { readonly status: "skipped" }
  | { readonly status: "failed"; readonly errorCode: AgentErrorCode };

interface ClaudeQuotaProbeDependencies {
  readonly reader: Pick<AgentCliRuntime, "readClaudeUsage">;
  readonly repository: Pick<
    ClaudeQuotaRepository,
    "replaceWindows" | "savePlan"
  >;
  readonly clock?: () => Date;
}

interface FinishedProbe {
  readonly at: number;
  readonly outcome: ClaudeQuotaProbeOutcome;
}

/**
 * Asks Claude for the current subscription usage of a connection and stores it.
 * @remarks
 * The query is the `/usage` data of Claude Code, read through a control
 * request without a prompt, so it starts no model answer. A connection has
 * at most one query at a time; requests during a query and shortly after it
 * share its result.
 */
export class ClaudeQuotaProbe {
  private readonly dependencies: ClaudeQuotaProbeDependencies;
  private readonly running = new Map<
    string,
    Promise<ClaudeQuotaProbeOutcome>
  >();
  private readonly finished = new Map<string, FinishedProbe>();

  public constructor(dependencies: ClaudeQuotaProbeDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Queries the usage of a connection, or shares a running or recent query.
   * @param connection - An active Claude Code connection the reader may use.
   * @returns The outcome; it never throws.
   */
  public refresh(
    connection: AgentConnectionRecord,
  ): Promise<ClaudeQuotaProbeOutcome> {
    const recent = this.finished.get(connection.id);
    if (recent && this.now().getTime() - recent.at < REUSE_MILLISECONDS)
      return Promise.resolve(recent.outcome);
    const running = this.running.get(connection.id);
    if (running) return running;
    const probe = this.probe(connection).finally(() => {
      this.running.delete(connection.id);
    });
    this.running.set(connection.id, probe);
    return probe;
  }

  private async probe(
    connection: AgentConnectionRecord,
  ): Promise<ClaudeQuotaProbeOutcome> {
    const outcome = await this.read(connection);
    this.finished.set(connection.id, { at: this.now().getTime(), outcome });
    return outcome;
  }

  private async read(
    connection: AgentConnectionRecord,
  ): Promise<ClaudeQuotaProbeOutcome> {
    const { reader, repository } = this.dependencies;
    try {
      const reading = await reader.readClaudeUsage(
        connection,
        AbortSignal.timeout(PROBE_TIMEOUT_MILLISECONDS),
      );
      const observedAt = this.now().toISOString();
      await repository.savePlan(connection.id, reading.plan, observedAt);
      if (reading.windows !== null)
        await repository.replaceWindows(
          connection.id,
          reading.windows,
          observedAt,
        );
      return { status: "read" };
    } catch (error: unknown) {
      if (error instanceof AgentError && SKIPPED_CODES.has(error.code))
        return { status: "skipped" };
      logCaughtError("ClaudeQuotaProbe", error);
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
