import OAuth2Server from "@node-oauth/oauth2-server";

import {
  createAgentCredential,
  hashAgentCredential,
} from "@/backend/security/AgentCredential";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import { oauthClientSchema, oauthRequestSchema } from "@/definition/McpOAuth";
import { OAuthModel } from "./OAuthModel";
import { PairingThrottle } from "./PairingThrottle";

import type { OAuthRepository } from "@/backend/database/repositories/mcp/OAuthRepository";
import type { AgentIdentityService } from "./AgentIdentityService";
import type { PersonalAgentTokenService } from "./PersonalAgentTokenService";
import type { PairingService } from "./PairingService";
import type { OAuthAuthorizationRequest } from "@/definition/McpOAuth";
import type { PairingAddress } from "./PairingThrottle";
import type { PairingBrowserIdentity } from "@/definition/McpPairing";

interface ConsentRequest {
  readonly parameters: OAuthAuthorizationRequest;
  readonly expiresAt: number;
}

/** Browser consent and public DCR around a maintained authorization-code/PKCE implementation. */
export class OAuthService {
  private readonly repository: OAuthRepository;
  private readonly identities: AgentIdentityService;
  private readonly personal: PersonalAgentTokenService;
  private readonly pairing: PairingService;
  private readonly requests = new Map<string, ConsentRequest>();
  private readonly throttle = new PairingThrottle();

  public constructor(input: {
    repository: OAuthRepository;
    identities: AgentIdentityService;
    personal: PersonalAgentTokenService;
    pairing: PairingService;
  }) {
    this.repository = input.repository;
    this.identities = input.identities;
    this.personal = input.personal;
    this.pairing = input.pairing;
  }

  /** Registers only public clients; labels are untrusted display text, never authority. */
  public async register(
    input: unknown,
    address: PairingAddress,
  ): Promise<Record<string, unknown>> {
    this.throttle.request(address);
    const metadata = oauthClientSchema.safeParse(input);
    if (!metadata.success)
      throw new McpAuthorizationError("invalid_client_metadata");
    const id = await this.repository.register(metadata.data);
    return {
      ...metadata.data,
      client_id: id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
  }

  /** Validates redirect/resource/state/PKCE before retaining any browser request. */
  public async begin(
    input: URLSearchParams,
    resource: string,
    address: PairingAddress,
  ): Promise<string> {
    this.throttle.request(address);
    const parsed = oauthRequestSchema.safeParse(Object.fromEntries(input));
    if (!parsed.success || parsed.data.resource !== resource)
      throw new McpAuthorizationError("invalid_request");
    const client = await this.repository.client(parsed.data.client_id);
    if (!client || !client.redirect_uris.includes(parsed.data.redirect_uri))
      throw new McpAuthorizationError("invalid_client");
    for (const [id, request] of this.requests)
      if (request.expiresAt <= Date.now()) this.requests.delete(id);
    if (this.requests.size >= 500)
      throw new McpAuthorizationError("temporarily_unavailable", 503);
    const id = createAgentCredential();
    this.requests.set(id, {
      parameters: parsed.data,
      expiresAt: Date.now() + 600000,
    });
    return id;
  }

  /** Provides a session-bound consent nonce and public facts, without issuing a code. */
  public async view(
    id: string,
    browser: PairingBrowserIdentity,
  ): Promise<{ clientName: string; resource: string; csrf: string }> {
    await this.identities.verify(browser.userId);
    const request = this.pending(id);
    const client = await this.repository.client(request.parameters.client_id);
    if (!client) throw new McpAuthorizationError("invalid_client");
    return {
      clientName: client.client_name,
      resource: request.parameters.resource,
      csrf: this.csrf(id, browser),
    };
  }

  /** Requires explicit approval or denial with a nonce bound to this account and session. */
  public async decide(
    input: { id: string; csrf: unknown; decision: unknown },
    browser: PairingBrowserIdentity,
  ): Promise<string> {
    await this.identities.verify(browser.userId);
    const pending = this.pending(input.id);
    if (
      input.csrf !== this.csrf(input.id, browser) ||
      !["approve", "deny"].includes(String(input.decision))
    )
      throw new McpAuthorizationError("access_denied", 403);
    this.requests.delete(input.id);
    const parameters = pending.parameters;
    if (input.decision === "deny") {
      const denied = new URL(parameters.redirect_uri);
      denied.searchParams.set("error", "access_denied");
      denied.searchParams.set("state", parameters.state);
      return denied.href;
    }
    const request = new OAuth2Server.Request({
      method: "GET",
      headers: {},
      query: parameters,
    });
    const response = new OAuth2Server.Response();
    await this.server(parameters.resource).authorize(request, response, {
      authenticateHandler: { handle: async () => ({ id: browser.userId }) },
    });
    const location: unknown = response.get("location");
    if (typeof location !== "string")
      throw new Error("OAuth redirect unavailable.");
    return location;
  }

  /** Exchanges a code using the library's client, redirect, single-use and S256 validation. */
  public async exchange(
    input: Record<string, string>,
    resource: string,
    address: PairingAddress,
  ): Promise<Record<string, unknown>> {
    this.throttle.request(address);
    if (
      input.resource !== resource ||
      input.grant_type !== "authorization_code"
    )
      throw new McpAuthorizationError("invalid_request");
    const request = new OAuth2Server.Request({
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(
          Buffer.byteLength(new URLSearchParams(input).toString()),
        ),
      },
      query: {},
      body: input,
    });
    const result = await this.server(resource).token(
      request,
      new OAuth2Server.Response(),
    );
    return {
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: Math.max(
        0,
        Math.floor(
          ((result.accessTokenExpiresAt?.getTime() ?? 0) - Date.now()) / 1000,
        ),
      ),
      scope: "pages",
    };
  }

  /** A session identifier never authenticates a request; job tokens are not personal credentials. */
  public async authenticate(token: string, resource: string): Promise<void> {
    if (
      token.startsWith("mcp_oauth_") &&
      !(await this.repository.accepts(token, resource))
    )
      throw new McpAuthorizationError("invalid_token", 401);
    await this.personal.verify(token);
  }

  private server(resource: string): OAuth2Server {
    return new OAuth2Server({
      model: new OAuthModel({
        repository: this.repository,
        identities: this.identities,
        pairing: this.pairing,
        resource,
      }),
      authorizationCodeLifetime: 120,
      accessTokenLifetime: 3600,
      requireClientAuthentication: { authorization_code: false },
      allowEmptyState: false,
    });
  }

  private pending(id: string): ConsentRequest {
    const request = this.requests.get(id);
    if (!request || request.expiresAt <= Date.now()) {
      this.requests.delete(id);
      throw new McpAuthorizationError("invalid_grant");
    }
    return request;
  }

  private csrf(id: string, browser: PairingBrowserIdentity): string {
    return hashAgentCredential(
      `oauth:${id}:${browser.userId}:${browser.session}`,
    );
  }
}
