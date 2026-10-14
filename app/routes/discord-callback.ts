import { redirect } from "react-router";

import { getApplicationServices } from "@/app/lib/services.server";

import type { Route } from "./+types/discord-callback";

/**
 * Receives the browser after the Discord authorization, from any device.
 *
 * @remarks
 * It needs no Pages session: the phone that scanned the QR code is usually
 * not signed in. The one-time `state` is the proof, and the answer only
 * redirects to a page without the code and the state in its address. Nothing
 * is connected here; the person confirms server and channel in Pages.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  const parameters = new URL(request.url).searchParams;
  const services = await getApplicationServices();
  const outcome = await services.discordAuthorizationService.complete({
    code: parameters.get("code"),
    error: parameters.get("error"),
    guildId: parameters.get("guild_id"),
    state: parameters.get("state"),
  });

  return redirect(`/discord/result?outcome=${outcome}`, {
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
