import { redirect } from "react-router";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { getSessionToken } from "@/app/lib/session.server";
import { clientSocketAddressContext } from "@/app/lib/client-address.server";
import { requireAuthorizationOrigin } from "@/app/lib/authorization-response.server";
import {
  MCP_HTTP_HEADERS,
  mcpHttpFailure,
  requireMcpHttp,
} from "@/app/lib/mcp-http.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { normalizePairingCode } from "@/backend/service/mcp/PairingValidation";

import type { PairingBrowserIdentity } from "@/definition/McpPairing";
import type { ConsentView } from "./mcp-login";
import type { Route } from "./+types/mcp-login-server";

function requestId(request: Request): string {
  const id = new URL(request.url).searchParams.get("request") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/u.test(id))
    throw new McpAuthorizationError("invalid_request");
  return id;
}

async function browserIdentity(
  request: Request,
): Promise<PairingBrowserIdentity> {
  const user = await getAuthenticatedUser(request);
  const session = await getSessionToken(request);
  const destination = `/mcp-login?request=${requestId(request)}`;
  if (!user || !session)
    throw redirect(`/login?returnTo=${encodeURIComponent(destination)}`, {
      headers: MCP_HTTP_HEADERS,
    });
  if (user.mustChangePassword)
    throw redirect(
      `/change-password?returnTo=${encodeURIComponent(destination)}`,
      { headers: MCP_HTTP_HEADERS },
    );
  return { userId: user.id, session };
}

/**
 * Authenticates through ordinary Pages login; opening this page never grants access.
 *
 * @remarks
 * The endpoint `/app-api/mcp-login` answers with it (PAGE-235).
 */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    await requireMcpHttp(request, context.get(clientSocketAddressContext));
    if (!new URL(request.url).searchParams.has("request")) {
      const code = normalizePairingCode(
        new URL(request.url).searchParams.get("code"),
      );
      return redirect(code ? `/pair?code=${code}` : "/pair", {
        headers: MCP_HTTP_HEADERS,
      });
    }
    const browser = await browserIdentity(request);
    const services = await getApplicationServices();
    const user = await services.userService.getById(browser.userId);
    const view: ConsentView = {
      id: requestId(request),
      ...(await services.oauthService.view(requestId(request), browser)),
      account: `${user?.displayName ?? ""} (${user?.username ?? ""})`,
    };
    return Response.json(view, { headers: MCP_HTTP_HEADERS });
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    throw mcpHttpFailure(error);
  }
}

/** Explicit, CSRF-protected consent sends only a one-use code to the bound client redirect. */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<Response> {
  try {
    await requireMcpHttp(request, context.get(clientSocketAddressContext));
    requireAuthorizationOrigin(request);
    if (request.method !== "POST")
      throw new McpAuthorizationError("invalid_request", 405);
    const browser = await browserIdentity(request);
    const form = await request.formData();
    const location = await (
      await getApplicationServices()
    ).oauthService.decide(
      {
        id: requestId(request),
        csrf: form.get("csrf"),
        decision: form.get("decision"),
      },
      browser,
    );
    return redirect(location, { headers: MCP_HTTP_HEADERS });
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    throw mcpHttpFailure(error);
  }
}
