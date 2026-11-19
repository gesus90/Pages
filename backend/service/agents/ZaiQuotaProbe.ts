import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { ProviderQuotaProbe } from "./ProviderQuotaProbe";
import { credentialRevision } from "./QuotaCredentialRevision";

import type { ZaiProvider } from "@/backend/agents/providers/ZaiProvider";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { ZaiQuotaReading } from "@/definition/ZaiQuota";
import type { QuotaProbeOutcome } from "./ProviderQuotaProbe";

/** How many readings the probe keeps; the oldest one goes first. */
const MAX_STORED_READINGS = 500;

interface ZaiQuotaProbeDependencies {
  readonly connections: Pick<AgentConnectionRepository, "findSecretEncrypted">;
  readonly cipher: Pick<InstanceSecretCipher, "decrypt">;
  readonly provider: Pick<ZaiProvider, "readQuota">;
  readonly clock?: () => Date;
}

/** The last answer of the usage monitor for a key and the time it came. */
export interface ZaiStoredReading extends ZaiQuotaReading {
  readonly at: string;
}

/**
 * Asks the usage monitor of Z.AI for the quota of a connection and keeps the last answer.
 * @remarks
 * The query is one authenticated `GET` with the key of the connection. It
 * starts no model turn and so uses none of the allowance it reads, and a
 * running answer of the same connection is neither waited for nor
 * interrupted. The last good answer stays in memory beside the stored key's
 * fingerprint, so a failed query keeps the figures with the time of the last
 * answer, and a replaced key never shows the figures of the old one. A key
 * the monitor rejects drops its answer, because nothing it said holds any
 * more. The scheduling of the queries is that of {@link ProviderQuotaProbe}.
 */
export class ZaiQuotaProbe {
  private readonly dependencies: ZaiQuotaProbeDependencies;
  private readonly probe: ProviderQuotaProbe;
  private readonly readings = new Map<string, ZaiStoredReading>();

  public constructor(dependencies: ZaiQuotaProbeDependencies) {
    this.dependencies = dependencies;
    this.probe = new ProviderQuotaProbe({
      component: "ZaiQuotaProbe",
      clock: dependencies.clock,
      query: (connection, signal) => this.query(connection, signal),
    });
  }

  /**
   * Queries the quota of a connection, or shares a running or recent query.
   * @param connection - An active Z.AI connection the reader may use.
   * @returns The outcome; it never throws.
   */
  public refresh(
    connection: AgentConnectionRecord,
  ): Promise<QuotaProbeOutcome> {
    return this.probe.refresh(connection);
  }

  /**
   * The last answer for the key a connection holds now, without asking Z.AI.
   * @param connectionId - The connection.
   * @returns The answer, or `null` when there is none for the current key.
   */
  public async stored(connectionId: string): Promise<ZaiStoredReading | null> {
    const encrypted =
      await this.dependencies.connections.findSecretEncrypted(connectionId);
    if (encrypted === null) return null;
    return (
      this.readings.get(credentialRevision(connectionId, encrypted)) ?? null
    );
  }

  private async query(
    connection: AgentConnectionRecord,
    signal: AbortSignal,
  ): Promise<void> {
    const { connections, provider } = this.dependencies;
    const encrypted = await connections.findSecretEncrypted(connection.id);
    if (encrypted === null) throw new AgentError("api_key_required");
    const revision = credentialRevision(connection.id, encrypted);
    const result = await provider.readQuota(
      this.decrypt(connection.id, encrypted),
      signal,
    );
    if (result.ok) {
      this.keep(revision, { ...result.value, at: this.now().toISOString() });
      return;
    }
    if (
      result.errorCode === "provider_auth_failed" ||
      result.errorCode === "provider_permission_denied"
    )
      this.readings.delete(revision);
    throw new AgentError(result.errorCode);
  }

  /** A key that cannot be decrypted is as unusable as one the provider rejects. */
  private decrypt(connectionId: string, encrypted: string): string {
    try {
      const key = this.dependencies.cipher.decrypt(connectionId, encrypted);
      if (key) return key;
    } catch (error: unknown) {
      logCaughtError("ZaiQuotaProbe", error);
      throw new AgentError("provider_auth_failed");
    }
    throw new AgentError("api_key_required");
  }

  private keep(revision: string, reading: ZaiStoredReading): void {
    this.readings.delete(revision);
    if (this.readings.size >= MAX_STORED_READINGS) {
      const oldest = this.readings.keys().next().value;
      if (oldest !== undefined) this.readings.delete(oldest);
    }
    this.readings.set(revision, reading);
  }

  private now(): Date {
    return (this.dependencies.clock ?? (() => new Date()))();
  }
}
