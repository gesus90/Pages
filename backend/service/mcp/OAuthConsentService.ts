import { randomUUID } from "node:crypto";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import {
  createAgentCredential,
  hashAgentCredential,
} from "@/backend/security/AgentCredential";

import type { McpOAuthRepository } from "@/backend/database/repositories/mcp/McpOAuthRepository";
import type { OAuthFlow } from "@/backend/database/repositories/mcp/OAuthFlowRepository";
import type {
  McpAuthorizationRequest,
  McpOAuthClient,
} from "@/definition/McpAuthorization";
import type { AgentIdentityService } from "./AgentIdentityService";
import type { OAuthClientService } from "./OAuthClientService";
import type { OAuthConfiguration } from "./OAuthConfiguration";

/** Browser consent view; includes only a session-bound CSRF nonce, never OAuth credentials. */
export interface OAuthConsentView {
  readonly id: string;
  readonly csrf: string;
  readonly clientName: string;
  readonly clientId: string;
  readonly resource: string;
}

/** Login/session identity used solely for consent, never for the MCP API. */
export interface OAuthBrowserIdentity {
  readonly userId: string;
  readonly session: string;
}

/** Strictly validates the public PKCE authorization request before redirecting anywhere. */
export function parseAuthorizationRequest(
  parameters: URLSearchParams,
  configuration: OAuthConfiguration,
): McpAuthorizationRequest {
  const clientId = parameters.get("client_id") ?? "";
  const redirectUri = parameters.get("redirect_uri") ?? "";
  const resource = parameters.get("resource") ?? "";
  const challenge = parameters.get("code_challenge") ?? "";
  const state = parameters.get("state") ?? "";
  if (
    [...parameters.keys()].some((key) => parameters.getAll(key).length > 1) ||
    parameters.get("response_type") !== "code" ||
    parameters.get("code_challenge_method") !== "S256" ||
    (parameters.get("scope") ?? "mcp:connect") !== "mcp:connect" ||
    resource !== configuration.resource ||
    !validAuthorizationFields({
      clientId,
      redirectUri,
      resource,
      challenge,
      state,
    })
  ) {
    throw new McpAuthorizationError("invalid_request");
  }
  return { clientId, redirectUri, resource, challenge, state };
}

function validAuthorizationFields(
  authorization: McpAuthorizationRequest,
): boolean {
  return (
    Boolean(authorization.clientId) &&
    authorization.clientId.length <= 2048 &&
    authorization.redirectUri.length <= 2048 &&
    authorization.state.length <= 512 &&
    /^[A-Za-z0-9_-]{43}$/.test(authorization.challenge)
  );
}

/** Uses existing Pages login and explicit, session-bound approval for every new grant. */
export class OAuthConsentService {
  private readonly repository: McpOAuthRepository;
  private readonly clients: OAuthClientService;
  private readonly identities: AgentIdentityService;
  private readonly configuration: () => OAuthConfiguration;

  public constructor(options: {
    readonly repository: McpOAuthRepository;
    readonly clients: OAuthClientService;
    readonly identities: AgentIdentityService;
    readonly configuration: () => OAuthConfiguration;
  }) {
    this.repository = options.repository;
    this.clients = options.clients;
    this.identities = options.identities;
    this.configuration = options.configuration;
  }

  /** Starts the 15-minute deadline before the user is redirected to Pages login. */
  public async begin(parameters: URLSearchParams): Promise<string> {
    const authorization = parseAuthorizationRequest(
      parameters,
      this.configuration(),
    );
    const client = await this.clients.resolve(authorization.clientId);
    if (!client.redirect_uris.includes(authorization.redirectUri))
      throw new McpAuthorizationError("invalid_request");
    const id = randomUUID();
    await this.repository
      .flows()
      .insert(id, parameters.toString(), Date.now() + 900_000);
    return id;
  }

  /** Binds the displayed client/resource and nonce to the authenticated browser session. */
  public async view(
    id: string,
    browser: OAuthBrowserIdentity,
  ): Promise<OAuthConsentView> {
    await this.identities.verify(browser.userId);
    return this.repository.transaction(async (repository) => {
      const { flow, authorization, client } = await this.read(repository, id);
      if (flow.userId !== null && flow.userId !== browser.userId)
        throw new McpAuthorizationError("access_denied", 403);
      const csrf = createAgentCredential();
      await repository
        .flows()
        .bind(
          id,
          browser.userId,
          hashAgentCredential(`${browser.session}:${csrf}`),
        );
      return {
        id,
        csrf,
        clientName: client.client_name,
        clientId: client.client_id,
        resource: authorization.resource,
      };
    });
  }

  /** Approves or denies once; deadline, owner, session and nonce are checked together. */
  public async decide(
    input: {
      readonly id: string;
      readonly csrf: string;
      readonly approved: boolean;
    },
    browser: OAuthBrowserIdentity,
  ): Promise<string> {
    await this.identities.verify(browser.userId);
    return this.repository.transaction(async (repository) => {
      const { flow, authorization } = await this.read(repository, input.id);
      if (
        flow.userId !== browser.userId ||
        flow.csrfHash !==
          hashAgentCredential(`${browser.session}:${input.csrf}`)
      ) {
        throw new McpAuthorizationError("access_denied", 403);
      }
      const now = Date.now();
      await repository.flows().complete(flow.id, now);
      const redirectUri = new URL(authorization.redirectUri);
      redirectUri.searchParams.set("state", authorization.state);
      redirectUri.searchParams.set("iss", this.configuration().issuer);
      if (!input.approved) {
        redirectUri.searchParams.set("error", "access_denied");
        return redirectUri.href;
      }
      const grantId = randomUUID();
      const duration = await repository.grants().duration(browser.userId);
      await repository.grants().insert({
        id: grantId,
        userId: browser.userId,
        clientId: authorization.clientId,
        resource: authorization.resource,
        verifiedAt: now,
        expiresAt: duration === null ? null : now + duration * 1000,
        status: "active",
      });
      const code = createAgentCredential();
      await repository.credentials().insert({
        tokenHash: hashAgentCredential(code),
        grantId,
        kind: "code",
        audience: authorization.resource,
        expiresAt: Math.min(now + 60_000, flow.expiresAt),
        usedAt: null,
        parameters: flow.parameters,
      });
      redirectUri.searchParams.set("code", code);
      return redirectUri.href;
    });
  }

  private async read(
    repository: McpOAuthRepository,
    id: string,
  ): Promise<{
    readonly flow: OAuthFlow;
    readonly authorization: McpAuthorizationRequest;
    readonly client: McpOAuthClient;
  }> {
    const flow = await repository.flows().find(id);
    if (!flow || flow.expiresAt <= Date.now())
      throw new McpAuthorizationError("invalid_request");
    const authorization = parseAuthorizationRequest(
      new URLSearchParams(flow.parameters),
      this.configuration(),
    );
    const client = await repository.clients().find(authorization.clientId);
    if (!client) throw new McpAuthorizationError("invalid_client");
    return { flow, authorization, client };
  }
}
