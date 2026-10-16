import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { requireAgentAccount } from "@/app/lib/settings-actions/settings-agents-access.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";

import type { Route } from "./+types/agent-resources";

/** Exposes global process occupancy only to a fresh personal administrator in admin mode. */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  try {
    const services = await getApplicationServices();
    await requireAgentAccount(services, context.get(authenticatedUserContext));
    return Response.json(await services.acpResourceScheduler.inspect(), {
      headers: AGENT_NO_STORE,
    });
  } catch (error: unknown) {
    return agentFailureResponse(error);
  }
}
