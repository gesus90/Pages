import { authenticatedUserContext } from "@/app/lib/auth.server";
import { picaBrowserFailure } from "@/app/lib/pica-browser.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { PicaAdminError } from "@/backend/service/chat/admin/PicaAdminContracts";

import type { Route } from "./+types/chat-browser-download";

/**
 * Sends a file an operator browser downloaded to its administrator.
 *
 * @remarks
 * The file is always an attachment of an unknown type, so a downloaded page
 * or script cannot run in the origin of Pages.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  try {
    if (!actor) throw new PicaAdminError("ADMIN_REQUIRED");
    const service = (await getApplicationServices()).picaAdminService;
    const file = await service.browserDownload(
      actor.id,
      params.browserId,
      params.downloadId,
    );
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    return picaBrowserFailure(error);
  }
}
