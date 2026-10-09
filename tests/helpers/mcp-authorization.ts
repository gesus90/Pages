import { createHash } from "node:crypto";
import { vi } from "vitest";

import { Database } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { McpOAuthRepository } from "@/backend/database/repositories/mcp/McpOAuthRepository";
import { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";
import { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import { OAuthClientService } from "@/backend/service/mcp/OAuthClientService";
import { OAuthConsentService } from "@/backend/service/mcp/OAuthConsentService";
import { OAuthGrantService } from "@/backend/service/mcp/OAuthGrantService";
import { OAuthTokenService } from "@/backend/service/mcp/OAuthTokenService";
import { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";
import { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import { createAccess } from "./authorization";
import { createUser } from "./factories";

import type { McpOAuthClient } from "@/definition/McpAuthorization";

export const testOAuthConfiguration = {
  issuer: "https://pages.invalid",
  resource: "https://mcp.invalid/mcp",
  apiAudience: "https://pages.invalid/api/v1/agents",
};
export const browser = { userId: "user-1", session: "isolated-session" };
export const verifier = "a".repeat(43);

export async function authorizationFixture(): Promise<
  ReturnType<typeof wireFixture>
> {
  const database = await Database.create(":memory:");
  await database.migrate(DATABASE_MIGRATIONS);
  return wireFixture(database);
}

export function wireFixture(database: Database) {
  const users = { getById: vi.fn().mockResolvedValue(createUser()) };
  const administration = {
    getContext: vi.fn().mockResolvedValue(createAccess()),
  };
  const identities = new AgentIdentityService(users, administration);
  const repository = new McpOAuthRepository(database);
  const metadata = vi.fn<(id: string) => Promise<unknown>>();
  const clients = new OAuthClientService(repository, metadata);
  const configuration = () => testOAuthConfiguration;
  const consent = new OAuthConsentService({
    repository,
    clients,
    identities,
    configuration,
  });
  const tokens = new OAuthTokenService(repository, identities, configuration);
  const grants = new OAuthGrantService(repository);
  const personalRepository = new PersonalAgentTokenRepository(database);
  const personal = new PersonalAgentTokenService(
    personalRepository,
    identities,
  );
  return {
    database,
    repository,
    personalRepository,
    users,
    administration,
    identities,
    metadata,
    clients,
    consent,
    tokens,
    grants,
    personal,
    api: new PagesAgentApiService(personal, tokens),
  };
}

export function authorizationParameters(
  client: McpOAuthClient,
): URLSearchParams {
  return new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0] ?? "",
    resource: testOAuthConfiguration.resource,
    scope: "mcp:connect",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: "client-state",
  });
}

export const clientMetadata = {
  client_name: "Test client",
  redirect_uris: ["http://127.0.0.1:8765/callback"],
  grant_types: ["authorization_code", "refresh_token"],
};

export async function issueCode(
  fixture: ReturnType<typeof wireFixture>,
  metadata: unknown = clientMetadata,
) {
  const client = await fixture.clients.register(metadata);
  const parameters = authorizationParameters(client);
  const id = await fixture.consent.begin(parameters);
  const view = await fixture.consent.view(id, browser);
  const location = new URL(
    await fixture.consent.decide(
      { id, csrf: view.csrf, approved: true },
      browser,
    ),
  );
  const exchange = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: client.client_id,
    redirect_uri: parameters.get("redirect_uri") ?? "",
    resource: testOAuthConfiguration.resource,
    code: location.searchParams.get("code") ?? "",
    code_verifier: verifier,
  });
  return { client, parameters, id, view, location, exchange };
}
