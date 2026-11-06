import { createHmac } from "node:crypto";

import { readAuthorizationVersion } from "@/app/lib/local-state/local-state-audience.server";
import {
  admitPagesCore,
  PAGES_CORE_HEADERS,
  readPagesCoreJson,
  refusePagesCore,
  refusePagesCoreRead,
} from "@/app/lib/pages-core-request.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSessionToken } from "@/app/lib/session.server";
import { logCaughtError } from "@/backend/logging/Logger";
import { LiveChangeDecisions } from "@/backend/service/events/LiveChangeDecisions";
import { pagesCoreLiveRequestSchema } from "@/definition/PagesCoreContract";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { LiveSession } from "@/backend/service/events/LiveChangeDecisions";
import type { Route } from "./+types/api-core-v1-live-decisions";

/** HMAC of the session id: stable for the session, meaningless to the core. */
function sessionBinding(sessionId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`pages-core-session:${sessionId}`)
    .digest("hex");
}

async function readLiveSession(
  services: ApplicationServices,
  cookie: string,
  secret: string,
): Promise<LiveSession | null> {
  const token = await readSessionToken(cookie);
  const user = await services.authService.getAuthenticatedUser(token);
  if (!user || !token) return null;
  const sessionId = await services.sessionService.findSessionId(token);
  return sessionId
    ? { user, binding: sessionBinding(sessionId, secret) }
    : null;
}

async function decide(request: Request, secret: string): Promise<Response> {
  const parsed = pagesCoreLiveRequestSchema.safeParse(
    await readPagesCoreJson(request),
  );
  if (!parsed.success) return refusePagesCore(400);
  try {
    const services = await getApplicationServices();
    const decisions = new LiveChangeDecisions({
      audience: services.liveChangeAudience,
      readSession: async (cookie) => readLiveSession(services, cookie, secret),
      authorizationVersion: async (user) =>
        readAuthorizationVersion(services, user.id),
    });
    return Response.json(await decisions.decide(parsed.data), {
      headers: PAGES_CORE_HEADERS,
    });
  } catch (caughtError: unknown) {
    // The core delivers nothing without an answer; it never guesses.
    logCaughtError("api_core_live_decisions", caughtError);
    return refusePagesCore(503);
  }
}

/**
 * Decides for `pages-core` which session may learn about which outbox event (PAGE-237).
 *
 * @remarks
 * Only the core's shared secret admits a request, compared in constant time;
 * without `pagesCoreSecret` in the configuration the endpoint does not exist.
 * `pages-ingress` never forwards `/api/core/`, so browsers cannot reach it.
 * Bodies hold session cookies and are never logged.
 */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  const admission = await admitPagesCore(request);
  if (admission instanceof Response) return admission;
  return decide(request, admission.secret);
}

/** Answers 404 or 405: the decisions are requested with POST only. */
export async function loader(): Promise<Response> {
  return refusePagesCoreRead();
}
