import { randomUUID } from "node:crypto";

import { data as routeData, redirect } from "react-router";

import { readPlanControlRun } from "@/backend/service/agents/AgentPlanControlAccess";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { readTeams } from "@/app/lib/agent-plan-access-actions.server";
import { readPlanOwnerParameter } from "@/backend/service/agents/AgentPlanTeamInput";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { defaultPlanId } from "@/app/lib/agent-plan-default";
import { displayPlanRun } from "@/app/lib/agent-plan-display.server";
import {
  clonePlanAction,
  keepPlanAction,
  createPlanAction,
  deletePlanAction,
} from "@/app/lib/agent-plan-management.server";
import {
  approvePlanScriptsAction,
  changePlanAccessAction,
  planHistoryAction,
} from "@/app/lib/agent-plan-access-actions.server";
import { lastSelectedPlan } from "@/app/lib/agent-plan-selection.server";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { readPlanInput, readPlanText } from "@/backend/agents/AgentPlanInput";
import { planRecoveryFailure } from "@/app/lib/agent-plan-recovery-response.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanReadDenied } from "@/backend/error/AgentPlanReadDenied";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { logCaughtError } from "@/backend/logging/Logger";
import { readCorrelationId } from "@/backend/logging/LogCorrelation";
import { CORRELATION_HEADER } from "@/definition/RequestCorrelation";

import type {
  PlanSelectionPreference,
  PlanSelectionScope,
} from "@/app/lib/agent-plan-selection";
import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { ApplicationServices } from "@/app/lib/services.server";
import type {
  AgentPlanInput,
  AgentPlanPage,
  AgentPlanRun,
} from "@/definition/AgentPlan";
import type { AgentPlansView } from "./agent-plans";
import type { Route } from "./+types/agent-plans-server";

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
  requestId: string,
): Promise<AgentPlanPage | null> {
  try {
    const page = await service.page(userId, selection);
    if (
      selection.workspaceId &&
      page.selected?.workspaceId !== selection.workspaceId
    ) {
      logPlanUnavailable(
        requestId,
        "selection",
        "requested_workspace_mismatch",
      );
      return null;
    }
    return page;
  } catch (error: unknown) {
    if (error instanceof AgentError && error.code === "plan_access_denied") {
      logPlanUnavailable(
        requestId,
        error instanceof AgentPlanReadDenied ? error.source : "page_build",
        error instanceof AgentPlanReadDenied ? error.reason : "access_denied",
      );
      return null;
    }
    throw error;
  }
}

/** Uses the request's logging context; no requested id, graph or private name enters the log. */
function logPlanUnavailable(
  requestId: string,
  source: string,
  reason: string,
): void {
  logCaughtError(
    `AgentPlansLoader.${source}.${reason}`,
    new AgentPlanReadDenied(source, reason),
    "warn",
    requestId,
  );
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
  requestId: string,
): Promise<Omit<AgentPlansView, "audience" | "selectionPreference">> {
  const isDefault = selection.planId === null;
  const planId =
    selection.planId === null
      ? defaultPlanId(
          (await service.summaries(userId)).filter(
            (plan) =>
              selection.workspaceId === null ||
              plan.workspaceId === selection.workspaceId,
          ),
          userId,
        )
      : readRequestedPlan(selection.planId);
  if (planId === null)
    logPlanUnavailable(
      requestId,
      "selection",
      isDefault ? "default_missing" : "invalid_plan_id",
    );
  const page =
    planId === null
      ? null
      : await readablePage(
          service,
          userId,
          {
            planId,
            workspaceId: selection.workspaceId,
          },
          requestId,
        );
  if (page && !(selection.isRestoring && page.selected?.isWorkspaceMissing))
    return { ...page, opening: isDefault ? "default" : "requested" };
  if (page?.selected?.isWorkspaceMissing && selection.isRestoring)
    logPlanUnavailable(requestId, "selection", "remembered_workspace_missing");
  return {
    ...(await emptyPage(service, userId, selection.workspaceId, requestId)),
    opening: isDefault ? "defaultMissing" : "requestedMissing",
  };
}

