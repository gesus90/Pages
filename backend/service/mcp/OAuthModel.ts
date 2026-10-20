import { z } from "zod";

import { createAgentCredential } from "@/backend/security/AgentCredential";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type OAuth2Server from "@node-oauth/oauth2-server";
import type { OAuthRepository } from "@/backend/database/repositories/mcp/OAuthRepository";
import type { AgentIdentityService } from "./AgentIdentityService";
import type { PairingService } from "./PairingService";

const ownerSchema = z.object({ id: z.string().min(1) });

/** OAuth library persistence adapter, bound to one immutable resource per request. */
export class OAuthModel implements OAuth2Server.AuthorizationCodeModel {
  private readonly repository: OAuthRepository;
  private readonly identities: AgentIdentityService;
  private readonly pairing: PairingService;
  private readonly resource: string;

  public constructor(input: {
    repository: OAuthRepository;
    identities: AgentIdentityService;
    pairing: PairingService;
    resource: string;
  }) {
    this.repository = input.repository;
    this.identities = input.identities;
    this.pairing = input.pairing;
    this.resource = input.resource;
  }

  /** Only registered public authorization-code clients are supported. */
  public async getClient(
    id: string,
    secret: string,
  ): Promise<OAuth2Server.Client | false> {
    if (secret) return false;
    const metadata = await this.repository.client(id);
    return metadata
      ? {
          id,
          grants: ["authorization_code"],
          redirectUris: metadata.redirect_uris,
        }
      : false;
  }

  /** Produces a high-entropy access token recognizable as audience-bound OAuth access. */
  public async generateAccessToken(): Promise<string> {
    return `mcp_oauth_${createAgentCredential()}`;
  }

  /** Produces a short-lived, unpredictable, one-use code. */
  public async generateAuthorizationCode(): Promise<string> {
    return createAgentCredential();
  }

  /** Scopes identify the protocol surface only; Pages permissions remain authoritative. */
  public async validateScope(
    user: OAuth2Server.User,
    client: OAuth2Server.Client,
    scope?: string[],
  ): Promise<string[] | false> {
    ownerSchema.parse(user);
    if (!client.id) return false;
    return !scope || scope.every((entry) => entry === "pages")
      ? ["pages"]
      : false;
  }

  /** Saves resource, exact redirect and PKCE with the approved existing owner. */
  public async saveAuthorizationCode(
    code: Pick<
      OAuth2Server.AuthorizationCode,
      | "authorizationCode"
      | "expiresAt"
      | "redirectUri"
      | "scope"
      | "codeChallenge"
      | "codeChallengeMethod"
    >,
    client: OAuth2Server.Client,
    user: OAuth2Server.User,
  ): Promise<OAuth2Server.AuthorizationCode> {
    const owner = ownerSchema.parse(user);
    await this.identities.verify(owner.id);
    if (!code.codeChallenge || code.codeChallengeMethod !== "S256")
      throw new McpAuthorizationError("invalid_request");
    await this.repository.saveCode(
      code.authorizationCode,
      {
        userId: owner.id,
        clientId: client.id,
        redirectUri: code.redirectUri,
        codeChallenge: code.codeChallenge,
        resource: this.resource,
      },
      code.expiresAt.getTime(),
    );
    return { ...code, client, user: owner };
  }

  /** Loads the code only for the same intended resource; PKCE and client matching are library-owned. */
  public async getAuthorizationCode(
    code: string,
  ): Promise<OAuth2Server.AuthorizationCode | false> {
    const stored = await this.repository.code(code);
    if (!stored || stored.parameters.resource !== this.resource) return false;
    const { parameters } = stored;
    await this.identities.verify(parameters.userId);
    return {
      authorizationCode: code,
      expiresAt: new Date(stored.expiresAt),
      redirectUri: parameters.redirectUri,
      codeChallenge: parameters.codeChallenge,
      codeChallengeMethod: "S256",
      scope: ["pages"],
      client: { id: parameters.clientId, grants: ["authorization_code"] },
      user: { id: parameters.userId },
    };
  }

  /** Atomically consumes the code before verification, as required by the library. */
  public async revokeAuthorizationCode(
    code: OAuth2Server.AuthorizationCode,
  ): Promise<boolean> {
    return this.repository.consume(code.authorizationCode);
  }

  /** Persists only access: refresh tokens are deliberately not issued or returned. */
  public async saveToken(
    token: OAuth2Server.Token,
    client: OAuth2Server.Client,
    user: OAuth2Server.User,
  ): Promise<OAuth2Server.Token> {
    const owner = ownerSchema.parse(user);
    await this.identities.verify(owner.id);
    const metadata = await this.repository.client(client.id);
    if (!metadata) throw new McpAuthorizationError("invalid_grant");
    const days = await this.pairing.validity(owner.id);
    const expiry = Math.min(
      token.accessTokenExpiresAt?.getTime() ?? 0,
      days === 0 ? Infinity : Date.now() + days * 86400000,
    );
    if (expiry <= Date.now()) throw new McpAuthorizationError("invalid_grant");
    await this.repository.issue({
      token: token.accessToken,
      userId: owner.id,
      name: metadata.client_name,
      resource: this.resource,
      expiresAt: expiry,
    });
    return {
      accessToken: token.accessToken,
      accessTokenExpiresAt: new Date(expiry),
      scope: ["pages"],
      client,
      user: owner,
    };
  }

  /** Resource requests authenticate through the existing personal-token service instead. */
  public async getAccessToken(): Promise<false> {
    return false;
  }
}
