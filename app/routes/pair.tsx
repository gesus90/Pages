import { useTranslation } from "react-i18next";
import { redirect, useLoaderData } from "react-router";

import { AuthLayout } from "@/app/components/auth/auth-layout";
import { AuthHeading } from "@/app/components/auth/auth-heading";
import { PairingEntry } from "@/app/components/pairing/pairing-entry";
import { PairingForm } from "@/app/components/pairing/pairing-form";
import { PairingState } from "@/app/components/pairing/pairing-state";
import {
  clientSocketAddressContext,
  getClientAddress,
} from "@/app/lib/client-address.server";
import {
  oauthFailure,
  requireOAuthOrigin,
} from "@/app/lib/oauth-response.server";
import {
  pairingBrowserIdentity,
  pairingReturnPath,
} from "@/app/lib/pairing-browser.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { destroySessionCookie } from "@/app/lib/session.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { PairingRateError } from "@/backend/service/mcp/PairingThrottle";
import { normalizePairingCode } from "@/backend/service/mcp/PairingValidation";

import type { McpPairingView } from "@/definition/McpPairing";
import type { Route } from "./+types/pair";

const PAIR_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

/** Prevents browser caching and referrer propagation across all pairing page states. */
export function headers(): Headers {
  return new Headers(PAIR_HEADERS);
}

/** Loads a browser-safe view after ordinary Pages authentication. */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const browser = await pairingBrowserIdentity(request);
    const services = await getApplicationServices();
    return Response.json(
      await services.pairingService.view(
        new URL(request.url).searchParams.get("code"),
        browser,
        {
          socket: context.get(clientSocketAddressContext),
          forwarded: getClientAddress(request),
        },
      ),
      { headers: PAIR_HEADERS },
    );
  } catch (error: unknown) {
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
    const response = oauthFailure(error);
    response.headers.set("Referrer-Policy", "no-referrer");
    throw response;
  }
}

/** Applies one session-bound decision, enters a code or switches the signed-in account. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  try {
    if (request.method !== "POST")
      throw new McpAuthorizationError("invalid_request", 405);
    requireOAuthOrigin(request);
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
    if (error instanceof Response) throw error;
    const response = oauthFailure(error);
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
}

/** Composes the code entry, explicit approval form and terminal states. */
export default function PairRoute(): React.ReactElement {
  const view = useLoaderData<McpPairingView>();
  const { t } = useTranslation();
  return (
    <AuthLayout>
      {view.status === "pending" ? (
        <>
          <AuthHeading
            title={t("mcpPairing.title")}
            subtitle={t("mcpPairing.subtitle")}
          />
          <PairingForm key={view.code} view={view} />
        </>
      ) : (
        <PairingState view={view} />
      )}
      {view.status === "entry" || view.status === "invalid" ? (
        <PairingEntry retryAfter={view.retryAfter} />
      ) : null}
    </AuthLayout>
  );
}

/** Keeps unexpected route failures inside the same authentication card. */
export function ErrorBoundary(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <AuthLayout>
      <AuthHeading
        title={t("mcpPairing.title")}
        subtitle={t("mcpPairing.error.decision")}
      />
      <p
        role="alert"
        className="pages-selectable mt-4 text-sm text-destructive"
      >
        {t("mcpPairing.error.decision")}
      </p>
      <PairingEntry />
    </AuthLayout>
  );
}
