import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { requireAgentAccount } from "@/app/lib/settings-actions/settings-agents-access.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { AcpResourceDiagnostics } from "@/definition/AcpResource";
import type { ConversationObserverHealth } from "@/definition/ConversationObserver";
import type { Route } from "./+types/agent-resources";

/** The observer's health is supplementary; a failed read leaves the resource view intact. */
async function readObserverHealth(
  services: ApplicationServices,
): Promise<ConversationObserverHealth | undefined> {
  try {
    return await services.conversationObserverMonitor.health();
  } catch (error: unknown) {
    logCaughtError("agent_resources", error);
    return undefined;
  }
}

/** Exposes global process occupancy and unconfirmed crash leftovers only to a fresh personal administrator in admin mode. */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  try {
    const services = await getApplicationServices();
    await requireAgentAccount(services, context.get(authenticatedUserContext));
    const diagnostics: AcpResourceDiagnostics = {
      ...(await services.acpResourceScheduler.inspect()),
      leftovers: services.agentCliGitHubCredentials.leftovers(),
      observer: await readObserverHealth(services),
      chatSessions: services.picaAcpSessionPool?.describe() ?? [],
    };
    return Response.json(diagnostics, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("agent_resources", error);

    return agentFailureResponse(error);
  }
}
