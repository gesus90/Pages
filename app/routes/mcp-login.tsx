import { useTranslation } from "react-i18next";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";

import { AuthHeading } from "@/app/components/auth/auth-heading";
import { AuthLayout } from "@/app/components/auth/auth-layout";
import { Button } from "@/app/components/ui/button";
import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { getSessionToken } from "@/app/lib/session.server";
import { clientSocketAddressContext } from "@/app/lib/client-address.server";
import { requireAuthorizationOrigin } from "@/app/lib/authorization-response.server";
import {
  MCP_HTTP_HEADERS,
  mcpHttpFailure,
  requireMcpHttp,
} from "@/app/lib/mcp-http.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { normalizePairingCode } from "@/backend/service/mcp/PairingValidation";

import type { PairingBrowserIdentity } from "@/definition/McpPairing";
import type { Route } from "./+types/mcp-login";

interface ConsentView {
  readonly id: string;
  readonly csrf: string;
  readonly clientName: string;
  readonly resource: string;
  readonly account: string;
}

function requestId(request: Request): string {
  const id = new URL(request.url).searchParams.get("request") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/u.test(id))
    throw new McpAuthorizationError("invalid_request");
  return id;
}

async function browserIdentity(
  request: Request,
): Promise<PairingBrowserIdentity> {
  const user = await getAuthenticatedUser(request);
  const session = await getSessionToken(request);
  const destination = `/mcp-login?request=${requestId(request)}`;
  if (!user || !session)
    throw redirect(`/login?returnTo=${encodeURIComponent(destination)}`, {
      headers: MCP_HTTP_HEADERS,
    });
  if (user.mustChangePassword)
    throw redirect(
      `/change-password?returnTo=${encodeURIComponent(destination)}`,
      { headers: MCP_HTTP_HEADERS },
    );
  return { userId: user.id, session };
}

/** Prevents caching and referrer leakage for consent and error states. */
export function headers(): Headers {
  return new Headers(MCP_HTTP_HEADERS);
}

/** Authenticates through ordinary Pages login; opening this page never grants access. */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    await requireMcpHttp(request, context.get(clientSocketAddressContext));
    if (!new URL(request.url).searchParams.has("request")) {
      const code = normalizePairingCode(
        new URL(request.url).searchParams.get("code"),
      );
      return redirect(code ? `/pair?code=${code}` : "/pair", {
        headers: MCP_HTTP_HEADERS,
      });
    }
    const browser = await browserIdentity(request);
    const services = await getApplicationServices();
    const user = await services.userService.getById(browser.userId);
    const view: ConsentView = {
      id: requestId(request),
      ...(await services.oauthService.view(requestId(request), browser)),
      account: `${user?.displayName ?? ""} (${user?.username ?? ""})`,
    };
    return Response.json(view, { headers: MCP_HTTP_HEADERS });
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    throw mcpHttpFailure(error);
  }
}

/** Explicit, CSRF-protected consent sends only a one-use code to the bound client redirect. */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<Response> {
  try {
    await requireMcpHttp(request, context.get(clientSocketAddressContext));
    requireAuthorizationOrigin(request);
    if (request.method !== "POST")
      throw new McpAuthorizationError("invalid_request", 405);
    const browser = await browserIdentity(request);
    const form = await request.formData();
    const location = await (
      await getApplicationServices()
    ).oauthService.decide(
      {
        id: requestId(request),
        csrf: form.get("csrf"),
        decision: form.get("decision"),
      },
      browser,
    );
    return redirect(location, { headers: MCP_HTTP_HEADERS });
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    throw mcpHttpFailure(error);
  }
}

/** Presents client, instance, account and lifetime before the deliberate browser decision. */
export default function McpLogin(): React.ReactElement {
  const view = useLoaderData<ConsentView>();
  const { t } = useTranslation();
  const pending = useNavigation().state !== "idle";
  return (
    <AuthLayout>
      <AuthHeading
        title={t("mcpHttp.title")}
        subtitle={t("mcpHttp.description")}
      />
      <dl className="my-6 space-y-3 text-sm">
        {[
          [t("mcpPairing.details.client"), view.clientName],
          [t("mcpHttp.instance"), view.resource],
          [t("mcpPairing.details.account"), view.account],
        ].map(([label, text]) => (
          <div key={label}>
            <dt className="font-medium">{label}</dt>
            <dd className="pages-selectable break-words">{text}</dd>
          </div>
        ))}
      </dl>
      <p className="mb-5 text-sm text-muted-foreground">
        {t("mcpHttp.lifetime")}
      </p>
      <Form method="post" className="flex gap-3">
        <input type="hidden" name="csrf" value={view.csrf} />
        <Button
          type="submit"
          name="decision"
          value="deny"
          variant="outline"
          disabled={pending}
        >
          {t("mcpHttp.deny")}
        </Button>
        <Button
          type="submit"
          name="decision"
          value="approve"
          disabled={pending}
        >
          {t("mcpHttp.approve")}
        </Button>
      </Form>
    </AuthLayout>
  );
}

/** Keeps expired and invalid consent requests inside the existing authentication layout. */
export function ErrorBoundary(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <AuthLayout>
      <AuthHeading title={t("mcpHttp.title")} subtitle={t("mcpHttp.error")} />
      <a href="/mcp-login" className="mt-5 inline-block text-sm underline">
        {t("mcpHttp.pair")}
      </a>
    </AuthLayout>
  );
}
