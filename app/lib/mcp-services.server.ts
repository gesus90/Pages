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

import type { Database } from "@/backend/database/Database";
import type { AdministrationService } from "@/backend/service/AdministrationService";
import type { UserService } from "@/backend/service/UserService";

/** Authentication services; OAuth configuration is lazy and cannot block ordinary Pages startup. */
export interface McpApplicationServices {
  readonly pagesAgentApiService: PagesAgentApiService;
  readonly personalAgentTokenService: PersonalAgentTokenService;
  readonly oauthClientService: OAuthClientService;
  readonly oauthConsentService: OAuthConsentService;
  readonly oauthGrantService: OAuthGrantService;
  readonly oauthTokenService: OAuthTokenService;
}

/** Wires the API/services/repositories without opening another database or reading credential files. */
export function createMcpServices(
  database: Database,
  users: Pick<UserService, "getById">,
  administration: Pick<AdministrationService, "getContext">,
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
  return {
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
