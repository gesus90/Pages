import { data as routeData, useLoaderData } from "react-router";

import { PageAgentLoadError } from "@/app/components/agents/definitions/page-agent-load-error";
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
export const headers: Route.HeadersFunction = ({ parentHeaders }) => {
  const response = new Headers(parentHeaders);
  response.set("Cache-Control", AGENT_NO_STORE["Cache-Control"]);
  return response;
};

function readProposal(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new AgentError("profile_invalid");
  }
}

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
  let intent = "";
  try {
    const { user, services, formData } = await readSettingsRequest(args);
    intent = String(formData.get("intent") ?? "");
    const id = String(formData.get("agentId") ?? "");
    if (id.length > 100) throw new AgentError("profile_invalid");
    if (intent === "delete-agent") {
      if (!id || formData.get("confirmation") !== "LÖSCHEN")
        throw new AgentError("profile_invalid");
      await services.pageAgentService.remove(user.id, id);
      return Response.json({ ok: true, intent }, { headers: AGENT_NO_STORE });
    }
    if (intent !== "save-agent") throw new AgentError("profile_invalid");
    const content = String(formData.get("agent") ?? "");
    if (content.length > 500_000) throw new AgentError("profile_invalid");
    const agentId = await services.pageAgentService.save(
      user.id,
      id || null,
      readProposal(content),
    );
    return Response.json(
      { ok: true, intent: "save-agent", agentId },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    return agentFailureResponse(error, intent);
  }
}

/** Lists visible definitions and composes the existing parameter editor for owner changes. */
export default function PageAgentsRoute(): React.ReactElement {
  return <PageAgentPageView page={useLoaderData<typeof loader>()} />;
}

/** A failed load keeps the page chrome and offers a retry. */
export function ErrorBoundary(): React.ReactElement {
  return <PageAgentLoadError />;
}
