import { data as routeData, useLoaderData } from "react-router";

import { WorkspacePage } from "@/app/components/agents/workspaces/workspace-page";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentWorkspacePage } from "@/definition/AgentWorkspace";
import type { Route } from "./+types/agent-workspaces";

/** Keeps directory metadata and action responses out of browser and proxy caches. */
export const headers: Route.HeadersFunction = ({ parentHeaders }) => {
  const response = new Headers(parentHeaders);
  response.set("Cache-Control", AGENT_NO_STORE["Cache-Control"]);
  return response;
};

/** Loads only currently accessible registrations and permitted management controls. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<
  ReturnType<typeof routeData<AgentWorkspacePage>>
> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("workspace_access_denied");
    const services = await getApplicationServices();
    return routeData(await services.agentWorkspaceService.page(user.id), {
      headers: AGENT_NO_STORE,
    });
  } catch (error: unknown) {
    throw agentFailureResponse(error);
  }
}

/** Mutates registration metadata only; the service rechecks persisted administrator permissions. */
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
    return agentFailureResponse(error, intent);
  }
}

/** Shares the existing Pages cards and dialogs with the central agent administration. */
export default function AgentWorkspacesRoute(): React.ReactElement {
  return <WorkspacePage page={useLoaderData<typeof loader>()} />;
}
