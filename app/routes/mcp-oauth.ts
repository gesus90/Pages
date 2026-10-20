import { readRequestBody } from "@modelcontextprotocol/server";
import { redirect } from "react-router";

import {
  clientSocketAddressContext,
  getClientAddress,
} from "@/app/lib/client-address.server";
import {
  MCP_HTTP_HEADERS,
  mcpHttpFailure,
  requireMcpHttp,
  uniqueOAuthParameters,
} from "@/app/lib/mcp-http.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type { Route } from "./+types/mcp-oauth";

/** Starts an OAuth request only after validating every redirect and resource binding. */
export async function loader({
  request,
  params,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const socket = context.get(clientSocketAddressContext);
    const { resource } = await requireMcpHttp(request, socket);
    if (params.endpoint !== "authorize")
      throw new McpAuthorizationError("invalid_request", 405);
    const parameters = new URL(request.url).searchParams;
    uniqueOAuthParameters(parameters);
    const id = await (
      await getApplicationServices()
    ).oauthService.begin(parameters, resource, {
      socket,
      forwarded: getClientAddress(request),
    });
    return redirect(`/mcp-login?request=${id}`, { headers: MCP_HTTP_HEADERS });
  } catch (error: unknown) {
    return mcpHttpFailure(error);
  }
}

/** Public registration and PKCE exchange use response bodies only, without cookie authority. */
export async function action({
  request,
  params,
  context,
}: Route.ActionArgs): Promise<Response> {
  try {
    const socket = context.get(clientSocketAddressContext);
    const { resource } = await requireMcpHttp(request, socket);
    if (request.method !== "POST")
      throw new McpAuthorizationError("invalid_request", 405);
    const service = (await getApplicationServices()).oauthService;
    const address = { socket, forwarded: getClientAddress(request) };
    const body = await readRequestBody(request, 16384);
    if (body.tooLarge) throw new McpAuthorizationError("invalid_request", 413);
    if (params.endpoint === "register") {
      if (!request.headers.get("Content-Type")?.startsWith("application/json"))
        throw new McpAuthorizationError("invalid_request");
      let registration: unknown;
      try {
        registration = JSON.parse(body.text);
      } catch {
        throw new McpAuthorizationError("invalid_request");
      }
      return Response.json(await service.register(registration, address), {
        status: 201,
        headers: MCP_HTTP_HEADERS,
      });
    }
    if (
      params.endpoint !== "token" ||
      !request.headers
        .get("Content-Type")
        ?.startsWith("application/x-www-form-urlencoded")
    )
      throw new McpAuthorizationError("invalid_request");
    if (request.headers.has("Authorization"))
      throw new McpAuthorizationError("invalid_client");
    return Response.json(
      await service.exchange(
        uniqueOAuthParameters(new URLSearchParams(body.text)),
        resource,
        address,
      ),
      { headers: MCP_HTTP_HEADERS },
    );
  } catch (error: unknown) {
    return mcpHttpFailure(error);
  }
}
