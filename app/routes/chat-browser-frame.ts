import { authenticatedUserContext } from "@/app/lib/auth.server";
import { picaBrowserFailure } from "@/app/lib/pica-browser.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { PicaAdminError } from "@/backend/service/chat/admin/PicaAdminContracts";

import type { Route } from "./+types/chat-browser-frame";

/**
 * The newest picture of one of the administrator's operator browsers.
 *
 * @remarks
 * It is the real page as the administrator sees it, including what they type
 * during a takeover, so only the owner receives it and it is never cached.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  try {
    if (!actor) throw new PicaAdminError("ADMIN_REQUIRED");
    const service = (await getApplicationServices()).picaAdminService;
    const frame = await service.browserFrame(actor.id, params.browserId);
    if (!frame) return new Response(null, { status: 204 });
    return new Response(new Uint8Array(frame.bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Version": String(frame.version),
      },
    });
  } catch (error: unknown) {
    return picaBrowserFailure(error);
  }
}
