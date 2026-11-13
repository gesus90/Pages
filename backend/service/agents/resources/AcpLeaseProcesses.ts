import {
  hasEndedOwnedNamespace,
  settleOwnedNamespace,
} from "@/backend/agents/cli/CliOwnedNamespace";
import {
  endTaggedProcesses,
  readScopeSince,
} from "@/backend/agents/cli/CliProcessScan";
import { settleManagedLocalOwner } from "@/backend/agents/local/LocalOwnerControl";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  hasRunningWorkerUnit,
  settleWorkerUnits,
} from "@/backend/agents/cli/CliWorkerUnit";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { logCaughtError } from "@/backend/logging/Logger";

import { AgentToolPreflightError } from "../tools/AgentToolReadinessError";
import { isUnitBound } from "./AcpLeaseEvidence";

import type { PlanSession } from "@/backend/agents/AgentPlanExecution";
import type { AcpNamespaceOwner, AcpResourceRecord } from "@/definition/AcpResource";

type LeaseCleanup = (
  instanceId: string,
  startedAt: string | null,
) => Promise<{ readonly remaining: number }>;

/** Ends only processes matching the lease identity and its recorded start boundary. */
export async function endLeaseProcesses(
  instanceId: string,
  startedAt: string | null,
): Promise<{ readonly remaining: number }> {
  const scope = startedAt === null ? null : await readScopeSince(startedAt);
  return endTaggedProcesses(instanceId, scope);
}

/**
 * Closes out an owned lease through its strongest ownership evidence.
 *
 * @param record - A lease of this process role.
 * @param startedAt - Its recorded start, or `null` when the start is unknown.
 * @param cleanup - The legacy closeout, which refuses without ownership proof.
 * @param settleUnits - Stops the worker units of a lease and counts those still running.
 *
 * @remarks
 * A managed owner or a recorded namespace decides first. Without process
 * identity a tracked start that spawned nothing counts, and a start in a
 * recorded worker unit counts once its units are stopped and none of them
 * runs (PAGE-335); a start
 * before the current boot is left to the periodic check, which reads the
 * boot itself.
 */
export async function closeLease(
  record: AcpResourceRecord,
  startedAt: string | null,
  cleanup: LeaseCleanup,
  settleUnits: (instanceId: string) => Promise<number> = settleWorkerUnits,
): Promise<{ readonly remaining: number }> {
  try {
    const managed = await settleManagedLocalOwner(record.instanceId);
    if (managed !== null) return { remaining: managed ? 0 : 1 };
  } catch (error: unknown) {
    if (
      !(error instanceof AgentError) ||
      (error.code !== "plan_local_control_failed" &&
        error.code !== "plan_local_owner_unverified")
    )
      throw error;
    return {
      remaining: (await hasEndedLeaseProcesses(
        record.instanceId,
        record.namespace,
      ))
        ? 0
        : 1,
    };
  }
  if (record.namespace)
    return {
      remaining: (await settleOwnedNamespace(
        record.namespace,
        record.instanceId,
      ))
        ? 0
        : 1,
    };
  if (record.lifecycle === "not_spawned") return { remaining: 0 };
  if (isUnitBound(record))
    return { remaining: await settleUnits(record.instanceId) };
  return cleanup(record.instanceId, startedAt);
}

/** Independently confirms both the session supervisor and every worker unit have ended. */
export async function hasEndedLeaseProcesses(
  instanceId: string,
  namespace: AcpNamespaceOwner | undefined,
): Promise<boolean> {
  if (!namespace || !(await hasEndedOwnedNamespace(namespace))) return false;
  return !(await hasRunningWorkerUnit(instanceId));
}

/**
 * Decides whether a failed start may release its lease.
 *
 * @returns `true` only for a start that provably spawned nothing or whose
 * processes were confirmed ended; any unknown closeout keeps the reservation.
 */
export async function confirmFailedStart(input: {
  readonly error: unknown;
  readonly native: PlanSession | null;
  /** The start never ran, or a tracked start failed before process creation. */
  readonly isProven: boolean;
  readonly close: () => Promise<{ readonly remaining: number }>;
}): Promise<boolean> {
  const { error, native } = input;
  if (
    native === null &&
    (input.isProven || error instanceof AgentToolPreflightError)
  )
    return true;
  try {
    if (native) return (await native.close()).isConfirmed;
    if (error instanceof AcpCleanupUnconfirmedError) return false;
    return (await input.close()).remaining === 0;
  } catch (caughtError: unknown) {
    logCaughtError("AcpResourceScheduler", caughtError);
    return false;
  }
}
