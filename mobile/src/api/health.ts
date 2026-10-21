import {
  HttpStatusError,
  InvalidResponseError,
  isPagesApiError,
} from "./api-error";

import type { PagesClient, RequestOptions } from "./pages-client";

/**
 * What the unauthenticated `GET /health` endpoint of Pages reports: `ok` when
 * the database answers, `setup` while the setup wizard is pending and
 * `unavailable` when the database does not answer.
 */
export type PagesHealthStatus = "ok" | "setup" | "unavailable";

/** How the app sees its connection to the Pages server. */
export type ConnectionStatus =
  | "unconfigured"
  | "offline"
  | "checking"
  | "connected"
  | "setupPending"
  | "unreachable"
  | "serverError"
  | "notPages";

function isHealthStatus(value: unknown): value is PagesHealthStatus {
  return value === "ok" || value === "setup" || value === "unavailable";
}

function parseHealth(value: unknown): PagesHealthStatus {
  if (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    isHealthStatus(value.status)
  ) {
    return value.status;
  }

  throw new InvalidResponseError("The health answer has an unknown status.");
}

function statusOfHealth(health: PagesHealthStatus): ConnectionStatus {
  if (health === "setup") {
    return "setupPending";
  }

  return health === "ok" ? "connected" : "serverError";
}

function statusOfFailure(error: unknown): ConnectionStatus {
  if (!isPagesApiError(error)) {
    throw error;
  }

  if (error instanceof HttpStatusError) {
    // Pages itself answers 503 when its database does not; any other 4xx
    // status, such as a 404, comes from something that is not Pages.
    return error.status >= 500 ? "serverError" : "notPages";
  }

  return error.kind === "invalid-response" ? "notPages" : "unreachable";
}

/**
 * Asks the Pages server whether it is up.
 *
 * @param client - Client of the configured server.
 * @param options - Per-request settings, such as the abort signal.
 * @returns The connection status the answer, or the failure, stands for. The
 * foundation only proves that a Pages server answers; no session is opened.
 */
export async function checkServerConnection(
  client: PagesClient,
  options: RequestOptions = {},
): Promise<ConnectionStatus> {
  try {
    return statusOfHealth(
      await client.getJson("/health", parseHealth, options),
    );
  } catch (error: unknown) {
    return statusOfFailure(error);
  }
}
