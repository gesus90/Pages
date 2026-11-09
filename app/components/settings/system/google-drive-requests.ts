import { z } from "zod";

import type {
  GoogleDriveActionResult,
  GoogleDriveStatus,
} from "@/definition/GoogleDrive";

/** The Google Drive endpoint of the system settings. */
const GOOGLE_DRIVE_ENDPOINT = "/settings-api/google-drive";

const statusSchema = z.object({
  state: z.enum([
    "not_configured",
    "disconnected",
    "connected",
    "reauthorization_required",
    "unavailable",
  ]),
  problem: z
    .enum([
      "access_revoked",
      "scope_missing",
      "client_invalid",
      "drive_api_disabled",
      "google_unreachable",
      "account_changed",
      "secret_unavailable",
    ])
    .nullable(),
  accountEmail: z.string().nullable(),
  missingSettings: z.array(z.string()),
  redirectUris: z.array(z.string()),
  canSignIn: z.boolean(),
  needsFolderAccess: z.boolean(),
  needsWriteAccess: z.boolean(),
  isSimulation: z.boolean(),
});

const actionSchema = z.union([
  z.object({ ok: z.literal(true), authorizeUrl: z.url() }),
  z.object({
    ok: z.literal(false),
    error: z.enum([
      "forbidden",
      "not_configured",
      "origin_not_allowed",
      "failed",
    ]),
  }),
]);

/**
 * Reads where the Google Drive connection stands; the server asks Drive itself.
 *
 * @param signal - Ends the request when the card leaves the page.
 * @returns The status, or `null` when it could not be read.
 */
export async function requestGoogleDriveStatus(
  signal: AbortSignal,
): Promise<GoogleDriveStatus | null> {
  try {
    const response = await fetch(GOOGLE_DRIVE_ENDPOINT, {
      headers: { Accept: "application/json" },
      signal,
    });

    if (!response.ok) {
      return null;
    }

    const parsed = statusSchema.safeParse(await response.json());

    return parsed.success ? parsed.data : null;
  } catch {
    // An aborted or failed request leaves the status unknown, never connected.
    return null;
  }
}

/** Which access a Google sign-in asks for. */
export type GoogleDriveAccessRequest = "read" | "write";

/**
 * Starts the Google sign-in.
 *
 * @param access - `write` asks for the additional write access of Storage
 * (PAGE-270); the existing connection stays unchanged when it is declined.
 * @returns The official Google link, or why the sign-in could not start.
 */
export async function requestGoogleDriveSignIn(
  access: GoogleDriveAccessRequest = "read",
): Promise<GoogleDriveActionResult> {
  const body = new URLSearchParams({ intent: "start" });

  if (access === "write") {
    body.set("access", "write");
  }

  try {
    const response = await fetch(GOOGLE_DRIVE_ENDPOINT, {
      body,
      method: "POST",
    });
    const parsed = actionSchema.safeParse(await response.json());

    return parsed.success ? parsed.data : { error: "failed", ok: false };
  } catch {
    // The card reports the failed start; nothing else depends on it.
    return { error: "failed", ok: false };
  }
}
