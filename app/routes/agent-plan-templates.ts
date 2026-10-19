import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { readPlanText } from "@/backend/agents/AgentPlanInput";
import {
  readPlanTemplateName,
  readPlanTemplateNode,
} from "@/backend/agents/AgentPlanTemplateInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentPlanTemplateContext } from "@/backend/service/agents/AgentPlanTemplateService";
import type { Route } from "./+types/agent-plan-templates";

/** The plan a request names: the saved plan, if any, and the draft's workspace. */
function readTemplateContext(formData: FormData): AgentPlanTemplateContext {
  const planId = String(formData.get("planId") ?? "");
  return {
    planId: planId ? readPlanText(planId) : null,
    workspaceId: readPlanText(formData.get("workspaceId")),
  };
}

/** Lists only the signed-in person's own node templates. */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const services = await getApplicationServices();
    return Response.json(
      { templates: await services.agentPlanTemplateService.list(user.id) },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    logCaughtError("agent_plan_templates", error);

    return agentFailureResponse(error);
  }
}

/**
 * Saves a node configuration as a template, or returns a checked copy of one for the draft.
 *
 * @remarks
 * Neither intent changes a plan: an inserted copy joins the editor's draft
 * and is stored only with the plan's next save.
 */
export async function action(args: Route.ActionArgs): Promise<Response> {
  let intent = "";
  try {
    const { user, services, formData } = await readSettingsRequest(args);
    intent = String(formData.get("intent") ?? "");
    const templates = services.agentPlanTemplateService;
    if (intent === "save-template") {
      const template = await templates.save(
        user.id,
        readTemplateContext(formData),
        {
          name: readPlanTemplateName(formData.get("name")),
          node: readPlanTemplateNode(formData.get("node")),
        },
      );
      return Response.json(
        { ok: true, intent, template },
        { headers: AGENT_NO_STORE },
      );
    }
    if (intent === "insert-template") {
      const node = await templates.insert(
        user.id,
        readTemplateContext(formData),
        readPlanText(formData.get("templateId")),
      );
      return Response.json(
        { ok: true, intent, node },
        { headers: AGENT_NO_STORE },
      );
    }
    throw new AgentError("plan_invalid");
  } catch (error: unknown) {
    logCaughtError("agent_plan_templates", error);

    return agentFailureResponse(
      error instanceof SyntaxError ? new AgentError("template_invalid") : error,
      intent,
    );
  }
}
