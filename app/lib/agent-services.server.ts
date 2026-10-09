import { CatalogProviderClient } from "@/backend/agents/catalog/CatalogProviderClient";
import { AgentCatalogRefresh } from "@/backend/service/agents/AgentCatalogRefresh";
import { AgentCatalogService } from "@/backend/service/agents/AgentCatalogService";
import { AgentCatalogScheduler } from "@/backend/service/agents/AgentCatalogScheduler";
import { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { createApiProviderRegistry } from "@/backend/agents/providers/ApiProviderRegistry";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { AgentCheckService } from "@/backend/service/agents/AgentCheckService";
import { AgentCliLoginService } from "@/backend/service/agents/AgentCliLoginService";
import { AgentConnectionService } from "@/backend/service/agents/AgentConnectionService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";

import type { Database } from "@/backend/database/Database";

export interface AgentApplicationServices {
  readonly agentCatalogService: AgentCatalogService;
  readonly agentCatalogScheduler: AgentCatalogScheduler;
  readonly agentConnectionService: AgentConnectionService;
  readonly agentCheckService: AgentCheckService;
  readonly agentCliLoginService: AgentCliLoginService;
}

/** Creates lazy adapters and one shared login/process registry without running any checks. */
export function createAgentServices(
  database: Database,
  dataDirectory: string,
  tokenKey: Buffer,
): AgentApplicationServices {
  const repository = new AgentConnectionRepository(database);
  const cipher = new InstanceSecretCipher(tokenKey);
  const operations = new AgentOperationRegistry();
  const store = new AgentCredentialStore(dataDirectory);
  const locator = new CliLocator();
  const runner = new CliProcessRunner();
  const runtime = new AgentCliRuntime({ store, locator, runner });
  const refresh = new AgentCatalogRefresh({
    repository,
    cipher,
    operations,
    client: new CatalogProviderClient(),
    cli: runtime,
  });
  const agentCliLoginService = new AgentCliLoginService({
    repository,
    store,
    locator,
    runner,
    runtime,
    operations,
    catalog: refresh,
  });
  return {
    agentCatalogService: new AgentCatalogService(
      repository,
      refresh,
      operations,
    ),
    agentCatalogScheduler: new AgentCatalogScheduler(
      repository.catalogs(),
      refresh,
    ),
    agentCliLoginService,
    agentConnectionService: new AgentConnectionService({
      repository,
      cipher,
      operations,
      cli: agentCliLoginService,
    }),
    agentCheckService: new AgentCheckService({
      repository,
      catalog: refresh,
      cipher,
      operations,
      cli: runtime,
      providers: createApiProviderRegistry(),
    }),
  };
}
