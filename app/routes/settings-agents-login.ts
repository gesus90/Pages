import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { requireAgentAccount } from "@/app/lib/settings-actions/settings-agents-access.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";

import type { Route } from "./+types/settings-agents-login";

/** The sole response allowed to carry a pending device code; always admin-only and no-store. */
export async function loader({
  request,
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  if (request.method !== "GET") return action();
  try {
    const services = await getApplicationServices();
    const actor = await requireAgentAccount(
      services,
      context.get(authenticatedUserContext),
    );
    const login = await services.agentCliLoginService.read(
      actor,
      params.connectionId,
    );
    return Response.json(login, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    return agentFailureResponse(error);
  }
}

/** Login mutations use the settings page's POST action, never the polling URL. */
export function action(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { ...AGENT_NO_STORE, Allow: "GET" },
  });
}
