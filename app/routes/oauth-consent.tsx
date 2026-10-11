import { useTranslation } from "react-i18next";
import { Form, redirect, useLoaderData } from "react-router";

import { AuthLayout } from "@/app/components/auth/auth-layout";
import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { getSessionToken } from "@/app/lib/session.server";
import {
  oauthFailure,
  requireOAuthOrigin,
} from "@/app/lib/oauth-response.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type {
  OAuthConsentView,
  OAuthBrowserIdentity,
} from "@/backend/service/mcp/OAuthConsentService";
import type { Route } from "./+types/oauth-consent";

async function browserIdentity(
  request: Request,
): Promise<OAuthBrowserIdentity> {
  const user = await getAuthenticatedUser(request);
  const session = await getSessionToken(request);
  if (!user || !session) {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new McpAuthorizationError("invalid_request");
    throw redirect(
      `/login?returnTo=${encodeURIComponent(`/oauth/consent?id=${id}`)}`,
    );
  }
  if (user.mustChangePassword) throw redirect("/change-password");
  return { userId: user.id, session };
}

/** Loads explicit Pages consent after the existing browser login. */
export async function loader({
  request,
}: Route.LoaderArgs): Promise<OAuthConsentView | Response> {
  try {
    const browser = await browserIdentity(request);
    const services = await getApplicationServices();
    return await services.oauthConsentService.view(
      new URL(request.url).searchParams.get("id") ?? "",
      browser,
    );
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    throw oauthFailure(error);
  }
}

/** Applies one session-bound approval or denial and redirects only to a validated callback. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  try {
    if (request.method !== "POST")
      throw new McpAuthorizationError("invalid_request", 405);
    requireOAuthOrigin(request);
    const browser = await browserIdentity(request);
    const form = await request.formData();
    const csrf = form.get("csrf");
    const decision = form.get("decision");
    if (
      typeof csrf !== "string" ||
      (decision !== "approve" && decision !== "deny")
    )
      throw new McpAuthorizationError("invalid_request");
    const services = await getApplicationServices();
    const destination = await services.oauthConsentService.decide(
      {
        id: new URL(request.url).searchParams.get("id") ?? "",
        csrf,
        approved: decision === "approve",
      },
      browser,
    );
    return redirect(destination, {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    return oauthFailure(error);
  }
}

/** Displays the requesting client and exact protected resource before approval. */
export default function OAuthConsentRoute(): React.ReactElement {
  const consent = useLoaderData<OAuthConsentView>();
  const { t } = useTranslation();
  return (
    <AuthLayout>
      <h1 className="text-xl font-semibold">{t("mcpConsent.title")}</h1>
      <p className="mt-4">{t("mcpConsent.description")}</p>
      <dl className="mt-4 space-y-2 break-all">
        <dt className="font-semibold">{t("mcpConsent.client")}</dt>
        <dd>
          {consent.clientName} ({consent.clientId})
        </dd>
        <dt className="font-semibold">{t("mcpConsent.resource")}</dt>
        <dd>{consent.resource}</dd>
        <dt className="font-semibold">{t("mcpConsent.scope")}</dt>
        <dd>mcp:connect</dd>
      </dl>
      <Form method="post" className="mt-6 flex gap-4">
        <input type="hidden" name="csrf" value={consent.csrf} />
        <button
          type="submit"
          name="decision"
          value="approve"
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground"
        >
          {t("mcpConsent.approve")}
        </button>
        <button
          type="submit"
          name="decision"
          value="deny"
          className="rounded-lg border px-4 py-2"
        >
          {t("mcpConsent.deny")}
        </button>
      </Form>
    </AuthLayout>
  );
}
