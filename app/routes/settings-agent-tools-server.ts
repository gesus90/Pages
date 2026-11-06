import { data as routeData } from "react-router";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readAuthorizationVersion } from "@/app/lib/local-state/local-state-audience.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { requireAgentAccount } from "@/app/lib/settings-actions/settings-agents-access.server";
import {
  AGENT_NO_STORE,
  agentFailureResponse,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import {
  AgentAccessDeniedError,
  AgentError,
} from "@/backend/error/AgentErrors";
import { AgentToolReadinessError } from "@/backend/service/agents/tools/AgentToolReadinessError";
import { isAgentToolAction, isAgentToolId } from "@/definition/AgentTools";

import type { AgentToolsData } from "./settings-agent-tools";
import type { Route } from "./+types/settings-agent-tools-server";

/** Every status read also enforces fresh persisted system administrator rights. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<ReturnType<typeof routeData<AgentToolsData>>> {
  try {
    const services = await getApplicationServices();
    const actor = await requireAgentAccount(
      services,
      context.get(authenticatedUserContext),
    );
    return routeData(
      {
        tools: services.agentToolManagerService.list(actor),
        audience: {
          userId: actor.userId,
          authorizationVersion: await readAuthorizationVersion(
            services,
            actor.userId,
          ),
        },
      },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    throw agentFailureResponse(error);
  }
}

/** Accepts fixed IDs/actions only; direct requests have the same authorization as the page. */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<Response> {
  try {
    if (request.method !== "POST")
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { ...AGENT_NO_STORE, Allow: "POST" },
      });
    if (request.headers.get("Origin") !== new URL(request.url).origin)
      throw new AgentAccessDeniedError();
    const services = await getApplicationServices();
    const actor = await requireAgentAccount(
      services,
      context.get(authenticatedUserContext),
    );
    const form = await request.formData();
    const id = form.get("tool");
    const intent = form.get("intent");
    if (!isAgentToolId(id)) throw new AgentError("configuration_invalid");
    if (intent === "enable" || intent === "disable")
      await services.agentToolManagerService.setEnabled(
        actor,
        id,
        intent === "enable",
      );
    else if (isAgentToolAction(intent))
      await services.agentToolManagerService.manage(actor, id, intent);
    else throw new AgentError("configuration_invalid");
    return Response.json({ ok: true }, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    if (error instanceof AgentToolReadinessError)
      return Response.json(
        { ok: false, diagnostic: error.diagnostic, tool: error.tool },
        { status: 409, headers: AGENT_NO_STORE },
      );
    return agentFailureResponse(error);
  }
}
