import { redirect } from "react-router";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { getSessionToken } from "@/app/lib/session.server";
import { normalizePairingCode } from "@/backend/service/mcp/PairingValidation";

import type { PairingBrowserIdentity } from "@/definition/McpPairing";

/** Allows only the pairing route with one normalized code as a login return path. */
export function pairingReturnPath(request: Request): string {
  const code = normalizePairingCode(
    new URL(request.url).searchParams.get("code"),
  );
  return code ? `/pair?code=${code}` : "/pair";
}

/** Requires the ordinary browser session and mandatory-password gate for pairing. */
export async function pairingBrowserIdentity(
  request: Request,
): Promise<PairingBrowserIdentity> {
  const user = await getAuthenticatedUser(request);
  const session = await getSessionToken(request);
  if (!user || !session)
    throw redirect(
      `/login?returnTo=${encodeURIComponent(pairingReturnPath(request))}`,
      {
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  if (user.mustChangePassword)
    throw redirect("/change-password", {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  return { userId: user.id, session };
}
