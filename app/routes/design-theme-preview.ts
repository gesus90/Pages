import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { Route } from "./+types/design-theme-preview";

/**
 * Policy of the preview image response.
 *
 * @remarks
 * The image is meant to be shown in an `img` element. Should someone open its
 * address directly, nothing may run or load.
 */
const PREVIEW_CONTENT_SECURITY_POLICY = "default-src 'none'; sandbox";

/**
 * Returns the preview image of an installed design theme.
 *
 * @remarks
 * Only signed-in visitors see it, as the appearance settings are the only
 * place that shows it. The address names the theme; the file behind it is
 * chosen by the theme's manifest, never by the request.
 */
export async function loader({
  request,
  params,
  context,
}: Route.LoaderArgs): Promise<Response> {
  if (request.method !== "GET") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "GET" },
      status: 405,
    });
  }

  if (!context.get(authenticatedUserContext)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const services = await getApplicationServices();
  const image = await services.designThemeService.readPreviewImage(
    params.designThemeId,
  );

  if (!image) {
    throw new Response("Not Found", { status: 404 });
  }

  return new Response(new Uint8Array(image.data), {
    headers: {
      "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": PREVIEW_CONTENT_SECURITY_POLICY,
      "Content-Type": image.contentType,
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
