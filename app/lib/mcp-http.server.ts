import OAuth2Server from "@node-oauth/oauth2-server";

import { isLoopbackUrl } from "@/definition/McpOAuth";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { PairingRateError } from "@/backend/service/mcp/PairingThrottle";

/** Opt-in trusted addresses shared by HTTP MCP, OAuth discovery and browser consent. */
export async function requireMcpHttp(
  request: Request,
  socket: string,
): Promise<{ origin: string; resource: string }> {
  const runtime = await getPagesRuntime();
  const configuration = runtime.getConfig();
  const origin = configuration.mcpHttp?.publicUrl;
  if (!origin) throw new McpAuthorizationError("not_found", 404);
  const url = new URL(request.url);
  const isLocal =
    url.protocol === "http:" &&
    isLoopbackUrl(url) &&
    url.port === String(configuration.port) &&
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(socket);
  if (url.origin !== origin && !isLocal)
    throw new McpAuthorizationError("access_denied", 403);
  if (url.protocol !== "https:" && !isLocal)
    throw new McpAuthorizationError("access_denied", 403);
  const browserOrigin = request.headers.get("Origin");
  if (browserOrigin !== null && browserOrigin !== url.origin)
    throw new McpAuthorizationError("access_denied", 403);
  for (const name of ["access_token", "token", "deviceSecret", "refresh_token"])
    if (url.searchParams.has(name))
      throw new McpAuthorizationError("invalid_request");
  return { origin, resource: `${origin}/mcp` };
}

/** OAuth and credential replies are never cached or used as referrers. */
export const MCP_HTTP_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

/** Sanitizes library errors without reflecting request parameters, tokens or provider diagnostics. */
export function mcpHttpFailure(error: unknown): Response {
  let code = "server_error";
  let status = 503;
  if (error instanceof McpAuthorizationError) {
    code = error.code;
    status = error.status;
  } else if (error instanceof OAuth2Server.OAuthError) {
    const known = [
      "invalid_request",
      "invalid_client",
      "invalid_grant",
      "invalid_scope",
      "unauthorized_client",
      "unsupported_grant_type",
      "access_denied",
    ];
    code = known.includes(error.name) ? error.name : "invalid_grant";
    status = 400;
  }
  return Response.json(
    { error: code },
    {
      status,
      headers: {
        ...MCP_HTTP_HEADERS,
        ...(error instanceof PairingRateError
          ? { "Retry-After": String(error.retryAfter) }
          : {}),
      },
    },
  );
}

/** Rejects duplicate and unbounded protocol parameters before invoking the OAuth library. */
export function uniqueOAuthParameters(
  parameters: URLSearchParams,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of parameters) {
    if (Object.hasOwn(result, key) || key.length > 100 || value.length > 4096)
      throw new McpAuthorizationError("invalid_request");
    result[key] = value;
  }
  return result;
}
