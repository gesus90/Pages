import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";

import { clientSocketAddressContext } from "@/app/lib/client-address.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  MCP_HTTP_HEADERS,
  mcpHttpFailure,
  requireMcpHttp,
} from "@/app/lib/mcp-http.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { createHttpMcpServer } from "@/backend/service/mcp/HttpMcpOperations";

import type { Route } from "./+types/mcp";

async function handleRequest(
  request: Request,
  socket: string,
): Promise<Response> {
  let metadata: string | undefined;
  try {
    const { origin, resource } = await requireMcpHttp(request, socket);
    metadata = `${origin}/.well-known/oauth-protected-resource/mcp`;
    const authorization = /^Bearer ([A-Za-z0-9_-]{1,128})$/iu.exec(
      request.headers.get("Authorization") ?? "",
    );
    if (!authorization) throw new McpAuthorizationError("invalid_token", 401);
    const services = await getApplicationServices();
    const token = authorization[1];
    await services.oauthService.authenticate(token, resource);
    // Stateless transport has no session to resume or share with a different identity.
    if (request.headers.has("Mcp-Session-Id"))
      return new Response(null, { status: 400, headers: MCP_HTTP_HEADERS });
    if (request.method !== "POST")
      return new Response(null, {
        status: 405,
        headers: { ...MCP_HTTP_HEADERS, Allow: "POST" },
      });
    const server = createHttpMcpServer(services.pagesAgentApiService, token);
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      maxRequestBodySize: 65536,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      for (const [name, value] of Object.entries(MCP_HTTP_HEADERS))
        response.headers.set(name, value);
      return response;
    } finally {
      await server.close();
    }
  } catch (error: unknown) {
    const response = mcpHttpFailure(error);
    if (response.status === 401 && metadata)
      response.headers.set(
        "WWW-Authenticate",
        `Bearer resource_metadata="${metadata}", scope="pages", error="invalid_token"`,
      );
    return response;
  }
}

/** Serves SDK Streamable HTTP in the existing Pages process with fresh personal authorization. */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<Response> {
  return handleRequest(request, context.get(clientSocketAddressContext));
}

/** Authenticates even unsupported methods; no optional server stream is offered. */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  return handleRequest(request, context.get(clientSocketAddressContext));
}
