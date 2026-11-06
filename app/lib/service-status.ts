import {
  SERVICE_STATUS_DETAILS_PATH,
  SERVICE_STATUS_PATH,
  serviceStatusDetailsSchema,
  serviceStatusSchema,
} from "@/definition/ServiceStatus";

import type {
  ServiceStatusDetails,
  ServiceStatusLight,
} from "@/definition/ServiceStatus";

/**
 * What the browser learned about the detailed service status.
 *
 * @remarks
 * - `granted`: the services in detail.
 * - `denied`: the session may not read them; only the light.
 * - `unconfirmed`: `pages-core` could not confirm the session with the API,
 *   for instance while the API is stopped; only the light.
 * - `unreachable`: no status at all, such as without `pages-core`.
 */
export type ServiceStatusReading =
  | { readonly kind: "granted"; readonly details: ServiceStatusDetails }
  | {
      readonly kind: "denied" | "unconfirmed";
      readonly light: ServiceStatusLight;
    }
  | { readonly kind: "unreachable" };

/** Status requests are never answered from a cache and end after this time. */
const REQUEST_TIMEOUT_MS = 5000;

async function fetchStatus(
  path: string,
  signal: AbortSignal,
): Promise<{ readonly status: number; readonly body: unknown } | null> {
  try {
    const response = await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ]),
    });
    const isJson =
      response.headers.get("Content-Type")?.startsWith("application/json") ??
      false;
    return {
      status: response.status,
      body: isJson ? await response.json() : null,
    };
  } catch {
    // A refused connection, a timeout or a cancelled poll all mean: no status
    // now. The next poll asks again; a warning every few seconds helps nobody.
    return null;
  }
}

/**
 * Reads the public light of all services from `pages-core` (PAGE-238).
 *
 * @param signal - Ends the request when the caller is gone.
 * @returns The light, or `null` when no status can be read.
 *
 * @remarks
 * The request goes to the entrance, which passes it to `pages-core`; the API
 * takes no part, so the light stays readable while the API is stopped.
 */
export async function readServiceStatusLight(
  signal: AbortSignal,
): Promise<ServiceStatusLight | null> {
  const answer = await fetchStatus(SERVICE_STATUS_PATH, signal);
  if (answer?.status !== 200) return null;
  const parsed = serviceStatusSchema.safeParse(answer.body);
  return parsed.success ? parsed.data.light : null;
}

/**
 * Reads the detailed service status, which only an admin session receives.
 *
 * @param signal - Ends the request when the caller is gone.
 * @returns What the browser may show; details only on a confirmed `200`.
 */
export async function readServiceStatusDetails(
  signal: AbortSignal,
): Promise<ServiceStatusReading> {
  const answer = await fetchStatus(SERVICE_STATUS_DETAILS_PATH, signal);
  if (!answer) return { kind: "unreachable" };
  if (answer.status === 200) {
    const details = serviceStatusDetailsSchema.safeParse(answer.body);
    return details.success
      ? { kind: "granted", details: details.data }
      : { kind: "unreachable" };
  }
  const light = serviceStatusSchema.safeParse(answer.body);
  if (!light.success) return { kind: "unreachable" };
  return {
    kind: answer.status === 403 ? "denied" : "unconfirmed",
    light: light.data.light,
  };
}
