import { readAgentJson } from "@/app/lib/agent-json.server";
import { planRecoveryFailure } from "@/app/lib/agent-plan-recovery-response.server";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AGENT_NO_STORE } from "@/app/lib/settings-actions/settings-agents-response.server";
import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

import type { Route } from "./+types/agent-plan-recovery";

/** Reads recovery diagnostics, or an original checkpoint by its positive version. */
export async function loader({
  request,
  params,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentPlanRecoveryError("access_denied");
    const runId = readPlanText(params.runId);
    const service = (await getApplicationServices()).agentPlanRecoveryService;
    const version = new URL(request.url).searchParams.get("checkpoint");
    if (version !== null)
      return Response.json(
        {
          ok: true,
          checkpoint: await service.checkpoint(user.id, runId, Number(version)),
        },
        { headers: AGENT_NO_STORE },
      );
    return Response.json(
      { ok: true, recovery: await service.view(user.id, runId) },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    return planRecoveryFailure(error);
  }
}

/** Records a revision-fenced repair/reconciliation or cancellation; ended-run resume is explicitly unavailable. */
export async function action({
  request,
  params,
  context,
}: Route.ActionArgs): Promise<Response> {
  try {
    if (request.method !== "POST")
      return new Response(null, {
        status: 405,
        headers: { ...AGENT_NO_STORE, Allow: "POST" },
      });
    const user = context.get(authenticatedUserContext);
    const origin = request.headers.get("Origin");
    if (!user || (origin !== null && origin !== new URL(request.url).origin))
      throw new AgentPlanRecoveryError("access_denied");
    const runId = readPlanText(params.runId);
    const service = (await getApplicationServices()).agentPlanRecoveryService;
    const result = await service.control(
      user.id,
      runId,
      await readAgentJson(request),
    );
    return Response.json({ ok: true, result }, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    return planRecoveryFailure(error);
  }
}
