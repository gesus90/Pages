import { data as routeData, useLoaderData } from "react-router";

import { PlanPage } from "@/app/components/agents/plans/plan-page";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";

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

/** Saving, Play and Stop all use the authenticated executor and server-side permissions. */
export async function action(args: Route.ActionArgs): Promise<Response> {
  let intent = "";
  try {
    const { user, services, formData } = await readSettingsRequest(args);
    intent = String(formData.get("intent") ?? "");
    const planId = String(formData.get("planId") ?? "");
    if (planId) readPlanText(planId);
    if (intent === "save-plan") {
      const content = String(formData.get("plan") ?? "");
      if (content.length > 2_000_000) throw new AgentError("plan_invalid");
      const proposed: unknown = JSON.parse(content);
      const id = await services.agentPlanService.save(
        user.id,
        planId || null,
        proposed,
      );
      return Response.json(
        { ok: true, intent, planId: id },
        { headers: AGENT_NO_STORE },
      );
    }
    if (intent === "play-plan") {
      const revision = Number(formData.get("revision"));
      if (!Number.isSafeInteger(revision) || revision < 1)
        throw new AgentError("plan_invalid");
      const run = await services.agentPlanService.play(
        user.id,
        readPlanText(planId),
        revision,
      );
      return Response.json(
        { ok: true, intent, run },
        { headers: AGENT_NO_STORE },
      );
    }
    if (intent === "stop-plan") {
      const run = await services.agentPlanService.stop(
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
    return agentFailureResponse(error, intent);
  }
}

/** The page composes existing Pages controls with a small native graph editor. */
export default function AgentPlansRoute(): React.ReactElement {
  const page = useLoaderData<typeof loader>();
  return (
    <PlanPage
      key={`${page.selected?.id ?? "new"}:${page.selected?.revision ?? 0}`}
      page={page}
    />
  );
}
