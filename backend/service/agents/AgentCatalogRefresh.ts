import { defaultCatalogModel } from "@/backend/agents/catalog/CatalogDefaults";
import { AgentError } from "@/backend/error/AgentErrors";
import { isApiProvider } from "@/definition/AgentConnection";
import { supportsModelCatalog } from "@/definition/AgentModelCatalog";

import { requireAgentConnection } from "./AgentServiceAccess";

import type { CatalogProviderClient } from "@/backend/agents/catalog/CatalogProviderClient";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { ApiProviderId } from "@/definition/AgentConnection";
import type {
  AgentCatalogModel,
  AgentModelCatalog,
  CatalogInterval,
} from "@/definition/AgentModelCatalog";
import type { AgentOperationRegistry } from "./AgentOperationRegistry";

/** Timing is anchored to the last completed attempt, including errors, so failures do not hot-loop. */
export function nextCatalogRefresh(
  interval: CatalogInterval,
  now: number,
): string | null {
  return interval === 0
    ? null
    : new Date(now + interval * 3_600_000).toISOString();
}

/** CLI connections list the models of their own signed-in CLI. */
export interface AgentCliCatalog {
  listModels(
    connection: AgentConnectionRecord,
    signal: AbortSignal,
  ): Promise<readonly AgentCatalogModel[]>;
}

interface CatalogDependencies {
  readonly repository: AgentConnectionRepository;
  readonly cipher: InstanceSecretCipher;
  readonly client: CatalogProviderClient;
  readonly cli: AgentCliCatalog;
  readonly operations: AgentOperationRegistry;
  readonly now?: () => number;
}

/**
 * Internal refresh executor shared by the authorized admin service and trusted
 * server scheduler.
 *
 * @remarks
 * A successful listing also gives a connection without a model its default
 * (A7 §21.6). This only reads the list; no model is asked to generate anything.
 */
export class AgentCatalogRefresh {
  private readonly dependencies: CatalogDependencies;
  private readonly now: () => number;
  private readonly shutdownController = new AbortController();
  private readonly pending = new Set<Promise<unknown>>();

  public constructor(dependencies: CatalogDependencies) {
    this.dependencies = dependencies;
    this.now = dependencies.now ?? Date.now;
  }

  /** Uses the existing operation lock, preventing refresh/check/key replacement races. */
  public run(id: string): Promise<AgentModelCatalog> {
    return this.track(
      this.dependencies.operations.run(id, "check", () => this.execute(id)),
    );
  }

  /**
   * Loads the model list right after a confirmed access (A7 §21.6).
   *
   * @param id - A connection whose access check or sign-in just succeeded.
   *
   * @remarks
   * The caller already holds this connection's operation lock. A provider
   * without a catalog or a failed listing never fails the access that
   * triggered it; the listing error is stored with the catalog as usual.
   */
  public async loadAfterAccess(id: string): Promise<void> {
    try {
      await this.track(this.execute(id));
    } catch (error: unknown) {
      if (!(error instanceof AgentError)) throw error;
    }
  }

  /** Aborts requests and waits for bounded in-flight persistence before the database closes. */
  public async shutdown(): Promise<void> {
    this.shutdownController.abort();
    await Promise.allSettled([...this.pending]);
  }

  private async track<Result>(operation: Promise<Result>): Promise<Result> {
    this.pending.add(operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(operation);
    }
  }

  private async execute(id: string): Promise<AgentModelCatalog> {
    const { repository } = this.dependencies;
    const connection = await requireAgentConnection(repository, id);
    if (!supportsModelCatalog(connection.provider))
      throw new AgentError("catalog_unsupported");
    const catalog = await repository.catalogs().find(id);
    let models: AgentModelCatalog["models"] | null = null;
    let errorCode: AgentModelCatalog["errorCode"] = null;
    try {
      const signal = AbortSignal.any([
        AbortSignal.timeout(25_000),
        this.shutdownController.signal,
      ]);
      models = isApiProvider(connection.provider)
        ? await this.listApiModels(connection.id, connection.provider, signal)
        : await this.dependencies.cli.listModels(connection, signal);
    } catch (error: unknown) {
      errorCode =
        error instanceof AgentError ? error.code : "provider_unreachable";
    }
    const fallback =
      models && connection.testModel === null
        ? defaultCatalogModel(connection.provider, models)
        : null;
    if (fallback !== null)
      await repository.assignDefaultModel(connection.id, fallback);
    const finishedAt = this.now();
    await repository.catalogs().save(
      id,
      {
        models,
        errorCode,
        attemptedAt: new Date(finishedAt).toISOString(),
      },
      nextCatalogRefresh(catalog.intervalHours, finishedAt),
    );
    return repository.catalogs().find(id);
  }

  private async listApiModels(
    id: string,
    provider: ApiProviderId,
    signal: AbortSignal,
  ): Promise<readonly AgentCatalogModel[]> {
    const { repository, cipher, client } = this.dependencies;
    const encrypted = await repository.findSecretEncrypted(id);
    let apiKey: string;
    try {
      if (encrypted === null) throw new AgentError("secret_unavailable");
      apiKey = cipher.decrypt(id, encrypted);
    } catch {
      throw new AgentError("secret_unavailable");
    }
    return client.list(provider, apiKey, signal);
  }
}
