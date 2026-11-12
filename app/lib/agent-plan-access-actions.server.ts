import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  AGENT_PLAN_TEAM_LIMIT,
  isAgentPlanTeamKind,
} from "@/definition/AgentPlanTeam";

import { AGENT_NO_STORE } from "./settings-actions/settings-agents-response.server";

import type { AgentPlanTeam } from "@/definition/AgentPlanTeam";
import type { ApplicationServices } from "./services.server";

type PlanServices = Pick<ApplicationServices, "agentPlanService">;

function readRevision(formData: FormData): number {
  const revision = Number(formData.get("revision"));
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new AgentError("plan_invalid");
  return revision;
}

function readTeam(input: unknown): AgentPlanTeam {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentError("plan_invalid");
  const entry = new Map<string, unknown>(Object.entries(input));
  const kind = entry.get("kind");
  const rights = ["canRead", "canEdit", "canRun"].map((key) => entry.get(key));
  if (
    !isAgentPlanTeamKind(kind) ||
    rights.some((right) => typeof right !== "boolean")
  )
    throw new AgentError("plan_invalid");
  return {
    kind,
    targetId: readPlanText(entry.get("targetId")),
    canRead: rights[0] === true,
    canEdit: rights[1] === true,
    canRun: rights[2] === true,
  };
}

/** The teams the dialog sends as JSON; absent keeps the teams. */
function readTeams(formData: FormData): readonly AgentPlanTeam[] | undefined {
  const text = formData.get("teams");
  if (text === null) return undefined;
  let input: unknown;
  try {
    input = JSON.parse(String(text));
  } catch {
    // Parsing a string can only fail with a syntax error.
    throw new AgentError("plan_invalid");
  }
  if (!Array.isArray(input) || input.length > AGENT_PLAN_TEAM_LIMIT)
    throw new AgentError("plan_invalid");
  return input.map(readTeam);
}

/**
 * Changes the teams and/or the owner of a plan from the Teams dialog (PAGE-329).
 *
 * @param userId - The owner, an administrator or a project manager.
 * @param services - The plan services.
 * @param formData - Plan, revision, the teams as JSON and an optional new owner.
 */
export async function changePlanAccessAction(
  userId: string,
  services: PlanServices,
  formData: FormData,
): Promise<Response> {
  const owner = formData.get("ownerId");
  const teams = readTeams(formData);
  const revision = await services.agentPlanService.changeAccess(
    userId,
    readPlanText(formData.get("planId")),
    {
      revision: readRevision(formData),
      ...(teams === undefined ? {} : { teams }),
      ...(owner === null || owner === ""
        ? {}
        : { ownerId: readPlanText(owner) }),
    },
  );
  return Response.json(
    { ok: true, intent: "plan-access", revision },
    { headers: AGENT_NO_STORE },
  );
}

/**
 * Approves the current content of the script steps of a plan; administrators only (PAGE-329).
 *
 * @param userId - The administrator.
 * @param services - The plan services.
 * @param formData - Plan and revision the administrator saw.
 */
export async function approvePlanScriptsAction(
  userId: string,
  services: PlanServices,
  formData: FormData,
): Promise<Response> {
  const approved = await services.agentPlanService.approveScripts(
    userId,
    readPlanText(formData.get("planId")),
    readRevision(formData),
  );
  return Response.json(
    { ok: true, intent: "approve-plan-scripts", approved },
    { headers: AGENT_NO_STORE },
  );
}

/**
 * Reads the history of a readable plan, newest first (PAGE-329).
 *
 * @param userId - The person who reads the plan.
 * @param services - The plan services.
 * @param formData - The plan.
 */
export async function planHistoryAction(
  userId: string,
  services: PlanServices,
  formData: FormData,
): Promise<Response> {
  const planId = readPlanText(formData.get("planId"));
  const entries = await services.agentPlanService.history(userId, planId);
  return Response.json(
    { ok: true, intent: "plan-history", planId, entries },
    { headers: AGENT_NO_STORE },
  );
}
