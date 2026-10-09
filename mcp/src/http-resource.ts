import { createMcpHandler } from "@modelcontextprotocol/server";

import { createServer } from "./server.js";
import { readVerifiedIdentity } from "./verification.js";

import type { HttpConfiguration } from "./http-configuration.js";

/** Protected-resource handler with per-request validation and distinct Pages API delegation. */
export interface ProtectedMcpResource {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly close: () => Promise<void>;
}

function denial(status: number, configuration: HttpConfiguration): Response {
  return Response.json(
    { error: status === 401 ? "invalid_token" : "temporarily_unavailable" },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": `Bearer resource_metadata="${configuration.resource.origin}/.well-known/oauth-protected-resource/mcp", scope="mcp:connect"`,
      },
    },
  );
}

async function delegate(
  configuration: HttpConfiguration,
  token: string,
): Promise<{
  readonly token: string;
  readonly userId: string;
  readonly expiresAt: number;
}> {
  const response = await fetch(`${configuration.issuer}/oauth/delegate`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      subject_token: token,
      resource: configuration.resource.href,
    }),
  });
  if (!response.ok)
    throw new Error(response.status === 401 ? "invalid_token" : "unavailable");
  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null)
    throw new Error("unavailable");
  const delegated = result as Record<string, unknown>;
  const identity = readVerifiedIdentity(delegated.identity);
  if (
    typeof delegated.delegationToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(delegated.delegationToken) ||
    delegated.audience !== configuration.agentsUrl.href ||
    typeof delegated.expiresAt !== "number" ||
    delegated.expiresAt <= Date.now() ||
    delegated.expiresAt > Date.now() + 60_000
  )
    throw new Error("unavailable");
  return {
    token: delegated.delegationToken,
    userId: identity.userId,
    expiresAt: delegated.expiresAt,
  };
}

/** Creates an isolated-per-request SDK handler; no identity or access token is kept between requests. */
export function createProtectedResource(
  configuration: HttpConfiguration,
): ProtectedMcpResource {
  const handler = createMcpHandler(
    ({ authInfo }) =>
      createServer(() => {
        if (!authInfo) throw new Error("Pages authorization failed.");
        return { agentsUrl: configuration.agentsUrl, token: authInfo.token };
      }),
    { responseMode: "json" },
  );
  return {
    close: () => handler.close(),
    fetch: async (request) => {
      const url = new URL(request.url);
      if (
        url.host !== configuration.resource.host ||
        (request.headers.has("origin") &&
          request.headers.get("origin") !== configuration.resource.origin) ||
        url.search
      ) {
        return Response.json({ error: "access_denied" }, { status: 403 });
      }
      if (
        request.method === "GET" &&
        [
          "/.well-known/oauth-protected-resource",
          "/.well-known/oauth-protected-resource/mcp",
        ].includes(url.pathname)
      ) {
        return Response.json({
          resource: configuration.resource.href,
          authorization_servers: [configuration.issuer],
          scopes_supported: ["mcp:connect"],
          bearer_methods_supported: ["header"],
        });
      }
      if (url.pathname !== "/mcp") return new Response(null, { status: 404 });
      const authorization = request.headers.get("authorization") ?? "";
      if (!/^Bearer [A-Za-z0-9_-]{43}$/i.test(authorization))
        return denial(401, configuration);
      try {
        const delegated = await delegate(configuration, authorization.slice(7));
        return await handler.fetch(request, {
          authInfo: {
            token: delegated.token,
            clientId: delegated.userId,
            scopes: ["mcp:connect"],
            expiresAt: Math.floor(delegated.expiresAt / 1000),
          },
        });
      } catch (error: unknown) {
        return denial(
          error instanceof Error && error.message === "invalid_token"
            ? 401
            : 503,
          configuration,
        );
      }
    },
  };
}
