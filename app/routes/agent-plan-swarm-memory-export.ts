import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { agentFailureResponse } from "@/app/lib/settings-actions/settings-agents-response.server";
import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { PLAN_SWARM_MEMORY_FILES } from "@/definition/AgentPlanSwarmMemory";

import type { Route } from "./+types/agent-plan-swarm-memory-export";

/**
 * Downloads `SWARM.md` or `SWARM-LOG.md` of a swarm node, built from the stored events.
 * @remarks
 * Whoever may read the run may export its memory; nothing is written to disk.
 */
export async function loader({
  params,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const fileName = PLAN_SWARM_MEMORY_FILES.find(
      (entry) => entry === params.file,
    );
    if (!fileName) throw new AgentError("plan_access_denied");
    const services = await getApplicationServices();
    const file = await services.agentPlanSwarmMemoryService.export(user.id, {
      runId: readPlanText(params.runId),
      stepId: readPlanText(params.stepId),
      fileName,
    });
    return new Response(file.content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    logCaughtError("agent_plan_swarm_memory_export", error);
    return agentFailureResponse(error, "swarm-memory-export");
  }
}
