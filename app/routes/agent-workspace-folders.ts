import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/agent-workspace-folders";

const MAXIMUM_PATH_LENGTH = 4096;

/** Directory names of the server are reauthorized per request, never taken from the page's rights. */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("workspace_access_denied");
    const parameters = new URL(request.url).searchParams;
    const requested = parameters.get("path");
    if (requested !== null && requested.length > MAXIMUM_PATH_LENGTH)
      throw new AgentError("workspace_path_invalid");
    const services = await getApplicationServices();
    return Response.json(
      await services.agentWorkspaceService.folders(user.id, {
        path: requested,
        showHidden: parameters.get("hidden") === "1",
      }),
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    logCaughtError("agent_workspace_folders", error);

    return agentFailureResponse(error);
  }
}
