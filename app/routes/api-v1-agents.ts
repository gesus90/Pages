import { getApplicationServices } from "@/app/lib/services.server";
import { readOAuthJson } from "@/app/lib/oauth-response.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type { PagesAgentApiErrorCode } from "@/definition/PagesAgentApi";
import type { Route } from "./+types/api-v1-agents";

function failure(code: PagesAgentApiErrorCode, status: number): Response {
  return Response.json(
    {
      apiVersion: "1",
      error: {
        code,
        message: "The agent API request was rejected.",
        retryable: false,
      },
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
        ...(status === 405 ? { Allow: "POST" } : {}),
      },
    },
  );
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return failure("METHOD_NOT_ALLOWED", 405);
  const authorization = request.headers.get("Authorization") ?? "";
  if (!/^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(authorization))
    return failure("AUTH_REQUIRED", 401);
  try {
    const services = await getApplicationServices();
    // Verify before reading input; browser cookies and caller-supplied identities never participate.
    const token = authorization.slice(7);
    await services.pagesAgentApiService.verify(token);
    const result = await services.pagesAgentApiService.handle(
      token,
      await readOAuthJson(request),
    );
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    if (!(error instanceof McpAuthorizationError))
      return failure("AUTH_UNAVAILABLE", 503);
    if (error.status === 401) return failure("AUTH_INVALID", 401);
    return failure(
      error.status === 403 ? "FORBIDDEN" : "INVALID_REQUEST",
      error.status,
    );
  }
}

/** Handles only verified A9.2 API operations; no business tools exist in this stage. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return handleRequest(request);
}

/** Rejects reads using the stable JSON method error. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return handleRequest(request);
}
