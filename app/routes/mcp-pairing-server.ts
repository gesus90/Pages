import { redirect } from "react-router";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { destroySessionCookie } from "@/app/lib/session.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { formatUserCode, normalizeUserCode } from "@/definition/McpDevice";

import type { McpPairingPageData } from "@/definition/McpDevice";
import type { User } from "@/definition/User";
import type { Route } from "./+types/mcp-pairing-server";

/** The address of the page, with the code the visitor came with. */
function pairingAddress(code: string | null): string {
  const userCode = normalizeUserCode(code);

  if (userCode !== null) {
    return `/koppeln?code=${formatUserCode(userCode)}`;
  }

  return code === null || code === ""
    ? "/koppeln"
    : `/koppeln?code=${encodeURIComponent(code.slice(0, 40))}`;
}

/** Sends a visitor without a session to sign in, and back here with the code kept. */
async function signInRedirect(
  request: Request,
  code: string | null,
): Promise<Response> {
  return redirect(
    `/login?returnTo=${encodeURIComponent(pairingAddress(code))}`,
    { headers: { "Set-Cookie": await destroySessionCookie(request) } },
  );
}

async function requireAccount(
  request: Request,
  code: string | null,
): Promise<User> {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    throw await signInRedirect(request, code);
  }

  if (user.mustChangePassword) {
    throw redirect("/change-password");
  }

  return user;
}

/**
 * Shows the pairing request of a code to the signed-in account (PAGE-243).
 *
 * @remarks
 * The endpoint `/app-api/koppeln` answers with it. A visitor without a
 * session is sent to sign in and returns here with the code kept. Nothing
 * but the machine name, the server and the account's own name is shown.
 */
export async function loader({
  request,
}: Route.LoaderArgs): Promise<McpPairingPageData | Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const user = await requireAccount(request, code);
  const services = await getApplicationServices();
  const inspection = await services.mcpDevicePairingService.inspect(
    code,
    user.id,
  );

  return {
    state: inspection.state,
    code: inspection.code,
    deviceName: inspection.deviceName,
    remainingMs:
      inspection.expiresAt === null ? null : inspection.expiresAt - Date.now(),
    server: { host: url.host, isSecure: url.protocol === "https:" },
    accountName: user.displayName,
  };
}

/**
 * Takes the decision of the person: pair or reject (PAGE-243).
 *
 * @remarks
 * Only a form post of this site decides; the check of the origin is on top of
 * the one React Router makes. A code that was decided before keeps its first
 * decision. The answer is a redirect to the page, which shows the result.
 */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  if (request.headers.get("origin") !== new URL(request.url).origin) {
    throw new Response("Forbidden", { status: 403 });
  }

  const form = await request.formData();
  const field = form.get("code");
  const code = typeof field === "string" ? field : null;
  const decision = form.get("decision");
  const user = await requireAccount(request, code);

  if (decision !== "approve" && decision !== "deny") {
    throw new Response("Bad Request", { status: 400 });
  }

  const services = await getApplicationServices();
  await services.mcpDevicePairingService.decide({
    code,
    userId: user.id,
    decision: decision === "approve" ? "approved" : "denied",
  });

  return redirect(pairingAddress(code));
}
