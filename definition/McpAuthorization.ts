import type { Capability } from "./Authorization";

/** Current account rights verified by Pages, independent of the browser role mode. */
export interface AgentIdentity {
  readonly userId: string;
  readonly isAdmin: boolean;
  readonly permissions: readonly Capability[];
}

/** Public personal-token summary; neither a credential nor its hash is included. */
export interface PersonalAgentToken {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly revokedAt: number | null;
  readonly status: "active" | "expired" | "revoked";
}

/** Validated public OAuth client metadata shared by CIMD and DCR. */
export interface McpOAuthClient {
  readonly client_id: string;
  readonly client_name: string;
  readonly redirect_uris: readonly string[];
  readonly grant_types: readonly string[];
  readonly response_types: readonly ["code"];
  readonly token_endpoint_auth_method: "none";
}

/** Validated authorization request; never contains a credential. */
export interface McpAuthorizationRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly resource: string;
  readonly challenge: string;
  readonly state: string;
}

/** Standards-shaped response for a public client; clear text must not be logged. */
export interface McpOAuthTokens {
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly expires_in: number;
  readonly scope: "mcp:connect";
  readonly refresh_token?: string;
}
