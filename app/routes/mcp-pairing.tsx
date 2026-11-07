import { useLoaderData } from "react-router";

import { AuthFooter } from "@/app/components/auth/auth-footer";
import { AuthLayout } from "@/app/components/auth/auth-layout";
import { McpPairingCard } from "@/app/components/mcp-pairing/mcp-pairing-card";
import { sendToBackend } from "@/app/lib/backend-request";
import { readRouteData } from "@/app/lib/local-state/route-data";

import type { McpPairingPageData } from "@/definition/McpDevice";
import type { Route } from "./+types/mcp-pairing";

const PAIRING_STATES: readonly unknown[] = [
  "open",
  "paired",
  "denied",
  "expired",
  "invalid",
  "missing",
];

function isMcpPairingPageData(value: unknown): value is McpPairingPageData {
  return (
    typeof value === "object" &&
    value !== null &&
    "state" in value &&
    PAIRING_STATES.includes(value.state) &&
    "server" in value &&
    typeof value.server === "object" &&
    value.server !== null &&
    "accountName" in value &&
    typeof value.accountName === "string"
  );
}

/**
 * Reads the pairing request from the API, which sends a visitor without a
 * session to sign in first (PAGE-243).
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<McpPairingPageData> {
  return readRouteData({
    endpoint: `/app-api/koppeln${new URL(request.url).search}`,
    signal: request.signal,
    isPayload: isMcpPairingPageData,
  });
}

/** Sends the decision to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/** Renders the confirmation of a machine pairing on the card of the sign-in. */
export default function McpPairingRoute(): React.ReactElement {
  const pairing = useLoaderData<typeof clientLoader>();

  return (
    <AuthLayout footer={<AuthFooter />}>
      <McpPairingCard pairing={pairing} />
    </AuthLayout>
  );
}
