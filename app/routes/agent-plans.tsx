import {
  data as routeData,
  redirect,
  useLoaderData,
  useLocation,
} from "react-router";

import { PlanRetiredNotice } from "@/app/components/agents/plans/plan-retired-notice";
import { PlanPage } from "@/app/components/agents/plans/plan-page";
import { usePlanSelectionPreference } from "@/app/components/agents/plans/use-plan-selection-preference";
import { defaultPlanId } from "@/app/lib/agent-plan-default";
import { displayPlanRun } from "@/app/lib/agent-plan-display.server";
import { planCatalogRefresh } from "@/app/lib/agent-plan-catalog.server";
import {
  clonePlanAction,
  createPlanAction,
  deletePlanAction,
} from "@/app/lib/agent-plan-management.server";
import { lastSelectedPlan } from "@/app/lib/agent-plan-selection.server";
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
import type {
  PlanSelectionPreference,
  PlanSelectionScope,
} from "@/app/lib/agent-plan-selection";
import type { PlanCatalogRefresh } from "@/app/components/agents/plans/use-plan-catalog-refresh";
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
  readonly catalogRefresh?: PlanCatalogRefresh;
  readonly selectionPreference: PlanSelectionPreference;
}

/** Graphs and execution results are always private, uncacheable responses. */
export const headers: Route.HeadersFunction = ({ parentHeaders }) => {
  const response = new Headers(parentHeaders);
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
    const remembered = await lastSelectedPlan(request, user.id);
    const requested = query.get("planId");
    const services = await getApplicationServices();
    const page = await openPlan(services.agentPlanService, user.id, {
      planId: requested ?? (workspace === null ? remembered : null),
      workspaceId: workspace === null ? null : readPlanText(workspace),
      isRestoring:
        requested === null && workspace === null && remembered !== null,
    });
    // Pin the opened plan in the address so another tab's preference cannot
    // change this editor's selection during catalog/action revalidation.
    if (page.selected && requested === null && workspace === null)
      throw redirect(
        `/agents/plans?planId=${encodeURIComponent(page.selected.id)}`,
        {
          headers: AGENT_NO_STORE,
        },
      );
    return routeData(
      {
        ...page,
        catalogRefresh: planCatalogRefresh(page, workspace),
        selectionPreference: openingPreference(
          { userId: user.id, origin: new URL(request.url).origin },
          page,
          { workspace, requested, remembered },
        ),
      },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    logCaughtError("agent_plans", error);

    throw agentFailureResponse(error);
  }
}

/** Keeps a valid previous choice when an unrelated explicit link or workspace could not open. */
function openingPreference(
  scope: PlanSelectionScope,
  page: AgentPlanPage,
  selection: {
    readonly workspace: string | null;
    readonly requested: string | null;
    readonly remembered: string | null;
  },
): PlanSelectionPreference {
  const { workspace, requested, remembered } = selection;
  return {
    ...scope,
    planId: page.selected?.id ?? null,
    discardedPlanId:
      workspace === null && (requested === null || requested === remembered)
        ? remembered
        : null,
  };
}

/**
 * Save, Create, Clone, Delete, Play, Pause, Resume and Stop use the authenticated executor and live server permissions.
 *
 * @remarks
 * Play only starts the revision the request names. The route still accepts
 * the save-and-play form of earlier clients; the plan page never sends it.
 */
export async function action(args: Route.ActionArgs): Promise<Response> {
  let intent = "";
  try {
    const { user, services, formData } = await readSettingsRequest(args);
    intent = String(formData.get("intent") ?? "");
    if (intent === "save-plan")
      return await savePlan(user.id, services.agentPlanService, formData);
    if (intent === "create-plan")
      return await createPlanAction(user.id, services, formData);
    if (intent === "clone-plan")
      return await clonePlanAction(user.id, services, formData);
    if (intent === "delete-plan")
      return await deletePlanAction(user.id, services, {
        request: args.request,
        formData,
      });
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
        { ok: true, intent, run: displayPlanRun(run) },
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
  usePlanSelectionPreference(page.selectionPreference);
  return (
    <>
      <PlanRetiredNotice />
      <PlanPage
        key={`${page.userId}:${page.selected?.id ?? "new"}:${location.key}`}
        page={page}
        opening={page.opening}
        catalogRefresh={page.catalogRefresh}
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
    const page = await service.page(userId, selection);
    if (
      selection.workspaceId &&
      page.selected?.workspaceId !== selection.workspaceId
    )
      return null;
    return page;
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
    readonly isRestoring: boolean;
  },
): Promise<Omit<AgentPlansView, "selectionPreference">> {
  const isDefault = selection.planId === null;
  const planId =
    selection.planId === null
      ? defaultPlanId(
          (await service.visible(userId)).filter(
            (plan) =>
              selection.workspaceId === null ||
              plan.workspaceId === selection.workspaceId,
          ),
          userId,
        )
      : readRequestedPlan(selection.planId);
  const page =
    planId === null
      ? null
      : await readablePage(service, userId, {
          planId,
          workspaceId: selection.workspaceId,
        });
  if (page && !(selection.isRestoring && page.selected?.isWorkspaceMissing))
    return { ...page, opening: isDefault ? "default" : "requested" };
  return {
    ...(await emptyPage(service, userId, selection.workspaceId)),
    opening: isDefault ? "defaultMissing" : "requestedMissing",
  };
}

/** An invalid workspace leaves the regular empty editor rather than retrying the inaccessible context. */
async function emptyPage(
  service: AgentPlanService,
  userId: string,
  workspaceId: string | null,
): Promise<AgentPlanPage> {
  try {
    return await service.page(userId, { planId: null, workspaceId });
  } catch (error: unknown) {
    if (
      !(error instanceof AgentError) ||
      error.code !== "plan_access_denied" ||
      workspaceId === null
    )
      throw error;
    return service.page(userId, { planId: null, workspaceId: null });
  }
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
  let id: string;
  try {
    id = await service.save(userId, planId || null, proposed);
  } catch (error: unknown) {
    if (
      !(error instanceof AgentError) ||
      error.code !== "plan_conflict" ||
      !planId
    )
      throw error;
    const current = await service.view(userId, planId);
    return Response.json(
      {
        ok: false,
        intent: "save-plan",
        error: "plan_conflict",
        currentRevision: current.revision,
      },
      { status: 409, headers: AGENT_NO_STORE },
    );
  }
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
    {
      ok: true,
      intent: "play-plan",
      planId,
      revision: run.planRevision,
      run: displayPlanRun(run),
    },
    { headers: AGENT_NO_STORE },
  );
}
