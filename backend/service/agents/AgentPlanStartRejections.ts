import { randomUUID } from "node:crypto";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { AgentPlanWorkspaceConflictError } from "@/backend/error/AgentPlanWorkspaceConflictError";
import { AgentPlanWorkspaceReservationError } from "@/backend/error/AgentPlanWorkspaceReservationError";
import { logCaughtError } from "@/backend/logging/Logger";

import { reservedWorkspaceConflict } from "./AgentPlanWorkspaceConflict";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanStartRejection } from "@/definition/AgentPlanStartRejection";
import type { AgentPlanWorkspaceConflict } from "@/definition/AgentPlanWorkspaceConflict";
import type { AgentPlanStartRejectionRepository } from "@/backend/database/repositories/agent/AgentPlanStartRejectionRepository";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";
import type { AgentPlanRunJournal } from "./AgentPlanJournal";

interface StartIdentity {
  readonly userId: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly action: AgentPlanStartRejection["action"];
  readonly journal?: AgentPlanRunJournal["recordStartRejection"];
}

interface StartAuditDependencies {
  readonly startRejections?: Pick<AgentPlanStartRejectionRepository, "append">;
}

interface RejectionContext {
  readonly snapshot: AgentPlanSnapshot | undefined;
  readonly error: unknown;
  readonly duringPreparation: boolean;
}

function targetResolution(
  conflict: AgentPlanWorkspaceConflict | null,
): AgentPlanStartRejection["targetResolution"] {
  const local = conflict?.targets.some((target) => target.kind === "local");
  const remote = conflict?.targets.some((target) => target.kind === "remote");
  if (local && remote) return "mixed";
  if (local) return "local_resolved";
  if (remote) return "remote_registered";
  return "unknown";
}

function refusalConflict(
  error: AgentError,
  snapshot: AgentPlanSnapshot | undefined,
): AgentPlanWorkspaceConflict | null {
  if (error instanceof AgentPlanWorkspaceConflictError) return error.conflict;
  if (error instanceof AgentPlanWorkspaceReservationError && snapshot)
    return reservedWorkspaceConflict(snapshot, error.workspaceId);
  return null;
}

async function recordRejection(
  dependencies: StartAuditDependencies,
  identity: StartIdentity,
  context: RejectionContext,
): Promise<void> {
  const { snapshot, error, duringPreparation } = context;
  if (
    !dependencies.startRejections ||
    !(error instanceof AgentError) ||
    (!duringPreparation && error.code !== "plan_workspace_conflict")
  )
    return;
  const conflict = refusalConflict(error, snapshot);
  let reservation: AgentPlanStartRejection["reservation"] = duringPreparation
    ? "not_requested"
    : "unknown";
  if (conflict?.kind === "parallel_writers") reservation = "not_requested";
  if (error instanceof AgentPlanWorkspaceReservationError) reservation = "held";
  await dependencies.startRejections.append(
    identity.userId,
    identity.planId,
    {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      action: identity.action,
      planRevision: identity.planRevision,
      isSavedRevision: identity.action === "play",
      error: error.code,
      ...(error instanceof AgentPlanValidationError
        ? {
            issues: error.issues.slice(0, 50).map((issue) => ({
              nodeId: issue.nodeId,
              port: issue.port,
              problem: issue.reason,
            })),
            issueDetailsFiltered:
              error.issues.length > 50 ||
              error.issues.some((issue) => issue.asset !== undefined),
          }
        : {}),
      conflict,
      reservation,
      targetResolution: targetResolution(conflict),
    },
    identity.journal,
  );
}

async function recordAndRethrow(
  dependencies: StartAuditDependencies,
  identity: StartIdentity,
  context: RejectionContext,
): Promise<never> {
  try {
    await recordRejection(dependencies, identity, context);
  } catch (recordError: unknown) {
    logCaughtError("AgentPlanStartRejections", recordError);
    throw new AgentError("plan_start_rejection_record_failed");
  }
  throw context.error;
}

/** Journals safe preparation and workspace refusals; a failed journal is reported explicitly. */
export async function executePlanStart(
  dependencies: StartAuditDependencies,
  identity: StartIdentity,
  prepare: () => Promise<AgentPlanSnapshot>,
  start: (snapshot: AgentPlanSnapshot) => Promise<AgentPlanRun>,
): Promise<AgentPlanRun> {
  let snapshot: AgentPlanSnapshot;
  try {
    snapshot = await prepare();
  } catch (error: unknown) {
    return recordAndRethrow(dependencies, identity, {
      snapshot: undefined,
      error,
      duringPreparation: true,
    });
  }
  try {
    return await start(snapshot);
  } catch (error: unknown) {
    return recordAndRethrow(dependencies, identity, {
      snapshot,
      error,
      duringPreparation: false,
    });
  }
}
