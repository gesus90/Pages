import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { agentFailureResponse } from "@/app/lib/settings-actions/settings-agents-response.server";
import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";

import type { Route } from "./+types/agent-plan-prompt";

/** Shows the executor the plain text one node of their run was sent, never to anyone else. */
export async function loader({
  params,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const services = await getApplicationServices();
    const prompt = await services.agentPlanService.prompt(
      user.id,
      readPlanText(params.runId),
      readPlanText(params.stepId),
    );
    return new Response(prompt, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    return agentFailureResponse(error, "plan-prompt");
  }
}
