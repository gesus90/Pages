import { redirect } from "react-router";

import {
  clientSocketAddressContext,
  getClientAddress,
} from "@/app/lib/client-address.server";
import {
  authorizationFailure,
  requireAuthorizationOrigin,
} from "@/app/lib/authorization-response.server";
import {
  pairingBrowserIdentity,
  pairingReturnPath,
} from "@/app/lib/pairing-browser.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { destroySessionCookie } from "@/app/lib/session.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { PairingRateError } from "@/backend/service/mcp/PairingThrottle";
import { normalizePairingCode } from "@/backend/service/mcp/PairingValidation";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/pair-server";

const PAIR_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Loads a browser-safe view after ordinary Pages authentication.
 *
 * @remarks
 * The endpoint `/app-api/pair` answers with it (PAGE-235).
 */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const browser = await pairingBrowserIdentity(request);
    const services = await getApplicationServices();
    const view = await services.pairingService.view(
      new URL(request.url).searchParams.get("code"),
      browser,
      {
        socket: context.get(clientSocketAddressContext),
        forwarded: getClientAddress(request),
      },
    );
    return Response.json(
      {
        ...view,
        instanceOrigin:
          (await getPagesRuntime()).getConfig().mcpHttp?.publicUrl ??
          new URL(request.url).origin,
      },
      { headers: PAIR_HEADERS },
    );
  } catch (error: unknown) {
    logCaughtError("pair", error);

    if (error instanceof Response) throw error;
    if (error instanceof PairingRateError)
      return Response.json(
        {
          status: "entry",
          code: "",
          retryAfter: error.retryAfter,
          account: { displayName: "", username: "", isAdmin: false },
        },
        {
          status: 429,
          headers: { ...PAIR_HEADERS, "Retry-After": String(error.retryAfter) },
        },
      );
    const response = authorizationFailure(error);
    response.headers.set("Referrer-Policy", "no-referrer");
    throw response;
  }
}

/** Applies one session-bound decision, enters a code or switches the signed-in account. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  try {
    if (request.method !== "POST")
      throw new McpAuthorizationError("invalid_request", 405);
    requireAuthorizationOrigin(request);
    const browser = await pairingBrowserIdentity(request);
    const form = await request.formData();
    const services = await getApplicationServices();
    if (form.get("intent") === "switch-account") {
      await services.authService.logout(browser.session);
      return redirect(
        `/login?returnTo=${encodeURIComponent(pairingReturnPath(request))}`,
        {
          headers: {
            ...PAIR_HEADERS,
            "Set-Cookie": await destroySessionCookie(request),
          },
        },
      );
    }
    const code = normalizePairingCode(form.get("code"));
    if (!code) throw new McpAuthorizationError("invalid_code");
    if (form.get("intent") !== "enter-code") {
      const validity = form.get("validityDays");
      await services.pairingService.decide(
        {
          code,
          csrf: form.get("csrf"),
          decision: form.get("decision"),
          name: form.get("name"),
          validityDays:
            typeof validity === "string" && /^(0|[1-9]\d{0,2})$/.test(validity)
              ? Number(validity)
              : undefined,
          confirmMatch: form.get("confirmMatch") === "on",
        },
        browser,
      );
    }
    return redirect(`/pair?code=${code}`, { headers: PAIR_HEADERS });
  } catch (error: unknown) {
    logCaughtError("pair", error);

    if (error instanceof Response) throw error;
    const response = authorizationFailure(error);
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
}
