import { redirect } from "react-router";

import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { planExecutionTargetSchema } from "@/definition/AgentPlanExecution";

import {
  forgetSelectedPlan,
  rememberSelectedPlan,
} from "./agent-plan-selection.server";
import { AGENT_NO_STORE } from "./settings-actions/settings-agents-response.server";

import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type { ApplicationServices } from "./services.server";

type PlanServices = Pick<
  ApplicationServices,
  "agentPlanService" | "agentPlanManagement"
>;

/** The request key of a dialog: one per opened dialog and request content. */
function readRequestKey(formData: FormData): string {
  return `page-${readPlanText(formData.get("requestKey"), 100)}`;
}

function readRevision(formData: FormData): number {
  const revision = Number(formData.get("revision"));
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new AgentError("plan_invalid");
  return revision;
}

/** An empty target field means the Pages host; anything else must be a valid target. */
function readTarget(formData: FormData): AgentPlanExecutionTarget | undefined {
  const text = String(formData.get("target") ?? "");
  if (!text) return undefined;
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) throw new AgentError("plan_invalid");
    throw error;
  }
  const parsed = planExecutionTargetSchema.safeParse(input);
  if (!parsed.success) throw new AgentError("plan_invalid");
  return parsed.data;
}

function planCreated(intent: string, planId: string): Response {
  return Response.json(
    { ok: true, intent, planId, revision: 1 },
    { headers: AGENT_NO_STORE },
  );
}

/**
 * Creates an empty plan from the New dialog; it starts no run.
 *
 * @param userId - The creator, who becomes the owner.
 * @param services - The plan services.
 * @param formData - Name, workspace, optional plan target and request key.
 */
export async function createPlanAction(
  userId: string,
  services: PlanServices,
  formData: FormData,
): Promise<Response> {
  const planId = await services.agentPlanManagement.create(
    userId,
    {
      name: readPlanText(formData.get("name"), 120),
      workspaceId: readPlanText(formData.get("workspaceId")),
      executionTarget: readTarget(formData),
    },
    readRequestKey(formData),
  );
  return planCreated("create-plan", planId);
}

/**
 * Copies the saved revision the Clone dialog named into a new plan; it starts no run.
 *
 * @param userId - The person copying, who owns the copy.
 * @param services - The plan services.
 * @param formData - Source plan and revision, name, target context and request key.
 */
export async function clonePlanAction(
  userId: string,
  services: PlanServices,
  formData: FormData,
): Promise<Response> {
  const target = readTarget(formData);
  const planId = await services.agentPlanManagement.clone(
    userId,
    readPlanText(formData.get("planId")),
    {
      expectedRevision: readRevision(formData),
      name: readPlanText(formData.get("name"), 120),
      workspaceId: readPlanText(formData.get("workspaceId")),
      executionTarget: target ?? { kind: "local" },
    },
    readRequestKey(formData),
  );
  return planCreated("clone-plan", planId);
}

/**
 * Deletes the plan and opens another one the person may read.
 *
 * @remarks
 * A plan of the same project comes first; without any readable plan the
 * remembered selection is cleared, so a reload never shows the deleted plan.
 *
 * @param userId - The owner.
 * @param services - The plan services.
 * @param request - The request, whose cookies keep the selection.
 */
export async function deletePlanAction(
  userId: string,
  services: PlanServices,
  request: { readonly request: Request; readonly formData: FormData },
): Promise<Response> {
  const { formData } = request;
  const planId = readPlanText(formData.get("planId"));
  // Read before the removal; a repeated request finds the plan gone already.
  const deleted = (await services.agentPlanService.visible(userId)).find(
    (plan) => plan.id === planId,
  );
  await services.agentPlanManagement.remove(userId, planId, {
    revision: readRevision(formData),
    requestKey: readRequestKey(formData),
  });
  const remaining = await services.agentPlanService.visible(userId);
  const next =
    remaining.find((plan) => plan.projectId === deleted?.projectId) ??
    remaining[0];
  const headers = new Headers(AGENT_NO_STORE);
  headers.append(
    "Set-Cookie",
    next
      ? await rememberSelectedPlan(request.request, userId, next.id)
      : await forgetSelectedPlan(request.request),
  );
  return redirect(
    next
      ? `/agents/plans?planId=${encodeURIComponent(next.id)}`
      : "/agents/plans",
    { headers },
  );
}
