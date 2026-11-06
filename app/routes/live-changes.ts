import {
  authenticatedUserContext,
  getAuthenticatedUser,
} from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { LiveAccount } from "@/backend/service/events/LiveChangeHub";
import type { Route } from "./+types/live-changes";

/** Longer than any fingerprint the pages hold; anything longer is foreign. */
const MAXIMUM_VERSION_LENGTH = 200;

/** The same fingerprint as `/account-version` and the workspace loader. */
async function accountVersion(
  services: ApplicationServices,
  userId: string,
): Promise<string> {
  const version = await services.administrationService.version(userId);
  const pica = await services.picaSettingsService.read();
  return `${version}:pica:${pica.revision}`;
}

/**
 * Streams live notices to one signed-in page as SSE: kind and id, never content.
 *
 * @remarks
 * The session is read again before each round of notices, so an ended
 * session closes the stream and changed rights send `resync`. The browser
 * reads the data itself through the regular rights-checked loaders.
 */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  const user = context.get(authenticatedUserContext);
  if (!user) throw new Response("Forbidden", { status: 403 });
  const userId = user.id;
  const services = await getApplicationServices();
  const requested = new URL(request.url).searchParams.get("version") ?? "";
  const version = requested.length <= MAXIMUM_VERSION_LENGTH ? requested : "";
  async function account(): Promise<LiveAccount | null> {
    const current = await getAuthenticatedUser(request);
    if (!current || current.mustChangePassword || current.id !== userId)
      return null;
    return {
      user: current,
      version: await accountVersion(services, current.id),
    };
  }
  return new Response(
    services.liveChangeHub.open({ account, version, signal: request.signal }),
    {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Accel-Buffering": "no",
      },
    },
  );
}
