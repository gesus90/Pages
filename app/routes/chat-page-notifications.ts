import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { Route } from "./+types/chat-page-notifications";

/**
 * Sends the chats of the signed-in person with their newest message only,
 * which the notifications of the web interface follow instead of the
 * histories of the chat page.
 */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  const services = await getApplicationServices();
  const digest = await services.chatDirectoryService.notificationDigest(person);
  return Response.json(digest, { headers: { "Cache-Control": "no-store" } });
}
