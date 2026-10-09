import { AgentError } from "@/backend/error/AgentErrors";
import {
  isCatalogInterval,
  supportsModelCatalog,
} from "@/definition/AgentModelCatalog";

import { nextCatalogRefresh } from "./AgentCatalogRefresh";
import {
  requireAgentAdministrator,
  requireAgentConnection,
} from "./AgentServiceAccess";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentModelCatalog } from "@/definition/AgentModelCatalog";
import type { AgentCatalogRefresh } from "./AgentCatalogRefresh";
import type { AgentOperationRegistry } from "./AgentOperationRegistry";

/** Every catalog read, cadence mutation and explicit refresh requires active admin mode. */
export class AgentCatalogService {
  private readonly repository: AgentConnectionRepository;
  private readonly refresh: AgentCatalogRefresh;
  private readonly operations: AgentOperationRegistry;

  public constructor(
    repository: AgentConnectionRepository,
    refresh: AgentCatalogRefresh,
    operations: AgentOperationRegistry,
  ) {
    this.repository = repository;
    this.refresh = refresh;
    this.operations = operations;
  }

  /** Reads persisted snapshots only, without credential decryption or provider calls. */
  public async list(
    actor: AccountAccess,
  ): Promise<Readonly<Record<string, AgentModelCatalog>>> {
    requireAgentAdministrator(actor);
    const connections = await this.repository.list();
    const entries = await Promise.all(
      connections
        .filter((connection) => supportsModelCatalog(connection.provider))
        .map(
          async (connection) =>
            [
              connection.id,
              await this.repository.catalogs().find(connection.id),
            ] as const,
        ),
    );
    return Object.fromEntries(entries);
  }

  /** Changing the interval reanchors the next run; manual-only clears the due time. */
  public async configure(
    actor: AccountAccess,
    id: string,
    interval: number,
  ): Promise<void> {
    requireAgentAdministrator(actor);
    if (!isCatalogInterval(interval))
      throw new AgentError("catalog_interval_invalid");
    await this.operations.run(id, "write", async () => {
      const connection = await requireAgentConnection(this.repository, id);
      if (!supportsModelCatalog(connection.provider))
        throw new AgentError("catalog_unsupported");
      await this.repository
        .catalogs()
        .configure(id, interval, nextCatalogRefresh(interval, Date.now()));
    });
  }

  /** Refresh is independent of auth/model diagnostics and never generates model tokens. */
  public async run(
    actor: AccountAccess,
    id: string,
  ): Promise<AgentModelCatalog> {
    requireAgentAdministrator(actor);
    return this.refresh.run(id);
  }
}
