import { ProviderQuotaProbe } from "./ProviderQuotaProbe";

import type { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import type { AntigravityQuotaRepository } from "@/backend/database/repositories/agent/AntigravityQuotaRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { QuotaProbeOutcome } from "./ProviderQuotaProbe";

interface AntigravityQuotaProbeDependencies {
  readonly reader: Pick<AgentCliRuntime, "readAntigravityUsage">;
  readonly repository: Pick<AntigravityQuotaRepository, "replaceReading">;
  readonly clock?: () => Date;
}

/**
 * Asks Antigravity for the current quota groups of a connection and stores them.
 * @remarks
 * The query is the `/usage` command of the connection's own ACP session
 * context, a command that answers without a model turn, so a query uses none
 * of the quota it reads. A connection whose session is running is not asked,
 * so a running answer finishes undisturbed. The scheduling of the queries is
 * that of {@link ProviderQuotaProbe}.
 */
export class AntigravityQuotaProbe {
  private readonly dependencies: AntigravityQuotaProbeDependencies;
  private readonly probe: ProviderQuotaProbe;

  public constructor(dependencies: AntigravityQuotaProbeDependencies) {
    this.dependencies = dependencies;
    this.probe = new ProviderQuotaProbe({
      component: "AntigravityQuotaProbe",
      clock: dependencies.clock,
      query: (connection, signal) => this.query(connection, signal),
    });
  }

  /**
   * Queries the quota of a connection, or shares a running or recent query.
   * @param connection - An active Antigravity connection the reader may use.
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
    const groups = await reader.readAntigravityUsage(connection, signal);
    await repository.replaceReading(
      connection.id,
      groups,
      this.now().toISOString(),
    );
  }

  private now(): Date {
    return (this.dependencies.clock ?? (() => new Date()))();
  }
}
