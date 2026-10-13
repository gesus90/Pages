import { data as routeData, useLoaderData } from "react-router";

import { PageAgentPageView } from "@/app/components/agents/definitions/page-agent-page";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import {
  AGENT_NO_STORE,
  agentFailureResponse,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { AgentError } from "@/backend/error/AgentErrors";

import type { PageAgentPage } from "@/definition/PageAgent";
import type { Route } from "./+types/page-agents";

/** Private definition pages and responses must never enter a shared cache. */
export const headers: Route.HeadersFunction = () => AGENT_NO_STORE;

/** The service resolves visibility and model grants from persisted server facts. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<ReturnType<typeof routeData<PageAgentPage>>> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("agent_usage_denied");
    const services = await getApplicationServices();
    return routeData(await services.pageAgentService.page(user.id), {
      headers: AGENT_NO_STORE,
    });
  } catch (error: unknown) {
    throw agentFailureResponse(error);
  }
}

/** Client payloads select only a saved admin grant; all authorization remains in the service. */
export async function action(args: Route.ActionArgs): Promise<Response> {
  try {
    const { user, services, formData } = await readSettingsRequest(args);
    if (formData.get("intent") !== "save-agent")
      throw new AgentError("profile_invalid");
    const content = String(formData.get("agent") ?? "");
    const id = String(formData.get("agentId") ?? "");
    if (content.length > 500_000 || id.length > 100)
      throw new AgentError("profile_invalid");
    const proposed: unknown = JSON.parse(content);
    const agentId = await services.pageAgentService.save(
      user.id,
      id || null,
      proposed,
    );
    return Response.json({ ok: true, agentId }, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    return agentFailureResponse(error, "save-agent");
  }
}

/** Lists visible definitions and composes the existing parameter editor for owner changes. */
export default function PageAgentsRoute(): React.ReactElement {
  return <PageAgentPageView page={useLoaderData<typeof loader>()} />;
}
