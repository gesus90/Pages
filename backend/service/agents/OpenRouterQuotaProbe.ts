import { credentialRevision } from "./QuotaCredentialRevision";

import type { OpenRouterProvider } from "@/backend/agents/providers/OpenRouterProvider";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { OpenRouterQuotaAccount } from "@/definition/OpenRouterQuota";

const READ_TIMEOUT_MILLISECONDS = 15_000;
const MAX_CACHED_REVISIONS = 500;

type KeyQuota = OpenRouterQuotaAccount["key"];
type AccountCredits = Extract<
  OpenRouterQuotaAccount["credits"],
  { mode: "account" }
>;
type CreditQuota = Omit<AccountCredits, "mode">;

interface OpenRouterQuotaProbeDependencies {
  readonly connections: Pick<AgentConnectionRepository, "findSecretEncrypted">;
  readonly cipher: Pick<InstanceSecretCipher, "decrypt">;
  readonly provider: Pick<OpenRouterProvider, "readUsage" | "readCredits">;
}

interface ReadingCache<Reading> {
  readonly pending: Map<string, Promise<Reading>>;
  readonly latest: Map<string, Reading>;
}

function isRejectedKey(errorCode: AgentErrorCode): boolean {
  return (
    errorCode === "provider_auth_failed" ||
    errorCode === "provider_permission_denied"
  );
}

function refreshReading<Reading>(
  cache: ReadingCache<Reading>,
  revision: string,
  read: (previous: Reading | undefined) => Promise<Reading>,
): Promise<Reading> {
  const pending = cache.pending.get(revision);
  if (pending) return pending;
  const request = read(cache.latest.get(revision)).then((reading) => {
    cache.latest.delete(revision);
    if (cache.latest.size >= MAX_CACHED_REVISIONS) {
      const oldest = cache.latest.keys().next().value;
      if (oldest !== undefined) cache.latest.delete(oldest);
    }
    cache.latest.set(revision, reading);
    return reading;
  });
  const completed = request.finally(() => {
    cache.pending.delete(revision);
  });
  cache.pending.set(revision, completed);
  return completed;
}

/** Reads OpenRouter quota over HTTP and retains the last readings for each connection revision. */
export class OpenRouterQuotaProbe {
  private readonly dependencies: OpenRouterQuotaProbeDependencies;
  private readonly keys: ReadingCache<KeyQuota> = {
    pending: new Map(),
    latest: new Map(),
  };
  private readonly credits: ReadingCache<CreditQuota> = {
    pending: new Map(),
    latest: new Map(),
  };

  public constructor(dependencies: OpenRouterQuotaProbeDependencies) {
    this.dependencies = dependencies;
  }

  /** Returns the cached key quota without contacting OpenRouter. */
  public async keyQuota(id: string): Promise<KeyQuota> {
    const encrypted =
      await this.dependencies.connections.findSecretEncrypted(id);
    if (encrypted === null) return { status: "invalid_key", reading: null };
    return (
      this.keys.latest.get(credentialRevision(id, encrypted)) ?? {
        status: "stored",
        reading: null,
      }
    );
  }

  /** Returns cached credits to the authorized quota service. */
  public creditQuota(id: string, encrypted: string | null): CreditQuota {
    if (encrypted === null) return { status: "missing_key", reading: null };
    const cached = this.credits.latest.get(credentialRevision(id, encrypted));
    if (!cached) return { status: "stored", reading: null };
    if (cached.status === "unknown") return { ...cached, reading: null };
    return cached;
  }

  /** Refreshes the regular API key reading independently of any model session. */
  public async refreshKey(id: string): Promise<void> {
    const encrypted =
      await this.dependencies.connections.findSecretEncrypted(id);
    if (encrypted === null) return;
    await refreshReading(
      this.keys,
      credentialRevision(id, encrypted),
      (previous) => this.readKey(id, encrypted, previous?.reading ?? null),
    );
  }

  /** Refreshes credits with the dedicated management credential. */
  public refreshCredits(id: string, encrypted: string): Promise<CreditQuota> {
    return refreshReading(
      this.credits,
      credentialRevision(id, encrypted),
      (previous) => this.readCredits(id, encrypted, previous?.reading ?? null),
    );
  }

  /** Starts a new provider query after any credits read already in progress. */
  public async readFreshCredits(
    id: string,
    encrypted: string,
  ): Promise<CreditQuota> {
    await this.credits.pending.get(credentialRevision(id, encrypted));
    return this.refreshCredits(id, encrypted);
  }

  private decrypt(context: string, encrypted: string): string | null {
    try {
      return this.dependencies.cipher.decrypt(context, encrypted) || null;
    } catch {
      return null;
    }
  }

  private async readKey(
    id: string,
    encrypted: string,
    previous: KeyQuota["reading"],
  ): Promise<KeyQuota> {
    const key = this.decrypt(id, encrypted);
    if (!key) return { status: "invalid_key", reading: null };
    try {
      const result = await this.dependencies.provider.readUsage(
        key,
        AbortSignal.timeout(READ_TIMEOUT_MILLISECONDS),
      );
      if (result.ok) {
        return {
          status: "reported",
          reading: { ...result.value, at: new Date().toISOString() },
        };
      }
      if (isRejectedKey(result.errorCode))
        return { status: "invalid_key", reading: null };
    } catch {
      return { status: "failed", reading: previous };
    }
    return { status: "failed", reading: previous };
  }

  private async readCredits(
    id: string,
    encrypted: string,
    previous: CreditQuota["reading"],
  ): Promise<CreditQuota> {
    const key = this.decrypt(`openrouter-management:${id}`, encrypted);
    if (!key) return { status: "invalid_key", reading: null };
    try {
      const result = await this.dependencies.provider.readCredits(
        key,
        AbortSignal.timeout(READ_TIMEOUT_MILLISECONDS),
      );
      if (result.ok) {
        const { purchased, used } = result.value;
        return {
          status: "reported",
          reading: {
            purchased,
            used,
            remaining: Math.max(0, purchased - used),
            at: new Date().toISOString(),
          },
        };
      }
      if (isRejectedKey(result.errorCode))
        return { status: "invalid_key", reading: null };
      if (result.errorCode === "provider_bad_response")
        return { status: "unknown", reading: previous };
    } catch {
      return { status: "failed", reading: previous };
    }
    return { status: "failed", reading: previous };
  }
}
