import { createHash } from "node:crypto";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import {
  createAgentCredential,
  hashAgentCredential,
} from "@/backend/security/AgentCredential";

import type { McpOAuthRepository } from "@/backend/database/repositories/mcp/McpOAuthRepository";
import type { OAuthCredential } from "@/backend/database/repositories/mcp/OAuthCredentialRepository";
import type { OAuthGrant } from "@/backend/database/repositories/mcp/OAuthGrantRepository";
import type {
  AgentIdentity,
  McpOAuthTokens,
} from "@/definition/McpAuthorization";
import type { AgentIdentityService } from "./AgentIdentityService";
import type { OAuthConfiguration } from "./OAuthConfiguration";

/** Issues resource-bound credentials, detects refresh replay and delegates only to the Pages API. */
export class OAuthTokenService {
  private readonly repository: McpOAuthRepository;
  private readonly identities: AgentIdentityService;
  private readonly configuration: () => OAuthConfiguration;

  public constructor(
    repository: McpOAuthRepository,
    identities: AgentIdentityService,
    configuration: () => OAuthConfiguration,
  ) {
    this.repository = repository;
    this.identities = identities;
    this.configuration = configuration;
  }

  /** Exchanges one code with S256 PKCE or rotates a supported refresh token atomically. */
  public async exchange(parameters: URLSearchParams): Promise<McpOAuthTokens> {
    const kind =
      parameters.get("grant_type") === "authorization_code"
        ? "code"
        : "refresh";
    if (
      !["authorization_code", "refresh_token"].includes(
        parameters.get("grant_type") ?? "",
      ) ||
      [...parameters.keys()].some((key) => parameters.getAll(key).length > 1) ||
      parameters.has("client_secret")
    ) {
      throw new McpAuthorizationError("invalid_request");
    }
    const result = await this.repository.transaction(async (repository) => {
      const credential = await repository
        .credentials()
        .find(
          hashAgentCredential(
            parameters.get(kind === "code" ? "code" : "refresh_token") ?? "",
          ),
          kind,
        );
      if (!credential) return new McpAuthorizationError("invalid_grant");
      const grant = await repository.grants().find(credential.grantId);
      if (!grant || grant.clientId !== parameters.get("client_id"))
        return new McpAuthorizationError("invalid_grant");
      if (kind === "refresh" && credential.usedAt !== null) {
        await repository.grants().end(grant.id, "revoked", Date.now());
        return new McpAuthorizationError("invalid_grant");
      }
      if (
        !(await this.isValid(
          repository,
          credential,
          grant,
          this.configuration().resource,
        )) ||
        parameters.get("resource") !== grant.resource ||
        (kind === "code" && !this.matchesPkce(credential, parameters))
      ) {
        return new McpAuthorizationError("invalid_grant");
      }
      const client = await repository.clients().find(grant.clientId);
      if (!client) return new McpAuthorizationError("invalid_client");
      await repository.credentials().consume(credential.tokenHash, Date.now());
      const accessToken = await this.issue(repository, {
        grantId: grant.id,
        kind: "access",
        audience: grant.resource,
        expiresAt: Date.now() + 600_000,
      });
      const tokens: McpOAuthTokens = {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 600,
        scope: "mcp:connect",
        ...(client.grant_types.includes("refresh_token")
          ? {
              refresh_token: await this.issue(repository, {
                grantId: grant.id,
                kind: "refresh",
                audience: grant.resource,
                expiresAt: Number.MAX_SAFE_INTEGER,
              }),
            }
          : {}),
      };
      return { tokens, userId: grant.userId };
    });
    if (result instanceof McpAuthorizationError) throw result;
    await this.identities.verify(result.userId);
    return result.tokens;
  }

  /** Verifies the MCP audience at a dedicated OAuth endpoint and issues a distinct API credential. */
  public async delegate(
    accessToken: string,
    resource: string,
  ): Promise<{
    readonly delegationToken: string;
    readonly identity: AgentIdentity;
    readonly audience: string;
    readonly expiresAt: number;
  }> {
    const configuration = this.configuration();
    if (resource !== configuration.resource)
      throw new McpAuthorizationError("invalid_token", 401);
    const credential = await this.validated(accessToken, "access", resource);
    const identity = await this.identities.verify(credential.grant.userId);
    const expiresAt = Math.min(
      Date.now() + 60_000,
      credential.credential.expiresAt,
    );
    const delegationToken = await this.issue(this.repository, {
      grantId: credential.grant.id,
      kind: "delegation",
      audience: configuration.apiAudience,
      expiresAt,
    });
    return {
      delegationToken,
      identity,
      audience: configuration.apiAudience,
      expiresAt,
    };
  }

  /** Accepts only Pages-API delegation credentials and rechecks both consent and user rights. */
  public async verifyDelegation(token: string): Promise<AgentIdentity> {
    const { grant } = await this.validated(
      token,
      "delegation",
      this.configuration().apiAudience,
    );
    return this.identities.verify(grant.userId);
  }

  private async validated(
    token: string,
    kind: "access" | "delegation",
    audience: string,
  ): Promise<{
    readonly credential: OAuthCredential;
    readonly grant: OAuthGrant;
  }> {
    const result = await this.repository.transaction(async (repository) => {
      const credential = await repository
        .credentials()
        .find(hashAgentCredential(token), kind);
      const grant = credential
        ? await repository.grants().find(credential.grantId)
        : null;
      if (
        !credential ||
        !grant ||
        !(await this.isValid(repository, credential, grant, audience))
      )
        return null;
      return { credential, grant };
    });
    if (!result) throw new McpAuthorizationError("invalid_token", 401);
    return result;
  }

  private async isValid(
    repository: McpOAuthRepository,
    credential: OAuthCredential,
    grant: OAuthGrant,
    audience: string,
  ): Promise<boolean> {
    if (grant.expiresAt !== null && grant.expiresAt <= Date.now()) {
      await repository.grants().end(grant.id, "expired", Date.now());
      return false;
    }
    return (
      credential.audience === audience &&
      credential.usedAt === null &&
      credential.expiresAt > Date.now() &&
      grant.status === "active" &&
      grant.resource === this.configuration().resource
    );
  }

  private matchesPkce(
    credential: OAuthCredential,
    parameters: URLSearchParams,
  ): boolean {
    const verifier = parameters.get("code_verifier") ?? "";
    const authorization = new URLSearchParams(credential.parameters);
    return (
      /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) &&
      authorization.get("redirect_uri") === parameters.get("redirect_uri") &&
      createHash("sha256").update(verifier).digest("base64url") ===
        authorization.get("code_challenge")
    );
  }

  private async issue(
    repository: McpOAuthRepository,
    input: Omit<OAuthCredential, "tokenHash" | "parameters" | "usedAt">,
  ): Promise<string> {
    const token = createAgentCredential();
    await repository.credentials().insert({
      ...input,
      tokenHash: hashAgentCredential(token),
      parameters: "",
      usedAt: null,
    });
    return token;
  }
}
