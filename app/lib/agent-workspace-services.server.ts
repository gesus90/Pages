import { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import { PageAgentService } from "@/backend/service/agents/PageAgentService";
import { PicaSettingsRepository } from "@/backend/database/repositories/chat/PicaSettingsRepository";
import { picaManagedConnectionCheck } from "@/backend/service/chat/PicaManagedConnection";
import { PicaSettingsService } from "@/backend/service/chat/PicaSettingsService";

import {
  createAgentConfigurationCore,
  completePlanAgentConfiguration,
} from "./plan-agent-configuration.server";

import type { AgentContentAccess } from "@/backend/service/agents/AgentContentAccess";
import type { AgentParameterService } from "@/backend/service/agents/AgentParameterService";
import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type { AgentDefinitionFiles } from "@/backend/service/agents/AgentDefinitionFiles";
import type { AgentRunArchive } from "@/backend/service/agents/AgentRunArchive";
import type { AgentTicketParameterService } from "@/backend/service/agents/AgentTicketParameterService";
import type { AgentTicketAssetService } from "@/backend/service/agents/AgentTicketAssetService";
import type { AgentTicketAssetSnapshots } from "@/backend/service/agents/AgentTicketAssetSnapshots";
import type { PlanAssetService } from "@/backend/service/agents/assets/PlanAssetService";
import type { AgentTicketAssetDependencies } from "@/backend/service/agents/AgentTicketAssetService";
import type { Database } from "@/backend/database/Database";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import type { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";

export { resolveWorkspaceRoots } from "./plan-agent-configuration.server";

/** The existing central agent and the workspace registry share live account and project boundaries. */
export interface AgentConfigurationApplicationServices {
  readonly agentTicketParameterService: AgentTicketParameterService;
  readonly agentContentAccess: AgentContentAccess;
  readonly agentTicketAssetService: AgentTicketAssetService;
  readonly agentTicketAssetSnapshots: AgentTicketAssetSnapshots;
  readonly agentProfileService: AgentProfileService;
  readonly agentWorkspaceService: AgentWorkspaceService;
  readonly agentParameterService: AgentParameterService;
  readonly pageAgentService: PageAgentService;
  readonly agentDefinitionFiles: AgentDefinitionFiles;
  readonly agentRunArchive: AgentRunArchive;
  readonly picaSettingsService: PicaSettingsService;
  /** The files of asset nodes; `null` where no file store was wired. */
  readonly agentPlanAssetService: PlanAssetService | null;
}

/** Wires registration and parameter preparation without filesystem writes or runner starts. */
export function createAgentConfigurationServices(input: {
  readonly database: Database;
  readonly dataDirectory: string;
  /** Folder of the `AGENT.md` and run records of every agent; separate from the data folder. */
  readonly agentsDirectory: string;
  readonly connections: AgentConnectionRepository;
  /** The folders of the connections, so Pica refuses a Codex connection with a foreign configuration; absent where no chat runs. */
  readonly credentials?: Pick<AgentCredentialStore, "paths">;
  readonly operations: AgentOperationRegistry;
  readonly ticketAssets: AgentTicketAssetDependencies;
}): AgentConfigurationApplicationServices {
  const { services, dependencies } = createAgentConfigurationCore(input);
  const { agentDefinitionFiles } = services;
  const { database } = input;
  const picaSettingsService = new PicaSettingsService({
    ...dependencies,
    settings: new PicaSettingsRepository(database),
    ...(input.credentials
      ? {
          requireManagedConnection: picaManagedConnectionCheck(
            input.credentials,
          ),
        }
      : {}),
  });
  const agentProfileService = new AgentProfileService({
    ...dependencies,
    pica: picaSettingsService,
  });
  return {
    ...completePlanAgentConfiguration(
      { services, dependencies },
      agentProfileService,
    ).services,
    picaSettingsService,
    pageAgentService: new PageAgentService(
      dependencies,
      agentProfileService,
      agentDefinitionFiles,
    ),
  };
}
