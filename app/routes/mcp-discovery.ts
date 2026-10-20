import { clientSocketAddressContext } from "@/app/lib/client-address.server";
import {
  MCP_HTTP_HEADERS,
  mcpHttpFailure,
  requireMcpHttp,
} from "@/app/lib/mcp-http.server";

import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type { Route } from "./+types/mcp-discovery";

/** RFC 9728 and RFC 8414 addresses always derive from explicitly configured trust. */
export async function loader({
  request,
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  try {
    if (
      !["oauth-protected-resource", "oauth-authorization-server"].includes(
        params.document ?? "",
      ) ||
      (params.resource !== undefined &&
        (params.document !== "oauth-protected-resource" ||
          params.resource !== "mcp"))
    )
      throw new McpAuthorizationError("not_found", 404);
    const { origin, resource } = await requireMcpHttp(
      request,
      context.get(clientSocketAddressContext),
    );
    const pathname = new URL(request.url).pathname;
    const result = pathname.includes("oauth-protected-resource")
      ? {
          resource,
          authorization_servers: [origin],
          scopes_supported: ["pages"],
          bearer_methods_supported: ["header"],
        }
      : {
          issuer: origin,
          authorization_endpoint: `${origin}/oauth/authorize`,
          token_endpoint: `${origin}/oauth/token`,
          registration_endpoint: `${origin}/oauth/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["pages"],
          client_id_metadata_document_supported: false,
        };
    return Response.json(result, { headers: MCP_HTTP_HEADERS });
  } catch (error: unknown) {
    return mcpHttpFailure(error);
  }
}
