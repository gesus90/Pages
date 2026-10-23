import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  AGENT_PLAN_COMMAND_OPERATIONS,
  AGENT_PLAN_CONTRACT_VERSION,
  AGENT_PLAN_READ_OPERATIONS,
  AGENT_PLAN_RESOURCE_READ_OPERATIONS,
  AGENT_PLAN_WRITE_OPERATIONS,
} from "@/definition/AgentPlanOperations";
import { readPlanControlEntry } from "./AgentPlanControlViews";

import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type { AgentPlanReadResult } from "@/definition/AgentPlanOperations";
import type { AgentPlanService } from "./AgentPlanService";
import type { AgentPlanTemplateService } from "./AgentPlanTemplateService";
import type { AgentPlanRecoveryService } from "./recovery/AgentPlanRecoveryService";

/** The editor services, shared by resource reads and explicit commands. */
export interface AgentPlanResourceServices {
  readonly plans: AgentPlanService;
  readonly templates: AgentPlanTemplateService;
  readonly recovery?: Pick<AgentPlanRecoveryService, "view">;
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
    operation !== "plans.capabilities.read" &&
    operation !== "plans.run.recovery.read" &&
    operation !== "plans.control.read"
  )
    return null;
  const parameters = readParameterRecord(input);
  if (operation === "plans.run.recovery.read") {
    requireParameterKeys(parameters, ["planId", "runId"]);
    const planId = readIdentifier(parameters.planId);
    const runId = readIdentifier(parameters.runId);
    const run = await services.plans.run(userId, runId);
    if (run.planId !== planId) throw new AgentOperationError("NOT_FOUND");
    if (!services.recovery)
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "plan_run_unavailable",
      });
    const recovery = await services.recovery.view(userId, runId);
    return {
      recovery: {
        planId,
        runId,
        revision: recovery.revision,
        planRevision: recovery.planRevision,
        currentPlanRevision: recovery.currentPlanRevision,
        state: recovery.state,
        restart: recovery.restart,
        resume: {
          available: recovery.resume.available,
          reason: recovery.resume.reason,
          modes: recovery.resume.modes,
        },
        blockers: recovery.blockers,
        commandSurface: "editor",
      },
    };
  }
  if (operation === "plans.capabilities.read") {
    requireParameterKeys(parameters, []);
    return {
      capabilities: {
        contractVersion: AGENT_PLAN_CONTRACT_VERSION,
        operations: [
          ...AGENT_PLAN_READ_OPERATIONS,
          ...AGENT_PLAN_RESOURCE_READ_OPERATIONS,
          ...AGENT_PLAN_WRITE_OPERATIONS,
          ...AGENT_PLAN_COMMAND_OPERATIONS,
        ],
        cloneSharing: "create_default",
        resume: "durable_pause_boundary",
        deletionConfirmation: {
          stdio: "client_form",
          http: "unavailable",
          pica: "target_bound_message",
        },
      },
    };
  }
  if (operation === "plans.control.read") {
    requireParameterKeys(parameters, ["planId"]);
    return {
      control: await readPlanControlEntry(
        services.plans,
        userId,
        readIdentifier(parameters.planId),
      ),
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
