import {
  data as routeData,
  redirect,
  useLoaderData,
  useLocation,
} from "react-router";

import { PlanPage } from "@/app/components/agents/plans/plan-page";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { readPlanInput, readPlanText } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { AgentPlanPage } from "@/definition/AgentPlan";
import type { Route } from "./+types/agent-plans";

/** Graphs and execution results are always private, uncacheable responses. */
export const headers: Route.HeadersFunction = ({ parentHeaders }) => {
  const response = new Headers(parentHeaders);
  response.set("Cache-Control", "no-store");
  return response;
};

/** Workspace and project context are derived by the service, never trusted from query fields. */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<ReturnType<typeof routeData<AgentPlanPage>>> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const query = new URL(request.url).searchParams;
    const plan = query.get("planId");
    const workspace = query.get("workspaceId");
    const services = await getApplicationServices();
    return routeData(
      await services.agentPlanService.page(user.id, {
        planId: plan === null ? null : readPlanText(plan),
        workspaceId: workspace === null ? null : readPlanText(workspace),
      }),
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    throw agentFailureResponse(error);
  }
}

/** Save, Delete, Play, Pause, Resume and Stop use the authenticated executor and live server permissions. */
export async function action(args: Route.ActionArgs): Promise<Response> {
  let intent = "";
  try {
    const { user, services, formData } = await readSettingsRequest(args);
    intent = String(formData.get("intent") ?? "");
    if (intent === "save-plan")
      return await savePlan(user.id, services.agentPlanService, formData);
    if (intent === "delete-plan") {
      await services.agentPlanService.remove(
        user.id,
        readPlanText(formData.get("planId")),
      );
      return redirect("/agents/plans", { headers: AGENT_NO_STORE });
    }
    if (intent === "play-plan")
      return await playPlan(user.id, services.agentPlanService, formData);
    if (
      intent === "stop-plan" ||
      intent === "pause-plan" ||
      intent === "resume-plan"
    ) {
      const operations = {
        "stop-plan": services.agentPlanService.stop.bind(
          services.agentPlanService,
        ),
        "pause-plan": services.agentPlanService.pause.bind(
          services.agentPlanService,
        ),
        "resume-plan": services.agentPlanService.resume.bind(
          services.agentPlanService,
        ),
      };
      const run = await operations[intent](
        user.id,
        readPlanText(formData.get("runId")),
      );
      return Response.json(
        { ok: true, intent, run },
        { headers: AGENT_NO_STORE },
      );
    }
    throw new AgentError("plan_invalid");
  } catch (error: unknown) {
    return agentFailureResponse(
      error instanceof SyntaxError ? new AgentError("plan_invalid") : error,
      intent,
    );
  }
}

/** The page composes existing Pages controls with a small native graph editor. */
export default function AgentPlansRoute(): React.ReactElement {
  const page = useLoaderData<typeof loader>();
  const location = useLocation();
  return (
    <PlanPage
      key={`${page.selected?.id ?? "new"}:${location.key}`}
      page={page}
    />
  );
}

async function savePlan(
  userId: string,
  service: AgentPlanService,
  formData: FormData,
): Promise<Response> {
  const planId = String(formData.get("planId") ?? "");
  if (planId) readPlanText(planId);
  const content = String(formData.get("plan") ?? "");
  if (content.length > 2_000_000) throw new AgentError("plan_invalid");
  const proposed = readPlanInput(JSON.parse(content) as unknown);
  const id = await service.save(userId, planId || null, proposed);
  return Response.json(
    {
      ok: true,
      intent: "save-plan",
      planId: id,
      revision: planId ? (proposed.revision ?? 0) + 1 : 1,
    },
    { headers: AGENT_NO_STORE },
  );
}

async function playPlan(
  userId: string,
  service: AgentPlanService,
  formData: FormData,
): Promise<Response> {
  const revision = Number(formData.get("revision"));
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new AgentError("plan_invalid");
  const run = await service.play(
    userId,
    readPlanText(formData.get("planId")),
    revision,
  );
  return Response.json(
    { ok: true, intent: "play-plan", run },
    { headers: AGENT_NO_STORE },
  );
}
