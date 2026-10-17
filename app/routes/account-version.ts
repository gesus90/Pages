import { data } from "react-router";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { recordAccountAuthorizationVersion } from "@/backend/logging/AccountAuthorizationLog";

import type { Route } from "./+types/account-version";

/** Returns only the current account's authorization fingerprint, never cacheable. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<ReturnType<typeof data<{ version: string }>>> {
  const user = context.get(authenticatedUserContext);
  if (!user) throw new Response("Forbidden", { status: 403 });
  const services = await getApplicationServices();
  const version = await services.administrationService.version(user.id);
  recordAccountAuthorizationVersion(user.id, version);
  return data({ version }, { headers: { "Cache-Control": "no-store" } });
}
