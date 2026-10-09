import { rejectUnverifiedAgentCredential } from "@/backend/service/PagesAgentApiService";

import type { PagesAgentApiFailure } from "@/definition/PagesAgentApi";
import type { Route } from "./+types/api-v1-agents";

function respond(
  failure: PagesAgentApiFailure,
  status: number,
  additionalHeaders: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(failure, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...additionalHeaders,
    },
  });
}

function handleRequest(request: Request): Response {
  if (request.method !== "POST") {
    return respond(
      {
        apiVersion: "1",
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Use POST for the agent API.",
          retryable: false,
        },
      },
      405,
      { Allow: "POST" },
    );
  }

  if (
    !/^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(
      request.headers.get("Authorization") ?? "",
    )
  ) {
    return respond(
      {
        apiVersion: "1",
        error: {
          code: "AUTH_REQUIRED",
          message: "Bearer authentication is required.",
          retryable: false,
        },
      },
      401,
      { "WWW-Authenticate": "Bearer" },
    );
  }

  // Header syntax is not authentication. Do not read the body or UI cookies.
  return respond(rejectUnverifiedAgentCredential(), 503);
}

/** Reserves the versioned agent endpoint without any business operation. */
export function action({ request }: Route.ActionArgs): Response {
  return handleRequest(request);
}

/** Rejects reads with the same JSON contract used by mutation requests. */
export function loader({ request }: Route.LoaderArgs): Response {
  return handleRequest(request);
}
