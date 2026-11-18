import { z } from "zod";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { ConversationError } from "@/backend/error/ConversationError";
import {
  chatLastChatSchema,
  chatReadingPositionSchema,
} from "@/definition/ConversationContent";

import type { Route } from "./+types/chat-page-view";

const viewChangeSchema = z.discriminatedUnion("type", [
  chatLastChatSchema.extend({ type: z.literal("last-chat") }),
  chatReadingPositionSchema.extend({ type: z.literal("reading-position") }),
]);

/**
 * Stores what a person's chat page reopens with: the chat used last, or where
 * they stopped reading in one.
 * @remarks
 * The page sends this with `keepalive`, so a change made right before the
 * person leaves the page or closes the tab still arrives; a router fetcher
 * would be cancelled with the page.
 */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<Response> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  if (request.method !== "POST") return new Response(null, { status: 405 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error: unknown) {
    if (error instanceof SyntaxError)
      return new Response(null, { status: 400 });
    throw error;
  }
  const change = viewChangeSchema.safeParse(payload);
  if (!change.success) return new Response(null, { status: 400 });
  const { chatViewPreferences } = await getApplicationServices();
  try {
    if (change.data.type === "last-chat")
      await chatViewPreferences.setLastChat(person, change.data);
    else await chatViewPreferences.setReadingPosition(person, change.data);
  } catch (error: unknown) {
    if (error instanceof ConversationError)
      return new Response(null, { status: 400 });
    throw error;
  }
  return new Response(null, { status: 204 });
}
