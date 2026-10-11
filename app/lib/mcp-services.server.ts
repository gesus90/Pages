import path from "node:path";

import { AgentAssetRepository } from "@/backend/database/repositories/agents/AgentAssetRepository";
import { AgentAssetService } from "@/backend/service/agents/AgentAssetService";
import { createAgentPlanningServices } from "@/backend/service/agents/AgentPlanningServices";
import { AgentUploadAuthorityService } from "@/backend/service/agents/AgentUploadAuthorityService";
import { AgentUploadTicketService } from "@/backend/service/agents/AgentUploadTicketService";
import { AgentWikiCommentService } from "@/backend/service/agents/AgentWikiCommentService";
import { AgentWikiCreateService } from "@/backend/service/agents/AgentWikiCreateService";
import { AgentWikiFieldService } from "@/backend/service/agents/AgentWikiFieldService";
import { AgentWriteOperationService } from "@/backend/service/agents/AgentWriteOperationService";
import { StructuredImportService } from "@/backend/service/agents/StructuredImportService";
import { WikiImportService } from "@/backend/service/agents/WikiImportService";
import { WikiImportUpdateService } from "@/backend/service/agents/WikiImportUpdateService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";

import { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";
import { McpOAuthRepository } from "@/backend/database/repositories/mcp/McpOAuthRepository";
import { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import { AgentProjectService } from "@/backend/service/mcp/AgentProjectService";
import { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";
import { OAuthClientService } from "@/backend/service/mcp/OAuthClientService";
import { OAuthConsentService } from "@/backend/service/mcp/OAuthConsentService";
import { readOAuthConfiguration } from "@/backend/service/mcp/OAuthConfiguration";
import { OAuthGrantService } from "@/backend/service/mcp/OAuthGrantService";
import { OAuthTokenService } from "@/backend/service/mcp/OAuthTokenService";

import type { AgentTicketPublisher } from "@/backend/service/agents/AgentTicketAnnouncer";
import type { WikiService } from "@/backend/service/WikiService";
import type { Database } from "@/backend/database/Database";
import type { AdministrationService } from "@/backend/service/AdministrationService";
import type { UserService } from "@/backend/service/UserService";

/** Authentication services; OAuth configuration is lazy and cannot block ordinary Pages startup. */
export interface McpApplicationServices {
  readonly agentAssetService: AgentAssetService;
  readonly agentUploadTicketService: AgentUploadTicketService;
  readonly pagesEventPublisher: PagesEventPublisher;
  readonly pagesAgentApiService: PagesAgentApiService;
  readonly personalAgentTokenService: PersonalAgentTokenService;
  readonly oauthClientService: OAuthClientService;
  readonly oauthConsentService: OAuthConsentService;
  readonly oauthGrantService: OAuthGrantService;
  readonly oauthTokenService: OAuthTokenService;
}

/** The page and comment operations; each call runs in one transaction on the shared connection. */
function createWikiOperations(
  database: Database,
  events: PagesEventPublisher,
): { fields: AgentWikiFieldService; comments: AgentWikiCommentService } {
  return {
    fields: new AgentWikiFieldService({ database, events }),
    comments: new AgentWikiCommentService({ database, events }),
  };
}

/** Wires the API/services/repositories without opening another database or reading credential files. */
export function createMcpServices(
  database: Database,
  users: Pick<UserService, "getById">,
  administration: Pick<AdministrationService, "getContext">,
  workspace: {
    readonly directory: string;
    readonly wikiService: Pick<WikiService, "getSettings" | "openAttachment">;
    /** What reacts to a committed ticket change; without it nothing is published or invalidated. */
    readonly tickets?: {
      readonly cache: ServerCache;
      readonly publisher: AgentTicketPublisher | null;
    };
  },
): McpApplicationServices {
  const identities = new AgentIdentityService(users, administration);
  const personalAgentTokenService = new PersonalAgentTokenService(
    new PersonalAgentTokenRepository(database),
    identities,
  );
  const repository = new McpOAuthRepository(database);
  const configuration = (): ReturnType<typeof readOAuthConfiguration> =>
    readOAuthConfiguration(process.env);
  const oauthClientService = new OAuthClientService(repository);
  const oauthTokenService = new OAuthTokenService(
    repository,
    identities,
    configuration,
  );
  const authority = new AgentUploadAuthorityService(
    personalAgentTokenService,
    oauthTokenService,
  );
  const agentUploadTicketService = new AgentUploadTicketService(
    (hash, issuedAt) => authority.verify(hash, issuedAt),
  );
  const staging = new WikiFileStore(
    path.join(workspace.directory, "agent-assets"),
  );
  const pagesEventPublisher = new PagesEventPublisher();
  const agentAssetService = new AgentAssetService({
    repository: new AgentAssetRepository(database),
    files: staging,
    wiki: workspace.wikiService,
  });
  const creation = {
    database,
    staging,
    wikiFiles: new WikiFileStore(
      path.join(workspace.directory, "wiki-attachments"),
    ),
    events: pagesEventPublisher,
  };
  const planning = createAgentPlanningServices({
    database,
    users,
    events: pagesEventPublisher,
    cache: workspace.tickets?.cache ?? ServerCache.disabled(),
    publisher: workspace.tickets?.publisher ?? null,
  });
  const writes = new AgentWriteOperationService({
    users,
    tickets: agentUploadTicketService,
    assets: agentAssetService,
    wiki: workspace.wikiService,
    create: new AgentWikiCreateService(creation),
  });
  return {
    agentAssetService,
    agentUploadTicketService,
    pagesEventPublisher,
    personalAgentTokenService,
    oauthClientService,
    oauthTokenService,
    pagesAgentApiService: new PagesAgentApiService(
      personalAgentTokenService,
      oauthTokenService,
      new AgentProjectService(new ProjectRepository(database)),
      new AgentOperationRouter({
        projects: new ProjectRepository(database),
        wiki: new WikiRepository(database),
        users,
        writes,
        imports: new WikiImportService(creation),
        importUpdates: new WikiImportUpdateService(creation),
        structured: new StructuredImportService({ creation, planning }),
        ...createWikiOperations(database, pagesEventPublisher),
        planning,
      }),
    ),
    oauthConsentService: new OAuthConsentService({
      repository,
      clients: oauthClientService,
      identities,
      configuration,
    }),
    oauthGrantService: new OAuthGrantService(repository),
  };
}
