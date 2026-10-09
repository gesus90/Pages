import type { McpOAuthClient } from "./McpAuthorization";

/** Validates public client metadata before it reaches registration or persisted snapshots. */
export function parseOAuthClient(
  input: unknown,
  clientId: string,
): McpOAuthClient {
  if (typeof input !== "object" || input === null)
    throw new Error("Invalid client metadata.");
  const candidate = input as Record<string, unknown>;
  const redirects = candidate.redirect_uris;
  const grants = candidate.grant_types ?? ["authorization_code"];
  const responses = candidate.response_types ?? ["code"];
  if (
    !validClientName(candidate.client_name) ||
    !Array.isArray(redirects) ||
    redirects.length === 0 ||
    redirects.length > 10 ||
    !redirects.every(isRedirectUri) ||
    !validGrants(grants) ||
    !validResponses(responses) ||
    (candidate.token_endpoint_auth_method !== undefined &&
      candidate.token_endpoint_auth_method !== "none")
  ) {
    throw new Error("Invalid client metadata.");
  }
  return {
    client_id: clientId,
    client_name: candidate.client_name.trim(),
    redirect_uris: redirects,
    grant_types: grants,
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

function validClientName(name: unknown): name is string {
  return typeof name === "string" && Boolean(name.trim()) && name.length <= 100;
}

function validGrants(grants: unknown): grants is string[] {
  return (
    Array.isArray(grants) &&
    grants.includes("authorization_code") &&
    grants.every(
      (grant: unknown) =>
        grant === "authorization_code" || grant === "refresh_token",
    )
  );
}

function validResponses(responses: unknown): boolean {
  return (
    Array.isArray(responses) &&
    responses.length === 1 &&
    responses[0] === "code"
  );
}

/** Accepts HTTPS and local native-client callbacks, with no fragment or user information. */
export function isRedirectUri(candidate: unknown): candidate is string {
  if (typeof candidate !== "string" || candidate.length > 2048) return false;
  try {
    const url = new URL(candidate);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
