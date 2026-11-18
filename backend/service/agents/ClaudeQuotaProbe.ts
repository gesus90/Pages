import { ProviderQuotaProbe } from "./ProviderQuotaProbe";

import type { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import type { ClaudeQuotaRepository } from "@/backend/database/repositories/agent/ClaudeQuotaRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { QuotaProbeOutcome } from "./ProviderQuotaProbe";

/** The result of one usage query of a Claude connection, see {@link QuotaProbeOutcome}. */
export type ClaudeQuotaProbeOutcome = QuotaProbeOutcome;

interface ClaudeQuotaProbeDependencies {
  readonly reader: Pick<AgentCliRuntime, "readClaudeUsage">;
  readonly repository: Pick<
    ClaudeQuotaRepository,
    "replaceWindows" | "savePlan"
  >;
  readonly clock?: () => Date;
}

/**
 * Asks Claude for the current subscription usage of a connection and stores it.
 * @remarks
 * The query is the `/usage` data of Claude Code, read through a control
 * request without a prompt, so it starts no model answer. A running session
 * of the same connection does not keep it from asking: the reader gives such
 * a query a private home with a copy of the login and hands a refreshed login
 * back only while the connection's own file is unchanged, so the query cannot
 * invalidate the session's sign-in. The scheduling of the queries is that of
 * {@link ProviderQuotaProbe}.
 */
export class ClaudeQuotaProbe {
  private readonly dependencies: ClaudeQuotaProbeDependencies;
  private readonly probe: ProviderQuotaProbe;

  public constructor(dependencies: ClaudeQuotaProbeDependencies) {
    this.dependencies = dependencies;
    this.probe = new ProviderQuotaProbe({
      component: "ClaudeQuotaProbe",
      clock: dependencies.clock,
      query: (connection, signal) => this.query(connection, signal),
    });
  }

  /**
   * Queries the usage of a connection, or shares a running or recent query.
   * @param connection - An active Claude Code connection the reader may use.
   * @returns The outcome; it never throws.
   */
  public refresh(
    connection: AgentConnectionRecord,
  ): Promise<ClaudeQuotaProbeOutcome> {
    return this.probe.refresh(connection);
  }

  private async query(
    connection: AgentConnectionRecord,
    signal: AbortSignal,
  ): Promise<void> {
    const { reader, repository } = this.dependencies;
    const reading = await reader.readClaudeUsage(connection, signal);
    const observedAt = this.now().toISOString();
    await repository.savePlan(connection.id, reading.plan, observedAt);
    if (reading.windows !== null)
      await repository.replaceWindows(
        connection.id,
        reading.windows,
        observedAt,
      );
  }

  private now(): Date {
    return (this.dependencies.clock ?? (() => new Date()))();
  }
}
