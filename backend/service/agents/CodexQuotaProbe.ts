import { ProviderQuotaProbe } from "./ProviderQuotaProbe";

import type { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { CodexQuotaRepository } from "@/backend/database/repositories/agent/CodexQuotaRepository";
import type { QuotaProbeOutcome } from "./ProviderQuotaProbe";

interface CodexQuotaProbeDependencies {
  readonly reader: Pick<AgentCliRuntime, "readCodexUsage">;
  readonly repository: Pick<CodexQuotaRepository, "replaceReading">;
  readonly clock?: () => Date;
}

/**
 * Asks Codex for the general quota of a connection and stores it.
 * @remarks
 * The query is `account/rateLimits/read` of the Codex app server of the
 * connection's own ChatGPT login. It starts no thread and no turn, so it
 * uses none of the quota it reads, and a session of the same connection does
 * not keep it from asking: the reader gives such a query a private home with
 * a copy of the login. The scheduling of the queries is that of
 * {@link ProviderQuotaProbe}.
 */
export class CodexQuotaProbe {
  private readonly dependencies: CodexQuotaProbeDependencies;
  private readonly probe: ProviderQuotaProbe;

  public constructor(dependencies: CodexQuotaProbeDependencies) {
    this.dependencies = dependencies;
    this.probe = new ProviderQuotaProbe({
      component: "CodexQuotaProbe",
      clock: dependencies.clock,
      query: (connection, signal) => this.query(connection, signal),
    });
  }

  /**
   * Queries the quota of a connection, or shares a running or recent query.
   * @param connection - An active Codex connection the reader may use.
   * @returns The outcome; it never throws.
   */
  public refresh(
    connection: AgentConnectionRecord,
  ): Promise<QuotaProbeOutcome> {
    return this.probe.refresh(connection);
  }

  private async query(
    connection: AgentConnectionRecord,
    signal: AbortSignal,
  ): Promise<void> {
    const { reader, repository } = this.dependencies;
    const reading = await reader.readCodexUsage(connection, signal);
    await repository.replaceReading(
      connection.id,
      reading,
      this.now().toISOString(),
    );
  }

  private now(): Date {
    return (this.dependencies.clock ?? (() => new Date()))();
  }
}
