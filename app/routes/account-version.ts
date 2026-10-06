import { data } from "react-router";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { Route } from "./+types/account-version";

/** Returns only the current account's authorization fingerprint, never cacheable. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<ReturnType<typeof data<{ version: string }>>> {
  const user = context.get(authenticatedUserContext);
  if (!user) throw new Response("Forbidden", { status: 403 });
  const services = await getApplicationServices();
  return data(
    { version: await services.administrationService.version(user.id) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
