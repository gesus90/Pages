import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { requireAgentAccount } from "@/app/lib/settings-actions/settings-agents-access.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AcpResourceDiagnostics } from "@/definition/AcpResource";
import type { Route } from "./+types/agent-resources";

/** Exposes global process occupancy and unconfirmed crash leftovers only to a fresh personal administrator in admin mode. */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  try {
    const services = await getApplicationServices();
    await requireAgentAccount(services, context.get(authenticatedUserContext));
    const diagnostics: AcpResourceDiagnostics = {
      ...(await services.acpResourceScheduler.inspect()),
      leftovers: services.agentCliGitHubCredentials.leftovers(),
    };
    return Response.json(diagnostics, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("agent_resources", error);

    return agentFailureResponse(error);
  }
}
