import { data as routeData } from "react-router";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { loadRemoteOverview } from "@/app/lib/remote-actions.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { WorkspaceOverview } from "./agent-workspaces";
import type { Route } from "./+types/agent-workspaces-server";

/**
 * Loads only the registrations of accessible projects, the remote connections
 * the person may use and the management controls the person holds.
 */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<ReturnType<typeof routeData<WorkspaceOverview>>> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("workspace_access_denied");
    const services = await getApplicationServices();
    const [page, remote, audience] = await Promise.all([
      services.agentWorkspaceService.page(user.id),
      loadRemoteOverview(services, user.id),
      readLocalStateAudience(services, user),
    ]);
    return routeData({ page, remote, audience }, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("agent_workspaces", error);

    throw agentFailureResponse(error);
  }
}

/** Mutates registration metadata only; the service rechecks project access and management rights. */
export async function action(args: Route.ActionArgs): Promise<Response> {
  let intent = "";
  try {
    const { user, services, formData } = await readSettingsRequest(args);
    intent = String(formData.get("intent") ?? "");
    const id = String(formData.get("workspaceId") ?? "");
    if (id.length > 100) throw new AgentError("workspace_invalid");
    if (intent === "workspace-usages")
      return Response.json(
        {
          ok: true,
          intent,
          workspaceUsages: await services.agentWorkspaceService.usages(
            user.id,
            id,
          ),
        },
        { headers: AGENT_NO_STORE },
      );
    if (intent === "save-workspace") {
      const content = String(formData.get("workspace") ?? "");
      if (content.length > 50000) throw new AgentError("workspace_invalid");
      const proposed: unknown = JSON.parse(content);
      await services.agentWorkspaceService.save(user.id, id || null, proposed);
    } else if (intent === "delete-workspace") {
      const revision = Number(formData.get("revision"));
      if (!Number.isSafeInteger(revision) || revision < 1)
        throw new AgentError("workspace_invalid");
      await services.agentWorkspaceService.remove(user.id, id, revision);
    } else throw new AgentError("workspace_invalid");
    return Response.json({ ok: true, intent }, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("agent_workspaces", error);

    return agentFailureResponse(error, intent);
  }
}
