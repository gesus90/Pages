import { logCaughtError } from "@/backend/logging/Logger";

import type { GoogleDriveProblem } from "@/definition/GoogleDrive";

const REQUEST_TIMEOUT_MS = 10_000;

/** The part of `fetch` the Google clients use. */
export type GoogleFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Tells whether a value is a plain JSON object.
 *
 * @param value - A parsed JSON value.
 * @returns Whether it can be read by key.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a string field of a JSON object.
 *
 * @param record - The object.
 * @param key - The field.
 * @returns The string, or `""` when the field is missing or no string.
 */
export function readString(
  record: Record<string, unknown>,
  key: string,
): string {
  const entry = record[key];

  return typeof entry === "string" ? entry : "";
}

/**
 * Reads the JSON body of a Google answer.
 *
 * @param response - The answer.
 * @returns The body, or `null` when it is no JSON.
 */
export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (caughtError: unknown) {
    logCaughtError("GoogleDriveApiClient", caughtError);

    return null;
  }
}

/**
 * Names the `reason` of every error entry of a refused Drive request.
 *
 * @param body - The JSON body of the refusal.
 * @returns The reasons, possibly empty.
 */
export function readErrorReasons(body: unknown): string[] {
  if (!isRecord(body) || !isRecord(body["error"])) {
    return [];
  }

  const errors = body["error"]["errors"];

  if (!Array.isArray(errors)) {
    return [];
  }

  return errors.map((entry) =>
    isRecord(entry) ? readString(entry, "reason") : "",
  );
}

/**
 * Translates a refused Drive request.
 *
 * @param status - HTTP status of the refusal.
 * @param body - The JSON body of the refusal.
 * @returns The connection problem it shows.
 *
 * @remarks
 * A `403` names a disabled Drive API as `accessNotConfigured`, a missing scope
 * as `insufficientPermissions`; rate limits and quota are temporary.
 */
export function driveProblem(
  status: number,
  body: unknown,
): GoogleDriveProblem {
  if (status === 401) {
    return "access_revoked";
  }

  const reasons = readErrorReasons(body);

  if (reasons.includes("accessNotConfigured")) {
    return "drive_api_disabled";
  }

  if (
    reasons.includes("insufficientPermissions") ||
    reasons.includes("insufficientScopes")
  ) {
    return "scope_missing";
  }

  return "google_unreachable";
}

/**
 * Sends one request to Google with a timeout and without following redirects.
 *
 * @param fetcher - The `fetch` to use.
 * @param url - The Google address.
 * @param init - Method, headers and body.
 * @param timeoutMs - How long the whole exchange may take, body included;
 * downloads and uploads of the Storage interface need longer than metadata.
 * @returns The answer, or `null` when Google could not be reached.
 */
export async function sendGoogleRequest(
  fetcher: GoogleFetch,
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response | null> {
  try {
    return await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (caughtError: unknown) {
    logCaughtError("GoogleDriveApiClient", caughtError);

    return null;
  }
}
