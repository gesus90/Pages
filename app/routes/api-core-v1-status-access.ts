import {
  admitPagesCore,
  PAGES_CORE_HEADERS,
  readPagesCoreJson,
  refusePagesCore,
  refusePagesCoreRead,
} from "@/app/lib/pages-core-request.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSessionToken } from "@/app/lib/session.server";
import { isSystemSettingsGranted } from "@/app/lib/settings-actions/settings-system-access.server";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  PAGES_CORE_CONTRACT_VERSION,
  pagesCoreStatusAccessRequestSchema,
} from "@/definition/PagesCoreContract";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { PagesCoreStatusAccessResponse } from "@/definition/PagesCoreContract";
import type { Route } from "./+types/api-core-v1-status-access";

/** The same rule as the system settings: an active session in the active admin mode. */
async function isStatusAccessGranted(
  services: ApplicationServices,
  cookie: string,
): Promise<boolean> {
  const token = await readSessionToken(cookie);
  const user = await services.authService.getAuthenticatedUser(token);
  if (!user || user.mustChangePassword) return false;
  return isSystemSettingsGranted(services, user);
}

async function decideAccess(request: Request): Promise<Response> {
  const parsed = pagesCoreStatusAccessRequestSchema.safeParse(
    await readPagesCoreJson(request),
  );
  if (!parsed.success) return refusePagesCore(400);
  try {
    const services = await getApplicationServices();
    const answer: PagesCoreStatusAccessResponse = {
      contract: PAGES_CORE_CONTRACT_VERSION,
      access: (await isStatusAccessGranted(services, parsed.data.cookie))
        ? "granted"
        : "denied",
    };
    return Response.json(answer, { headers: PAGES_CORE_HEADERS });
  } catch (caughtError: unknown) {
    // Without an answer the core shows no details; it never guesses.
    logCaughtError("api_core_status_access", caughtError);
    return refusePagesCore(503);
  }
}

/**
 * Decides for `pages-core` whether a browser session may read the detailed service status (PAGE-238).
 *
 * @remarks
 * Only the core's shared secret admits a request (see `admitPagesCore`).
 * The core asks for every detailed status request and keeps no answer, so a
 * sign-out, an ended session or a revoked admin right shows no details from
 * the next request on. Bodies hold session cookies and are never logged.
 */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  const admission = await admitPagesCore(request);
  if (admission instanceof Response) return admission;
  return decideAccess(request);
}

/** Answers 404 or 405: the access is requested with POST only. */
export async function loader(): Promise<Response> {
  return refusePagesCoreRead();
}
