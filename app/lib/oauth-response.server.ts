import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

/** Sends a credential-safe OAuth/API response that cannot be cached. */
export function oauthResponse(result: unknown, status = 200): Response {
  return Response.json(result, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Replaces all untrusted diagnostics with a fixed, non-reflecting OAuth error. */
export function oauthFailure(error: unknown): Response {
  return oauthResponse(
    {
      error:
        error instanceof McpAuthorizationError
          ? error.code
          : "temporarily_unavailable",
    },
    error instanceof McpAuthorizationError ? error.status : 503,
  );
}

/** Validates a bounded JSON object before a route passes it to business logic. */
export async function readOAuthJson(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new McpAuthorizationError("invalid_request");
  const text = await request.text();
  if (text.length > 65_536) throw new McpAuthorizationError("invalid_request");
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new McpAuthorizationError("invalid_request");
  }
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new McpAuthorizationError("invalid_request");
  return input as Record<string, unknown>;
}

/** Requires same-origin browser mutations; authorization endpoints never use browser cookies as client auth. */
export function requireOAuthOrigin(request: Request): void {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new McpAuthorizationError("access_denied", 403);
}
