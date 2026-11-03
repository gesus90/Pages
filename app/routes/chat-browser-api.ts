import { authenticatedUserContext } from "@/app/lib/auth.server";
import { CHAT_NO_STORE, readChatJson } from "@/app/lib/chat-response.server";
import { picaBrowserFailure } from "@/app/lib/pica-browser.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { PicaAdminError } from "@/backend/service/chat/admin/PicaAdminContracts";
import { picaBrowserCommandSchema } from "@/definition/PicaBrowser";

import type { Route } from "./+types/chat-browser-api";

/**
 * The live interface of the operator browser in the chat (PAGE-181).
 *
 * @remarks
 * POST from the own origin only. `overview` lists the administrator's
 * browsers and saved sessions; `command` pauses, stops, takes over or hands
 * back one of them, relays input during a takeover, saves a signed-in session
 * or approves changes to local services. Every call resolves the
 * administrator right afresh and acts only on the caller's own browsers.
 * Typed text goes to the page and is never logged or answered.
 */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  try {
    if (
      !actor ||
      request.method !== "POST" ||
      request.headers.get("Origin") !== new URL(request.url).origin
    )
      throw new PicaAdminError("ADMIN_REQUIRED");
    const service = (await getApplicationServices()).picaAdminService;
    const input = await readChatJson(request);
    if (input.intent === "overview")
      return Response.json(
        { ok: true, ...(await service.browserOverview(actor.id)) },
        { headers: CHAT_NO_STORE },
      );
    const command = picaBrowserCommandSchema.safeParse(input.command);
    if (
      input.intent !== "command" ||
      typeof input.browserId !== "string" ||
      !command.success
    )
      throw new PicaAdminError("INVALID_ARGUMENTS");
    const browser = await service.browserCommand(
      actor.id,
      input.browserId,
      command.data,
    );
    return Response.json({ ok: true, browser }, { headers: CHAT_NO_STORE });
  } catch (error: unknown) {
    return picaBrowserFailure(error);
  }
}
