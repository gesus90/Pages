import { hashAgentCredential } from "@/backend/security/AgentCredential";
import { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import { OAuthRepository } from "@/backend/database/repositories/mcp/OAuthRepository";
import { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";

import { call, MISSING_TEXT, prepare, refused, stored } from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type { RunCredentialRecord } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import type {
  OAuthClientMetadata,
  OAuthCodeParameters,
} from "@/definition/McpOAuth";

const USER = "user-mcp";
/** Beyond the range of a 32-bit integer, like every time of this area. */
const NOW = 1_800_000_000_000;
const ONE_MINUTE = 60_000;
const ONE_DAY = 86_400_000;
const FUTURE = NOW + 10 * 365 * ONE_DAY;

const CREDENTIAL: RunCredentialRecord = {
  id: "credential-a",
  userId: USER,
  tokenHash: "run-hash-a",
  createdAt: NOW,
  expiresAt: NOW + ONE_MINUTE,
  scope: {
    runId: "run-a",
    stepId: "step-a",
    operations: ["read_ticket", "add_comment"],
    tickets: [{ id: "ticket-1", key: "PAGE-1" }],
    reach: "read",
  },
};

const CLIENT: OAuthClientMetadata = {
  client_name: "Werkzeug ä",
  redirect_uris: ["https://client.example/callback"],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code"],
  response_types: ["code"],
  scope: "pages",
};

const CODE: OAuthCodeParameters = {
  clientId: "client-1",
  userId: USER,
  redirectUri: "https://client.example/callback",
  codeChallenge: "challenge",
  resource: "https://pages.example/mcp",
};

function credentials({
  database,
}: RepositoryWorld): AgentRunCredentialRepository {
  return new AgentRunCredentialRepository(database);
}

function oauth({ database }: RepositoryWorld): OAuthRepository {
  return new OAuthRepository(database);
}

function tokens({ database }: RepositoryWorld): PersonalAgentTokenRepository {
  return new PersonalAgentTokenRepository(database);
}

/** Credentials of agent plan sessions: found by hash, ended per node or per run. */
export const RUN_CREDENTIAL_FLOW: RepositoryFlow = {
  title: "run credentials",
  steps: [
    call("AgentRunCredentialRepository.findValid", (world) =>
      credentials(world).findValid("run-hash-a", NOW),
    ),
    call("AgentRunCredentialRepository.insert", (world) =>
      credentials(world).insert(CREDENTIAL),
    ),
    call("AgentRunCredentialRepository.insert", (world) =>
      credentials(world).insert({
        ...CREDENTIAL,
        id: "credential-b",
        tokenHash: "run-hash-b",
        expiresAt: NOW - ONE_MINUTE,
        scope: { ...CREDENTIAL.scope, stepId: "step-b", reach: "full" },
      }),
    ),
    call("AgentRunCredentialRepository.insert", (world) =>
      credentials(world).insert({
        ...CREDENTIAL,
        id: "credential-c",
        tokenHash: "run-hash-c",
        scope: { ...CREDENTIAL.scope, stepId: "step-c" },
      }),
    ),
    refused("AgentRunCredentialRepository.insert", (world) =>
      credentials(world).insert({ ...CREDENTIAL, id: "credential-same-hash" }),
    ),
    call("AgentRunCredentialRepository.findValid", (world) =>
      credentials(world).findValid("run-hash-a", NOW),
    ),
    call("AgentRunCredentialRepository.findValid", (world) =>
      credentials(world).findValid("run-hash-b", NOW),
    ),
    prepare(`
      UPDATE agent_run_credentials
      SET reach = NULL,
          operations_json = '{}',
          ticket_ids_json = '[{"id":"ticket-2"},"Text",{"id":"ticket-3","key":"PAGE-3"}]'
      WHERE id = 'credential-c';
    `),
    call("AgentRunCredentialRepository.findValid", (world) =>
      credentials(world).findValid("run-hash-c", NOW),
    ),
    prepare(
      "UPDATE agent_run_credentials SET ticket_ids_json = 'kein JSON' WHERE id = 'credential-c';",
    ),
    refused("AgentRunCredentialRepository.findValid", (world) =>
      credentials(world).findValid("run-hash-c", NOW),
    ),
    call("AgentRunCredentialRepository.revoke", (world) =>
      credentials(world).revoke("run-a", "step-a", NOW),
    ),
    call("AgentRunCredentialRepository.revoke", (world) =>
      credentials(world).revoke("run-a", "step-a", NOW),
    ),
    call("AgentRunCredentialRepository.findValid", (world) =>
      credentials(world).findValid("run-hash-a", NOW),
    ),
    call("AgentRunCredentialRepository.revoke", (world) =>
      credentials(world).revoke("run-a", null, NOW),
    ),
    stored(`
      SELECT
          id,
          revoked_at
      FROM agent_run_credentials
      ORDER BY id;
    `),
  ],
};

/** The OAuth path of an MCP client: registration, code, token and its audience. */
export const OAUTH_FLOW: RepositoryFlow = {
  title: "oauth",
  steps: [
    prepare(`
      INSERT INTO mcp_http_clients (id, metadata, expires_at)
      VALUES
          ('client-expired', '{}', 1000),
          ('client-broken', 'kein JSON', ${String(FUTURE * 2)});
    `),
    call("OAuthRepository.register", async (world) =>
      oauth(world).client(await oauth(world).register(CLIENT)),
    ),
    call("OAuthRepository.client", (world) =>
      oauth(world).client("client-expired"),
    ),
    call("OAuthRepository.client", (world) =>
      oauth(world).client("client-unknown"),
    ),
    refused("OAuthRepository.client", (world) =>
      oauth(world).client("client-broken"),
    ),
    stored("SELECT COUNT(*) FROM mcp_http_clients;"),
    prepare(`
      INSERT INTO mcp_http_clients (id, metadata, expires_at)
      SELECT
          'filled-' || CAST(position_in_list AS TEXT),
          '{}',
          ${String(FUTURE * 2)}
      FROM generate_series(1, 1000) AS positions (position_in_list);
    `),
    refused("OAuthRepository.register", (world) =>
      oauth(world).register(CLIENT),
    ),
    prepare("DELETE FROM mcp_http_clients WHERE id LIKE 'filled-%';"),
    prepare(`
      INSERT INTO mcp_http_codes (code_hash, parameters, expires_at)
      VALUES ('hash-of-an-expired-code', '{}', 1000);
    `),
    call("OAuthRepository.saveCode", (world) =>
      oauth(world).saveCode("code-a", CODE, FUTURE),
    ),
    refused("OAuthRepository.saveCode", (world) =>
      oauth(world).saveCode("code-a", CODE, FUTURE),
    ),
    stored("SELECT COUNT(*) FROM mcp_http_codes;"),
    call("OAuthRepository.saveCode", (world) =>
      oauth(world).saveCode("code-soon-gone", CODE, FUTURE),
    ),
    prepare(
      `UPDATE mcp_http_codes SET expires_at = 1000 WHERE code_hash = '${hashAgentCredential("code-soon-gone")}';`,
    ),
    call("OAuthRepository.code", (world) => oauth(world).code("code-a")),
    call("OAuthRepository.code", (world) =>
      oauth(world).code("code-soon-gone"),
    ),
    call("OAuthRepository.code", (world) => oauth(world).code("code-unknown")),
    call("OAuthRepository.consume", (world) =>
      oauth(world).consume("code-soon-gone"),
    ),
    call("OAuthRepository.consume", (world) => oauth(world).consume("code-a")),
    call("OAuthRepository.consume", (world) => oauth(world).consume("code-a")),
    call("OAuthRepository.code", (world) => oauth(world).code("code-a")),
    prepare(`
      INSERT INTO mcp_http_codes (code_hash, parameters, expires_at)
      VALUES ('${hashAgentCredential("code-broken")}', 'kein JSON', ${String(FUTURE)});
    `),
    refused("OAuthRepository.code", (world) =>
      oauth(world).code("code-broken"),
    ),
    prepare(`
      INSERT INTO mcp_http_access (token_hash, resource, expires_at)
      VALUES ('hash-of-an-expired-access', 'https://pages.example/mcp', 1000);
    `),
    call("OAuthRepository.issue", (world) =>
      oauth(world).issue({
        token: "oauth-token",
        userId: USER,
        name: "Werkzeug über OAuth",
        resource: "https://pages.example/mcp",
        expiresAt: FUTURE,
      }),
    ),
    refused("OAuthRepository.issue", (world) =>
      oauth(world).issue({
        token: "oauth-token",
        userId: USER,
        name: "Noch einmal",
        resource: "https://pages.example/mcp",
        expiresAt: FUTURE,
      }),
    ),
    refused("OAuthRepository.issue", (world) =>
      oauth(world).issue({
        token: "oauth-token-without-resource",
        userId: USER,
        name: "Ohne Ziel",
        resource: MISSING_TEXT,
        expiresAt: FUTURE,
      }),
    ),
    stored("SELECT resource FROM mcp_http_access ORDER BY resource;"),
    stored(`
      SELECT
          name,
          source,
          device_label,
          expires_at
      FROM personal_agent_tokens
      ORDER BY name;
    `),
    call("OAuthRepository.accepts", (world) =>
      oauth(world).accepts("oauth-token", "https://pages.example/mcp"),
    ),
    call("OAuthRepository.accepts", (world) =>
      oauth(world).accepts("oauth-token", "https://other.example/mcp"),
    ),
    call("OAuthRepository.accepts", (world) =>
      oauth(world).accepts("token-unknown", "https://pages.example/mcp"),
    ),
    call("PersonalAgentTokenRepository.findOwner", (world) =>
      tokens(world).findOwner(hashAgentCredential("oauth-token"), NOW),
    ),
    prepare(
      `DELETE FROM mcp_http_access WHERE token_hash = '${hashAgentCredential("oauth-token")}';`,
    ),
    call("PersonalAgentTokenRepository.findOwner", (world) =>
      tokens(world).findOwner(hashAgentCredential("oauth-token"), NOW),
    ),
    prepare(`DELETE FROM personal_agent_tokens WHERE user_id = '${USER}';`),
    prepare("DELETE FROM mcp_http_clients;"),
  ],
};
