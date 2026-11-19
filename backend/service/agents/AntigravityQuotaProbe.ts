import { ProviderQuotaProbe } from "./ProviderQuotaProbe";

import type { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import type { AntigravityQuotaRepository } from "@/backend/database/repositories/agent/AntigravityQuotaRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { QuotaProbeOutcome } from "./ProviderQuotaProbe";
import type { QuotaMeasurementService } from "./QuotaMeasurementService";

interface AntigravityQuotaProbeDependencies {
  readonly reader: Pick<AgentCliRuntime, "readAntigravityUsage">;
  readonly repository: Pick<AntigravityQuotaRepository, "replaceReading">;
  readonly measurements: Pick<QuotaMeasurementService, "record">;
  readonly clock?: () => Date;
}

/**
 * Asks Antigravity for the current quota groups of a connection and stores them.
 * @remarks
 * The query is the CLI's print-mode `/usage` command in the connection's own
 * sign-in context, a command that answers without a model turn, so a query
 * uses none of the quota it reads. A connection whose session is running is not asked,
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

  /** Returns the last failed query while stored figures are being reopened. */
  public latestFailure(connectionId: string): QuotaProbeOutcome | null {
    return this.probe.latestFailure(connectionId);
  }

  private async query(
    connection: AgentConnectionRecord,
    signal: AbortSignal,
  ): Promise<void> {
    const { reader, repository } = this.dependencies;
    const groups = await reader.readAntigravityUsage(connection, signal);
    const observedAt = this.now().toISOString();
    await this.dependencies.measurements.record({
      connectionId: connection.id,
      credentialRevision: connection.cliLoggedInAt,
      at: observedAt,
      reading: { provider: "antigravity", groups },
    });
    await repository.replaceReading(connection.id, groups, observedAt);
  }

  private now(): Date {
    return (this.dependencies.clock ?? (() => new Date()))();
  }
}
