import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { isRedirectUri } from "@/definition/McpOAuthClient";

/** Operator-selected authorization server and sole protected MCP audience. */
export interface OAuthConfiguration {
  readonly issuer: string;
  readonly resource: string;
  readonly apiAudience: string;
}

/** Fails closed unless the issuer and resource are explicitly configured, without reflecting input. */
export function readOAuthConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): OAuthConfiguration {
  const issuer = environment.PAGES_OAUTH_ISSUER;
  const resource = environment.PAGES_MCP_RESOURCE;
  if (!isRedirectUri(issuer) || !isRedirectUri(resource))
    throw new McpAuthorizationError("temporarily_unavailable", 503);
  const issuerUrl = new URL(issuer);
  const resourceUrl = new URL(resource);
  if (
    issuerUrl.search ||
    resourceUrl.search ||
    issuer !== issuerUrl.origin ||
    resourceUrl.pathname !== "/mcp"
  ) {
    throw new McpAuthorizationError("temporarily_unavailable", 503);
  }
  return { issuer, resource, apiAudience: `${issuer}/api/v1/agents` };
}

/** Publishes OAuth authorization-server discovery for public PKCE clients. */
export function authorizationMetadata(
  configuration: OAuthConfiguration,
): Readonly<Record<string, unknown>> {
  return {
    issuer: configuration.issuer,
    authorization_endpoint: `${configuration.issuer}/oauth/authorize`,
    token_endpoint: `${configuration.issuer}/oauth/token`,
    registration_endpoint: `${configuration.issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["mcp:connect"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}
