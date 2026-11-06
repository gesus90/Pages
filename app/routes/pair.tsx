import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";

import { AuthLayout } from "@/app/components/auth/auth-layout";
import { AuthHeading } from "@/app/components/auth/auth-heading";
import { PairingEntry } from "@/app/components/pairing/pairing-entry";
import { PairingForm } from "@/app/components/pairing/pairing-form";
import { PairingState } from "@/app/components/pairing/pairing-state";
import { sendToBackend } from "@/app/lib/backend-request";
import { readRouteData } from "@/app/lib/local-state/route-data";

import type { McpPairingView } from "@/definition/McpPairing";
import type { Route } from "./+types/pair";

function isPairingView(value: unknown): value is McpPairingView {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    typeof value.status === "string"
  );
}

/**
 * Reads the browser-safe pairing view from the API after ordinary Pages
 * authentication (PAGE-235).
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<McpPairingView> {
  return readRouteData({
    endpoint: `/app-api/pair${new URL(request.url).search}`,
    signal: request.signal,
    isPayload: isPairingView,
  });
}

/** Sends the pairing decision to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
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
