import { authenticatedUserContext } from "@/app/lib/auth.server";
import { requireChatRequest } from "@/app/lib/chat-response.server";
import { requestEntryContext } from "@/app/lib/request-origin.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { resolveSystemSettingsAccess } from "@/app/lib/settings-actions/settings-system-access.server";
import { ChatError } from "@/backend/error/ChatErrors";
import { ConversationError } from "@/backend/error/ConversationError";

import type { User } from "@/definition/User";
import type { Route } from "./+types/settings-embed-domains";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

type Services = Awaited<ReturnType<typeof getApplicationServices>>;

/** The services, for an administrator in the admin mode only. */
async function requireAdministrator(actor: User | null): Promise<Services> {
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const services = await getApplicationServices();
  if ((await resolveSystemSettingsAccess(services, actor)) !== "granted")
    throw new Response("Forbidden", { status: 403 });
  return services;
}

/**
 * Lists the domains an administrator released for embedding in every
 * conversation (PAGE-298): `GET /settings-api/embed-domains`.
 */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  const services = await requireAdministrator(
    context.get(authenticatedUserContext),
  );
  return Response.json(
    { domains: await services.conversationLinks.globalDomains() },
    { headers: NO_STORE },
  );
}

/**
 * Releases a domain for every conversation or takes the release back:
 * `POST /settings-api/embed-domains` with the form fields `domain` and
 * `isReleased`. Administrators in the admin mode only.
 */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  const services = await requireAdministrator(actor);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  try {
    requireChatRequest(request, "POST", context.get(requestEntryContext));
    const formData = await request.formData();
    await services.conversationLinks.setGloballyReleased(actor, {
      domain: formData.get("domain"),
      isReleased: formData.get("isReleased") === "true",
    });
  } catch (error: unknown) {
    if (error instanceof ChatError)
      throw new Response("Forbidden", { status: 403 });
    if (!(error instanceof ConversationError)) throw error;
    return Response.json(
      { ok: false, domains: await services.conversationLinks.globalDomains() },
      { status: 400, headers: NO_STORE },
    );
  }
  return Response.json(
    { ok: true, domains: await services.conversationLinks.globalDomains() },
    { headers: NO_STORE },
  );
}
