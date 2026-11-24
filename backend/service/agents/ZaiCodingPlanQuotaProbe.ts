import { ProviderQuotaProbe } from "./ProviderQuotaProbe";

import type { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import type {
  ZaiCodingPlanUsage,
  ZaiCodingPlanUsageClient,
} from "@/backend/agents/providers/ZaiCodingPlanUsageClient";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { QuotaProbeOutcome } from "./ProviderQuotaProbe";
import type { QuotaMeasurementService } from "./QuotaMeasurementService";

/** How many connections keep their last reading; older ones are dropped first. */
const MAX_KEPT_READINGS = 500;

interface ZaiCodingPlanQuotaProbeDependencies {
  readonly reader: Pick<AgentCliRuntime, "readZaiCodingPlanKey">;
  readonly client: Pick<ZaiCodingPlanUsageClient, "read">;
  readonly measurements: Pick<QuotaMeasurementService, "record">;
  readonly clock?: () => Date;
}

/** The last answer of Z.AI for a connection and the key it was read with. */
export interface ZaiCodingPlanReading {
  readonly usage: ZaiCodingPlanUsage;
  /** ISO time of Z.AI's answer. */
  readonly reportedAt: string;
}

interface KeptReading extends ZaiCodingPlanReading {
  /** The confirmation time of the stored key, so a new key never shows old figures. */
  readonly keyRevision: string | null;
}

/**
 * Asks Z.AI for the quota of an OpenCode connection with a Coding Plan key
 * and keeps the last answer.
 * @remarks
 * The query is the model-free GET of the official usage client with the
 * connection's own encrypted key, read on the server; it starts no turn and
 * no OpenCode process, so a running answer of the same connection is neither
 * a reason to skip it nor disturbed by it. The last answer is kept in memory
 * per connection and stays valid only for the key it was read with, so a
 * failed query can show it with its time. Each answer also feeds the shared
 * consumption measurement that gives the windows their forecast. The
 * scheduling of the queries is that of {@link ProviderQuotaProbe}.
 */
export class ZaiCodingPlanQuotaProbe {
  private readonly dependencies: ZaiCodingPlanQuotaProbeDependencies;
  private readonly probe: ProviderQuotaProbe;
  private readonly readings = new Map<string, KeptReading>();

  public constructor(dependencies: ZaiCodingPlanQuotaProbeDependencies) {
    this.dependencies = dependencies;
    this.probe = new ProviderQuotaProbe({
      component: "ZaiCodingPlanQuotaProbe",
      clock: dependencies.clock,
      query: (connection, signal) => this.query(connection, signal),
    });
  }

  /**
   * Queries the quota of a connection, or shares a running or recent query.
   * @param connection - An active Coding Plan connection the reader may use.
   * @returns The outcome; it never throws.
   */
  public refresh(
    connection: AgentConnectionRecord,
  ): Promise<QuotaProbeOutcome> {
    return this.probe.refresh(connection);
  }

  /** Returns the last failed query while kept figures are being reopened. */
  public latestFailure(connectionId: string): QuotaProbeOutcome | null {
    return this.probe.latestMissedReading(connectionId);
  }

  /**
   * The last answer for the connection's current key.
   * @param connection - The connection as stored now.
   * @returns The answer, or `null` when there is none for this key.
   */
  public latest(
    connection: AgentConnectionRecord,
  ): ZaiCodingPlanReading | null {
    const kept = this.readings.get(connection.id);
    if (!kept || kept.keyRevision !== connection.cliLoggedInAt) return null;
    return { usage: kept.usage, reportedAt: kept.reportedAt };
  }

  private async query(
    connection: AgentConnectionRecord,
    signal: AbortSignal,
  ): Promise<void> {
    const { reader, client, measurements } = this.dependencies;
    const apiKey = await reader.readZaiCodingPlanKey(connection);
    const usage = await client.read(apiKey, signal);
    const reportedAt = this.now().toISOString();
    await measurements.record({
      connectionId: connection.id,
      credentialRevision: connection.cliLoggedInAt,
      at: reportedAt,
      reading: { provider: "zai_coding_plan", windows: usage.windows },
    });
    this.keep(connection.id, {
      usage,
      reportedAt,
      keyRevision: connection.cliLoggedInAt,
    });
  }

  private keep(connectionId: string, reading: KeptReading): void {
    this.readings.delete(connectionId);
    if (this.readings.size >= MAX_KEPT_READINGS) {
      const oldest = this.readings.keys().next().value;
      if (oldest !== undefined) this.readings.delete(oldest);
    }
    this.readings.set(connectionId, reading);
  }

  private now(): Date {
    return (this.dependencies.clock ?? (() => new Date()))();
  }
}
