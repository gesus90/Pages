import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  AGENT_PLAN_COMMAND_OPERATIONS,
  AGENT_PLAN_CONTRACT_VERSION,
  AGENT_PLAN_READ_OPERATIONS,
  AGENT_PLAN_RECOVERY_COMMAND_OPERATIONS,
  AGENT_PLAN_RESOURCE_READ_OPERATIONS,
  AGENT_PLAN_WRITE_OPERATIONS,
} from "@/definition/AgentPlanOperations";
import { readPlanControlEntry } from "./AgentPlanControlViews";
import { readPlanDiagnostic } from "./AgentPlanDiagnosticRead";
import { readPlanCheckpoint } from "./AgentPlanCheckpointRead";
import { readPlanSessionEvents } from "./AgentPlanSessionEventRead";
import {
  canReadPlanContinuation,
  planRecoveryEntry,
} from "./AgentPlanRecoveryViews";

import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type { AgentPlanReadResult } from "@/definition/AgentPlanOperations";
import type { AgentPlanService } from "./AgentPlanService";
import type { AgentPlanTemplateService } from "./AgentPlanTemplateService";
import type { AgentPlanRecoveryService } from "./recovery/AgentPlanRecoveryService";
import type { AgentSessionService } from "./sessions/AgentSessionService";

/** The editor services, shared by resource reads and explicit commands. */
export interface AgentPlanResourceServices {
  readonly plans: AgentPlanService;
  readonly templates: AgentPlanTemplateService;
  readonly sessions?: Pick<AgentSessionService, "history">;
  readonly recovery?: Pick<
    AgentPlanRecoveryService,
    "view" | "control" | "checkpoint"
  >;
}

async function readRunEvidence(
  services: AgentPlanResourceServices,
  userId: string,
  operation: string,
  input: unknown,
): Promise<AgentPlanReadResult | null> {
  if (operation === "plans.run.session.events.read") {
    if (!services.sessions)
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "plan_run_unavailable",
      });
    return readPlanSessionEvents(services.sessions, userId, input);
  }
  if (operation === "plans.run.diagnostics.read")
    return readPlanDiagnostic(services.plans, userId, input);
  if (operation !== "plans.run.checkpoint.read") return null;
  if (!services.recovery)
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "plan_run_unavailable",
    });
  return readPlanCheckpoint(services.plans, services.recovery, userId, input);
}

/** Reads existing templates and public action availability without exposing private run contents. */
export async function readPlanResources(
  services: AgentPlanResourceServices,
  userId: string,
  operation: string,
  input: unknown,
): Promise<AgentPlanReadResult | null> {
  const evidence = await readRunEvidence(services, userId, operation, input);
  if (evidence) return evidence;
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
    const canReadContinuation = await canReadPlanContinuation(
      services.plans,
      userId,
      recovery,
    );
    return { recovery: planRecoveryEntry(recovery, canReadContinuation) };
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
          ...AGENT_PLAN_RECOVERY_COMMAND_OPERATIONS,
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
  if (operation === "plans.control.read")
    return readControl(services.plans, userId, parameters);
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

async function readControl(
  plans: AgentPlanService,
  userId: string,
  parameters: Record<string, unknown>,
): Promise<AgentPlanReadResult> {
  const { planId, before } = readPlanControlHistoryRequest(parameters);
  const control = await readPlanControlEntry(plans, userId, planId);
  return {
    control:
      parameters.includeStartRejections === true
        ? {
            ...control,
            startRejectionHistory: await plans.startRejections(
              userId,
              planId,
              before,
            ),
          }
        : control,
  };
}

/** Keeps ordinary controls compatible and accepts history only on explicit request. */
export function readPlanControlHistoryRequest(
  parameters: Record<string, unknown>,
): {
  readonly planId: string;
  readonly before: string | null;
} {
  requireParameterKeys(
    parameters,
    ["planId"],
    ["includeStartRejections", "beforeRejectionId"],
  );
  const planId = readIdentifier(parameters.planId);
  if (
    parameters.includeStartRejections !== undefined &&
    parameters.includeStartRejections !== true
  )
    throw new AgentOperationError("INVALID_REQUEST");
  if (
    parameters.beforeRejectionId !== undefined &&
    parameters.includeStartRejections !== true
  )
    throw new AgentOperationError("INVALID_REQUEST");
  const before =
    parameters.beforeRejectionId === undefined
      ? null
      : readIdentifier(parameters.beforeRejectionId);
  return { planId, before };
}
