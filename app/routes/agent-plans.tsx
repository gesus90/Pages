import {
  data as routeData,
  redirect,
  useLoaderData,
  useLocation,
} from "react-router";

import { PlanRetiredNotice } from "@/app/components/agents/plans/plan-retired-notice";
import { PlanPage } from "@/app/components/agents/plans/plan-page";
import { defaultPlanId } from "@/app/lib/agent-plan-default";
import {
  lastSelectedPlan,
  rememberSelectedPlan,
} from "@/app/lib/agent-plan-selection.server";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { readPlanInput, readPlanText } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentPlanOpening } from "@/app/lib/agent-plan-default";
import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type {
  AgentPlanInput,
  AgentPlanPage,
  AgentPlanRun,
} from "@/definition/AgentPlan";
import type { Route } from "./+types/agent-plans";

/** The plan page together with how the editor came to its plan. */
interface AgentPlansView extends AgentPlanPage {
  readonly opening: AgentPlanOpening;
}

/** Graphs and execution results are always private, uncacheable responses. */
export const headers: Route.HeadersFunction = ({
  parentHeaders,
  loaderHeaders,
}) => {
  const response = new Headers(parentHeaders);
  const selection = loaderHeaders.get("Set-Cookie");
  if (selection) response.append("Set-Cookie", selection);
  response.set("Cache-Control", "no-store");
  return response;
};

/**
 * Workspace and project context are derived by the service, never trusted from query fields.
 *
 * @remarks
 * Without explicit plan/workspace context the editor restores the account's
 * browser preference, then uses the provisional default if no preference exists.
 */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<ReturnType<typeof routeData<AgentPlansView>>> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const query = new URL(request.url).searchParams;
    const workspace = query.get("workspaceId");
    const services = await getApplicationServices();
    const page = await openPlan(services.agentPlanService, user.id, {
      planId:
        query.get("planId") ??
        (workspace === null ? await lastSelectedPlan(request, user.id) : null),
      workspaceId: workspace === null ? null : readPlanText(workspace),
    });
    const responseHeaders = new Headers(AGENT_NO_STORE);
    if (page.selected)
      responseHeaders.append(
        "Set-Cookie",
        await rememberSelectedPlan(request, user.id, page.selected.id),
      );
    return routeData(page, { headers: responseHeaders });
  } catch (error: unknown) {
    logCaughtError("agent_plans", error);

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
      const runId = readPlanText(formData.get("runId"));
      const run =
        intent === "resume-plan"
          ? await services.agentPlanService.resume(
              user.id,
              runId,
              Number(formData.get("revision")),
            )
          : await operations[intent](user.id, runId);
      return Response.json(
        { ok: true, intent, run },
        { headers: AGENT_NO_STORE },
      );
    }
    throw new AgentError("plan_invalid");
  } catch (error: unknown) {
    logCaughtError("agent_plans", error);

    return agentFailureResponse(
      error instanceof SyntaxError ? new AgentError("plan_invalid") : error,
      intent,
    );
  }
}

/** The page shows the plan in the React Flow graph editor and nothing beside it. */
export default function AgentPlansRoute(): React.ReactElement {
  const page = useLoaderData<typeof loader>();
  const location = useLocation();
  return (
    <>
      <PlanRetiredNotice />
      <PlanPage
        key={`${page.selected?.id ?? "new"}:${location.key}`}
        page={page}
        opening={page.opening}
      />
    </>
  );
}

/** A malformed plan identifier in the address names no plan; it is not an error page. */
function readRequestedPlan(value: string): string | null {
  try {
    return readPlanText(value);
  } catch (error: unknown) {
    if (error instanceof AgentError) return null;
    throw error;
  }
}

/** The page with the plan, or `null` when the plan is missing or not readable. */
async function readablePage(
  service: AgentPlanService,
  userId: string,
  selection: { readonly planId: string; readonly workspaceId: string | null },
): Promise<AgentPlanPage | null> {
  try {
    return await service.page(userId, selection);
  } catch (error: unknown) {
    if (error instanceof AgentError && error.code === "plan_access_denied")
      return null;
    throw error;
  }
}

/**
 * Opens the explicit or remembered selection, using the default only without either.
 *
 * @remarks
 * A plan that is missing or not readable leaves the canvas empty and says so;
 * it never opens another plan instead.
 */
async function openPlan(
  service: AgentPlanService,
  userId: string,
  selection: {
    readonly planId: string | null;
    readonly workspaceId: string | null;
  },
): Promise<AgentPlansView> {
  const isDefault = selection.planId === null;
  const planId =
    selection.planId === null
      ? defaultPlanId(await service.visible(userId), userId)
      : readRequestedPlan(selection.planId);
  const page =
    planId === null
      ? null
      : await readablePage(service, userId, { ...selection, planId });
  if (page) return { ...page, opening: isDefault ? "default" : "requested" };
  return {
    ...(await service.page(userId, { ...selection, planId: null })),
    opening: isDefault ? "defaultMissing" : "requestedMissing",
  };
}

function readPlanContent(formData: FormData): AgentPlanInput {
  const content = String(formData.get("plan") ?? "");
  if (content.length > 2_000_000) throw new AgentError("plan_invalid");
  return readPlanInput(JSON.parse(content) as unknown);
}

async function savePlan(
  userId: string,
  service: AgentPlanService,
  formData: FormData,
): Promise<Response> {
  const planId = String(formData.get("planId") ?? "");
  if (planId) readPlanText(planId);
  const proposed = readPlanContent(formData);
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

/** Starts the saved revision, or saves the sent changes first and starts the revision that results. */
async function playPlan(
  userId: string,
  service: AgentPlanService,
  formData: FormData,
): Promise<Response> {
  const planId = readPlanText(formData.get("planId"));
  let run: AgentPlanRun;
  if (formData.has("plan"))
    run = await service.saveAndPlay(userId, planId, readPlanContent(formData));
  else {
    const revision = Number(formData.get("revision"));
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw new AgentError("plan_invalid");
    run = await service.play(userId, planId, revision);
  }
  return Response.json(
    { ok: true, intent: "play-plan", planId, revision: run.planRevision, run },
    { headers: AGENT_NO_STORE },
  );
}