/** An invalid workspace leaves the regular empty editor rather than retrying the inaccessible context. */
async function emptyPage(
  service: AgentPlanService,
  userId: string,
  workspaceId: string | null,
  requestId: string,
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
    logPlanUnavailable(
      requestId,
      error instanceof AgentPlanReadDenied ? error.source : "empty_page_build",
      error instanceof AgentPlanReadDenied ? error.reason : "access_denied",
    );
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
  let revision = planId ? (proposed.revision ?? 0) + 1 : 1;
  try {
    if (formData.has("access") && planId) {
      const access = readAgentObject(
        JSON.parse(String(formData.get("access"))) as unknown,
      );
      const fields = new FormData();
      if (access.teams !== undefined)
        fields.set("teams", JSON.stringify(access.teams));
      revision = await service.saveSettings(userId, planId, {
        plan: proposed,
        access: {
          revision: proposed.revision ?? 0,
          teams: readTeams(fields),
          ownerId: readPlanOwnerParameter(access.ownerId),
        },
      });
      id = planId;
    } else id = await service.save(userId, planId || null, proposed);
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
      revision,
    },
    { headers: AGENT_NO_STORE },
  );
}

/** Starts the saved revision, or saves the sent changes first and starts the revision that results. */
async function playPlan(
  userId: string,
  services: ApplicationServices,
  formData: FormData,
): Promise<Response> {
  const service = services.agentPlanService;
  const requestKey = readPlanText(formData.get("requestKey"));
  const planId = readPlanText(formData.get("planId"));
  let run: AgentPlanRun;
  if (formData.has("plan"))
    run = await service.saveAndPlay(userId, planId, readPlanContent(formData));
  else {
    const result = await services.agentPlanCommands.write(
      userId,
      "plans.play",
      {
        planId,
        operationId: requestKey,
      },
    );
    if (!("runId" in result) || !result.runId)
      throw new AgentError("plan_run_unavailable");
    run = (await readPlanControlRun(service, userId, planId, result.runId)).run;
  }
  return Response.json(
    {
      ok: true,
      intent: "play-plan",
      requestKey,
      planId,
      revision: run.planRevision,
      run: displayPlanRun(run),
    },
    { headers: AGENT_NO_STORE },
  );
}

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
    const page = await openPlan(
      services.agentPlanService,
      user.id,
      {
        planId: requested ?? (workspace === null ? remembered : null),
        workspaceId: workspace === null ? null : readPlanText(workspace),
        isRestoring:
          requested === null && workspace === null && remembered !== null,
      },
      readCorrelationId(request.headers.get(CORRELATION_HEADER)) ??
        randomUUID(),
    );
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
        selectionPreference: openingPreference(
          { userId: user.id, origin: new URL(request.url).origin },
          page,
          { workspace, requested, remembered },
        ),
        audience: await readLocalStateAudience(services, user),
      },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    logCaughtError("agent_plans", error);

    throw agentFailureResponse(error);
  }
}

/** Stops, pauses or resumes a run of the person and answers with the run as it is now. */
async function runControlAction(
  userId: string,
  services: ApplicationServices,
  request: {
    readonly intent: "stop-plan" | "pause-plan" | "resume-plan";
    readonly formData: FormData;
  },
): Promise<Response> {
  const { intent, formData } = request;
  const operations = {
    "stop-plan": "plans.stop",
    "pause-plan": "plans.pause",
    "resume-plan": "plans.resume",
  } as const;
  const requestKey = readPlanText(formData.get("requestKey"));
  const result = await services.agentPlanCommands.write(
    userId,
    operations[intent],
    {
      operationId: requestKey,
      planId: readPlanText(formData.get("planId")),
      runId: readPlanText(formData.get("runId")),
    },
  );
  if (!("runId" in result) || !result.runId)
    throw new AgentError("plan_run_unavailable");
  const run = (
    await readPlanControlRun(
      services.agentPlanService,
      userId,
      result.planId,
      result.runId,
    )
  ).run;
  return Response.json(
    { ok: true, intent, requestKey, run: displayPlanRun(run) },
    { headers: AGENT_NO_STORE },
  );
}

