import { getApplicationServices } from "@/app/lib/services.server";

import type { Route } from "./+types/instance-logo";

/**
 * Policy of the logo response.
 *
 * @remarks
 * The logo is meant to be shown in an `img` element. Should someone open its
 * address directly, an SVG still runs no script and loads nothing.
 */
const LOGO_CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * Returns the company logo as a binary response.
 *
 * @remarks
 * Open to visitors without a session, because the login page shows the logo.
 * Who may reach that page is up to the network setup around Pages.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  if (request.method !== "GET") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "GET" },
      status: 405,
    });
  }

  const services = await getApplicationServices();
  const logo = await services.instanceSettingsService.getLogo();

  if (!logo) {
    throw new Response("Not Found", { status: 404 });
  }

  return new Response(new Uint8Array(logo.data), {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Security-Policy": LOGO_CONTENT_SECURITY_POLICY,
      "Content-Type": logo.mimeType,
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
