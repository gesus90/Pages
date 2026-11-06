import { useTranslation } from "react-i18next";
import { Form, useLoaderData, useNavigation } from "react-router";

import { AuthHeading } from "@/app/components/auth/auth-heading";
import { AuthLayout } from "@/app/components/auth/auth-layout";
import { Button } from "@/app/components/ui/button";
import { sendToBackend } from "@/app/lib/backend-request";
import { readRouteData } from "@/app/lib/local-state/route-data";

import type { Route } from "./+types/mcp-login";

/** What the consent page shows, as the endpoint answers it. */
export interface ConsentView {
  readonly id: string;
  readonly csrf: string;
  readonly clientName: string;
  readonly resource: string;
  readonly account: string;
}

function isConsentView(value: unknown): value is ConsentView {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "csrf" in value &&
    typeof value.csrf === "string"
  );
}

/**
 * Reads the consent view from the API; opening this page never grants
 * access (PAGE-235).
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<ConsentView> {
  return readRouteData({
    endpoint: `/app-api/mcp-login${new URL(request.url).search}`,
    signal: request.signal,
    isPayload: isConsentView,
  });
}

/** Sends the consent decision to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
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
