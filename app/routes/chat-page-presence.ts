import { z } from "zod";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { sharedPicaMobileConversationPresence } from "@/backend/service/mobile/conversations/PicaMobileConversationPresence";

import type { Route } from "./+types/chat-page-presence";

const heartbeatSchema = z.object({
  connectionId: z.string().uuid(),
  chatKey: z
    .string()
    .regex(/^(group|participant):[^\s:]{1,200}$/u)
    .nullable(),
  conversationId: z.string().min(1).max(200).nullable(),
});
const calls = new Map<string, { count: number; until: number }>();

function permit(accountId: string): boolean {
  const now = Date.now();
  const current = calls.get(accountId);
  if (current === undefined || current.until <= now) {
    calls.set(accountId, { count: 1, until: now + 60_000 });
    return true;
  }
  if (current.count >= 120) return false;
  calls.set(accountId, { count: current.count + 1, until: current.until });
  return true;
}

/** Reads the account's visible chats and current toast choices. */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  const user = context.get(authenticatedUserContext);
  if (!user) throw new Response("Forbidden", { status: 403 });
  const services = await getApplicationServices();
  const choices = await services.picaMobileNotifications.readChoices(user.id);
  return Response.json(
    {
      ...sharedPicaMobileConversationPresence().visibleChats(user.id),
      choices,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Records a signed-in browser tab's visible chat for at most 45 seconds. */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<Response> {
  const user = context.get(authenticatedUserContext);
  if (!user) throw new Response("Forbidden", { status: 403 });
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (!permit(user.id)) return new Response(null, { status: 429 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = heartbeatSchema.safeParse(payload);
  if (!parsed.success) return new Response(null, { status: 400 });
  const { connectionId, chatKey, conversationId } = parsed.data;
  if (chatKey?.startsWith("group:") && chatKey.slice(6) !== conversationId) {
    return new Response(null, { status: 400 });
  }
  if (chatKey !== null && conversationId !== null) {
    const services = await getApplicationServices();
    if (
      !(await services.conversationReader.isMember(user.id, conversationId))
    ) {
      return new Response(null, { status: 403 });
    }
  }
  sharedPicaMobileConversationPresence().setBrowser(
    user.id,
    connectionId,
    chatKey,
    chatKey === null ? null : conversationId,
  );
  return new Response(null, { status: 204 });
}
