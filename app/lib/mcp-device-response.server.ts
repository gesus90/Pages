import { DatabaseExecutorError } from "@/backend/database/executor/DatabaseExecutorErrors";
import { McpDeviceError } from "@/backend/error/McpDeviceError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { McpDeviceErrorCode } from "@/definition/McpDevice";

/** Largest body a device request may send; the bodies of the interface hold a few hundred bytes. */
const MAXIMUM_BODY_LENGTH = 4096;

const DEVICE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const;

/**
 * Answers a device request with JSON that no cache keeps.
 *
 * @param body - The answer of the interface.
 * @param status - The HTTP status.
 * @param headers - Further headers such as `Retry-After`.
 */
export function mcpDeviceResponse(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { ...DEVICE_HEADERS, ...headers },
  });
}

/** Answers with the fixed error body of the interface; never a detail. */
function errorResponse(
  code: McpDeviceErrorCode,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return mcpDeviceResponse({ error: code }, status, headers);
}

/**
 * Turns whatever a device route threw into the answer of the interface.
 *
 * @param error - The error of the route.
 * @returns The answer with `{ error }`, `Retry-After` for a limit.
 * @throws The error of the database executor, which the request middleware answers with `503`.
 *
 * @remarks
 * Nothing but the code leaves the server; the log names the error class
 * and never the request.
 */
export function mcpDeviceFailure(error: unknown): Response {
  if (error instanceof McpDeviceError)
    return errorResponse(
      error.code,
      error.status,
      error.retryAfterSeconds === null
        ? {}
        : { "Retry-After": String(error.retryAfterSeconds) },
    );
  if (error instanceof DatabaseExecutorError) throw error;
  logCaughtError("mcp_device", error);

  return errorResponse("temporarily_unavailable", 500);
}

/**
 * Answers a method the route does not serve.
 *
 * @param allowed - The methods of the route, for the `Allow` header.
 */
export function mcpDeviceMethodNotAllowed(allowed: string): Response {
  return errorResponse("invalid_request", 405, { Allow: allowed });
}

/**
 * Reads the JSON object of a device request.
 *
 * @param request - The request with `Content-Type: application/json`.
 * @returns The object; its fields are still untrusted.
 * @throws {McpDeviceError} `invalid_request` for another content type, a large body or no object.
 */
export async function readMcpDeviceBody(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new McpDeviceError("invalid_request");
  const text = await request.text();
  if (text.length > MAXIMUM_BODY_LENGTH)
    throw new McpDeviceError("invalid_request");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new McpDeviceError("invalid_request");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new McpDeviceError("invalid_request");
  return Object.fromEntries(Object.entries(body));
}
