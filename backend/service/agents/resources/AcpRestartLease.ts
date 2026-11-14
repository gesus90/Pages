import { settleRecordedWorkerUnit } from "@/backend/agents/cli/CliWorkerUnit";
import { forceOwnedNamespace } from "@/backend/agents/cli/CliOwnedNamespace";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

import type { AcpResourceRecord } from "@/definition/AcpResource";

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
