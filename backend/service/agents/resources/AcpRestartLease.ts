import { settleRecordedWorkerUnit } from "@/backend/agents/cli/CliWorkerUnit";
import { forceOwnedNamespace } from "@/backend/agents/cli/CliOwnedNamespace";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

import type { PlanSession } from "@/backend/agents/AgentPlanExecution";
import type { AcpResourceRecord } from "@/definition/AcpResource";
import type { WaitingRequest } from "./AcpAdmissionRequest";
import type { AcpResourceStore } from "./AcpResourceStore";

interface RestartLeasePreparationContext {
  readonly store: AcpResourceStore;
  readonly sessions: ReadonlyMap<string, PlanSession>;
  readonly waiting: readonly WaitingRequest[];
  readonly pausedRuns: Set<string>;
}

interface RestartLeaseReleaseContext {
  readonly store: AcpResourceStore;
  readonly active: Map<string, AcpResourceRecord>;
  readonly sessions: Map<string, PlanSession>;
}

/** Ends the strongest recorded process boundary before an explicit restart releases a lease. */
export async function endRestartLease(
  record: AcpResourceRecord,
): Promise<void> {
  const failure = (
    reason: "worker_unit_active" | "lease_too_recent" | "processes_remaining",
  ): AgentPlanRecoveryError =>
    new AgentPlanRecoveryError("cleanup_unconfirmed", {
      stepId: record.stepId ?? "leases",
      kind: "local_session",
      reason,
    });
  // A namespace's end alone does not account for helpers in its worker unit.
  if (
    record.workerUnit &&
    (await settleRecordedWorkerUnit(record.instanceId, record.workerUnit)) !== 0
  )
    throw failure("worker_unit_active");
  if (record.namespace) {
    if (!(await forceOwnedNamespace(record.namespace, record.instanceId)))
      throw failure("processes_remaining");
    return;
  }
  if (record.workerUnit || record.lifecycle === "not_spawned") return;
  const age = Date.now() - Date.parse(record.since);
  // The explicit restart policy permits old legacy leases only after this quarantine.
  if (!Number.isFinite(age) || age <= 15 * 60_000)
    throw failure("lease_too_recent");
}

/** Stops all durable leases of an explicitly restarting run before releasing any capacity. */
export async function prepareRestartLeases(
  runId: string,
  context: RestartLeasePreparationContext,
): Promise<ReadonlySet<string>> {
  context.pausedRuns.delete(runId);
  for (const request of [...context.waiting])
    if (request.owner.runId === runId) request.abort();
  const records = (await context.store.list()).filter(
    (record) => record.runId === runId,
  );
  for (const record of records) {
    await endRestartLease(record);
    const session = context.sessions.get(record.instanceId);
    if (
      session &&
      !(await session.close()).isConfirmed &&
      !record.workerUnit &&
      !record.namespace
    )
      throw new Error("Session closeout unconfirmed");
  }
  return new Set(records.map((record) => record.instanceId));
}

/** Frees a previously checked restart's durable leases after rechecking their identity. */
export async function releaseRestartLeases(
  runId: string,
  proven: ReadonlySet<string>,
  retire: () => Promise<void>,
  context: RestartLeaseReleaseContext,
): Promise<void> {
  const records = (await context.store.list()).filter(
    (record) => record.runId === runId,
  );
  for (const record of records) {
    if (!proven.has(record.instanceId))
      throw new Error("Restart lease changed");
    await endRestartLease(record);
  }
  // The run repository releases leases, bindings and locks and ends the run atomically.
  await retire();
  for (const record of records) {
    context.sessions.delete(record.instanceId);
    context.active.delete(record.instanceId);
  }
}