/** A request of the plan menu that only needs the person, the services and the form. */
type ManagementAction = (
  userId: string,
  services: ApplicationServices,
  formData: FormData,
) => Promise<Response>;

/** The handler of a plan menu request, read when the request arrives. */
function managementAction(intent: string): ManagementAction | null {
  switch (intent) {
    case "create-plan":
      return createPlanAction;
    case "clone-plan":
      return clonePlanAction;
    case "keep-plan":
      return keepPlanAction;
    case "plan-access":
      return changePlanAccessAction;
    case "approve-plan-scripts":
      return approvePlanScriptsAction;
    case "plan-history":
      return planHistoryAction;
    default:
      return null;
  }
}

/** Preserves a command key only on a definitive refusal, never on an unknown server outcome. */
async function actionFailure(
  error: unknown,
  intent: string,
  requestKey?: string,
): Promise<Response> {
  if (error instanceof AgentOperationError)
    return Response.json(
      {
        ok: false,
        intent,
        requestKey,
        error:
          error.details && "reason" in error.details
            ? error.details.reason
            : "plan_run_unavailable",
      },
      { status: error.status, headers: AGENT_NO_STORE },
    );
  if (error instanceof AgentPlanRecoveryError)
    return planRecoveryFailure(error);
  const response = agentFailureResponse(
    error instanceof SyntaxError ? new AgentError("plan_invalid") : error,
    intent,
  );
  if (!requestKey || response.status >= 500) return response;
  const payload: unknown = await response.json();
  return Response.json(
    { ...readAgentObject(payload), requestKey },
    { status: response.status, headers: response.headers },
  );
}

/**
 * Save, Create, Clone, Delete, Play, Pause, Resume and Stop use the authenticated executor and live server permissions.
 *
 * @remarks
 * Play starts the current saved plan. The route still accepts
 * the save-and-play form of earlier clients; the plan page never sends it.
 */
export async function action(args: Route.ActionArgs): Promise<Response> {
  let intent = "";
  let requestKey: string | undefined;
  try {
    const { user, services, formData } = await readSettingsRequest(args);
    const submittedKey = formData.get("requestKey");
    if (typeof submittedKey === "string") requestKey = submittedKey;
    intent = String(formData.get("intent") ?? "");
    if (intent === "save-plan")
      return await savePlan(user.id, services.agentPlanService, formData);
    const management = managementAction(intent);
    if (management) return await management(user.id, services, formData);
    if (intent === "delete-plan")
      return await deletePlanAction(user.id, services, {
        request: args.request,
        formData,
      });
    if (intent === "play-plan")
      return await playPlan(user.id, services, formData);
    if (intent === "inspect-plan-start") {
      const owners = await services.agentPlanService.startOwners(
        user.id,
        readPlanText(formData.get("planId")),
      );
      return Response.json({ owners }, { headers: AGENT_NO_STORE });
    }
    if (intent === "admin-mode") {
      await services.administrationService.setMode(user.id, "admin");
      return Response.json({ ok: true, intent }, { headers: AGENT_NO_STORE });
    }
    if (
      intent === "stop-plan" ||
      intent === "pause-plan" ||
      intent === "resume-plan"
    )
      return await runControlAction(user.id, services, {
        intent,
        formData,
      });
    throw new AgentError("plan_invalid");
  } catch (error: unknown) {
    logCaughtError("agent_plans", error);

    return actionFailure(error, intent, requestKey);
  }
}
