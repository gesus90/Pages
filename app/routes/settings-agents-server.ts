import { data as routeData } from "react-router";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readAuthorizationVersion } from "@/app/lib/local-state/local-state-audience.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import { readAgentAccount } from "@/app/lib/settings-actions/settings-agents-access.server";
import { handleAgentsAction } from "@/app/lib/settings-actions/settings-agents-actions.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentsLoaderData } from "./settings-agents";
import type { Route } from "./+types/settings-agents-server";

/** Loads secret-free metadata only for personal administrators in the active admin mode. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<ReturnType<typeof routeData<AgentsLoaderData>>> {
  try {
    const services = await getApplicationServices();
    const actor = await readAgentAccount(
      services,
      context.get(authenticatedUserContext),
    );
    if (actor.mode !== "admin")
      return routeData<AgentsLoaderData>(
        { access: "adminModeRequired" },
        { headers: AGENT_NO_STORE },
      );
    const [
      connections,
      cliTools,
      catalogs,
      profileDirectory,
      pica,
      speech,
      sessionLimits,
      runners,
      openCodeLinks,
      authorizationVersion,
    ] = await Promise.all([
      services.agentConnectionService.list(actor),
      services.agentCliLoginService.tools(actor),
      services.agentCatalogService.list(actor),
      services.agentProfileService.directory(actor),
      services.picaSettingsService.administration(actor.userId),
      services.speechSettingsService.administration(actor),
      services.agentSessionLimitService.administration(actor),
      services.runnerService.overview(actor.userId),
      services.openCodeProviderLinks.describe(),
      readAuthorizationVersion(services, actor.userId),
    ]);
    return routeData<AgentsLoaderData>(
      {
        access: "granted",
        connections: connections.map((connection) =>
          connection.provider === "opencode"
            ? { ...connection, openCodeLinks }
            : connection,
        ),
        runners,
        runnerGitHubMode: services.runnerGitHubMode,
        cliTools,
        catalogs,
        profileDirectory,
        pica,
        speech,
        sessionLimits,
        audience: { userId: actor.userId, authorizationVersion },
      },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    logCaughtError("settings_agents", error);

    throw agentFailureResponse(error);
  }
}

/** Keeps form secrets out of every success and failure response. */
export async function action(args: Route.ActionArgs): Promise<Response> {
  try {
    return await handleAgentsAction(await readSettingsRequest(args));
  } catch (error: unknown) {
    logCaughtError("settings_agents", error);

    return agentFailureResponse(error);
  }
}
