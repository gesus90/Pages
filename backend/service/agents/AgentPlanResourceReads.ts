import { AgentOperationError } from "@/backend/error/AgentOperationError";

import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type { AgentPlanReadResult } from "@/definition/AgentPlanOperations";
import type { AgentPlanService } from "./AgentPlanService";
import type { AgentPlanTemplateService } from "./AgentPlanTemplateService";

/** The editor services, shared by resource reads and explicit commands. */
export interface AgentPlanResourceServices {
  readonly plans: AgentPlanService;
  readonly templates: AgentPlanTemplateService;
}

/** Reads existing templates and public action availability without exposing private run contents. */
export async function readPlanResources(
  services: AgentPlanResourceServices,
  userId: string,
  operation: string,
  input: unknown,
): Promise<AgentPlanReadResult | null> {
  if (
    operation !== "plans.templates.list" &&
    operation !== "plans.templates.read" &&
    operation !== "plans.control.read"
  )
    return null;
  const parameters = readParameterRecord(input);
  if (operation === "plans.control.read") {
    requireParameterKeys(parameters, ["planId"]);
    const control = await services.plans.control(
      userId,
      readIdentifier(parameters.planId),
    );
    return {
      control: {
        canPlay: control.canPlay,
        canPause: control.canPause,
        canResume: control.canResume,
        canStop: control.canStop,
        issue: control.issue === null ? null : "plan_run_unavailable",
      },
    };
  }
  requireParameterKeys(
    parameters,
    operation === "plans.templates.read"
      ? ["workspaceId", "templateId"]
      : ["workspaceId"],
  );
  const workspaceId = readIdentifier(parameters.workspaceId);
  const templates = await services.templates.list(userId, workspaceId);
  if (operation === "plans.templates.list") return { templates };
  const templateId = readIdentifier(parameters.templateId);
  const template = templates.find((entry) => entry.id === templateId);
  if (!template) throw new AgentOperationError("NOT_FOUND");
  return { template };
}
