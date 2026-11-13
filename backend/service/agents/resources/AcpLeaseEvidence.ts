import { hasEndedOwnedNamespace } from "@/backend/agents/cli/CliOwnedNamespace";
import { readScopeSince } from "@/backend/agents/cli/CliProcessScan";
import { inspectManagedLocalOwner } from "@/backend/agents/local/LocalOwnerControl";
import { ACP_RELEASE_REASONS } from "@/definition/AcpResource";

import type {
  AcpLeaseCheckReason,
  AcpResourceRecord,
} from "@/definition/AcpResource";

const WORKER_UNIT_PREFIX = "pages-acp-";

/** What one check cycle knows about the host, read once for all leases. */
export interface AcpLeaseEvidenceContext {
  /** Whether startup could not prove the managed local owner of the lease. */
  readonly isUnverifiedLocal: boolean;
  /** Running ACP worker units, or `null` when the service manager could not be read. */
  readonly units: ReadonlySet<string> | null;
  /**
   * Reads whether the journal proves that the only worker unit of a lease
   * started and ended; absent where a check does not consult the journal.
   */
  readonly journal?: (instanceId: string) => Promise<boolean>;
}

/** Whether a check reason proves that no process of the lease can remain. */
export function isReleaseReason(reason: AcpLeaseCheckReason): boolean {
  return ACP_RELEASE_REASONS.some((entry) => entry === reason);
}

/**
 * Whether a lease began before the current boot, so every process it had ended with that boot.
 *
 * @param since - The recorded start of the lease, taken before any process creation.
 */
export async function startedBeforeBoot(since: string): Promise<boolean> {
  return (
    (await readScopeSince(since)).earliestStart === Number.POSITIVE_INFINITY
  );
}

function hasRunningUnit(
  record: AcpResourceRecord,
  units: ReadonlySet<string> | null,
): boolean {
  const prefix = `${WORKER_UNIT_PREFIX}${record.instanceId}-`;
  return units !== null && [...units].some((name) => name.startsWith(prefix));
}

async function classifyNamespace(
  record: AcpResourceRecord,
  context: AcpLeaseEvidenceContext,
): Promise<AcpLeaseCheckReason | null> {
  if (!record.namespace) return null;
  if (!(await hasEndedOwnedNamespace(record.namespace))) return "process_alive";
  // The supervisor ended; helpers of a recorded unit may outlive it until the unit stops.
  if (hasRunningUnit(record, context.units)) return "unit_active";
  if (record.namespace.unit && context.units === null)
    throw new Error("Worker units are unreadable");
  return "namespace_ended";
}

/**
 * Whether the process of a lease was started in a recorded worker unit.
 *
 * @remarks
 * The unit holds every process of the worker in its cgroup (PAGE-335), so
 * its units prove whether a process of the lease can remain, also when it
 * ended before its identity was recorded.
 */
export function isUnitBound(record: AcpResourceRecord): boolean {
  return (
    typeof record.workerUnit === "string" &&
    (record.lifecycle === "spawning" || record.lifecycle === "process")
  );
}

function classifyWorkerUnit(
  record: AcpResourceRecord,
  units: ReadonlySet<string> | null,
): AcpLeaseCheckReason | null {
  if (!isUnitBound(record)) return null;
  if (units === null) throw new Error("Worker units are unreadable");
  return "unit_inactive";
}

function classifyWithoutIdentity(
  record: AcpResourceRecord,
  isPreviousBoot: boolean,
): AcpLeaseCheckReason {
  if (record.lifecycle === "not_spawned") return "not_spawned";
  if (isPreviousBoot) return "previous_boot";
  if (record.lifecycle === "reserved") return "start_interrupted";
  if (record.lifecycle === "spawning" || record.lifecycle === "process")
    return "start_unconfirmed";
  return "legacy_unproven";
}

/**
 * Proves the end of a spawned lease without identity through its unit history.
 *
 * @remarks
 * Only with a readable service manager that lists no running unit of the
 * lease, and only when the journal shows its one unit started and ended.
 */
async function classifyByUnitHistory(
  record: AcpResourceRecord,
  context: AcpLeaseEvidenceContext,
  reason: AcpLeaseCheckReason,
): Promise<AcpLeaseCheckReason> {
  if (
    (reason !== "start_unconfirmed" && reason !== "legacy_unproven") ||
    context.units === null ||
    !context.journal
  )
    return reason;
  return (await context.journal(record.instanceId)) ? "unit_ended" : reason;
}

/**
 * Classifies an unconfirmed lease from durable evidence, without ending,
 * signalling or commanding any process.
 *
 * @param record - A lease this process role owns and no live session holds.
 * @param context - Host facts of the current check cycle.
 * @returns A release reason only when the evidence proves that no process remains.
 * @throws When evidence that is needed cannot be read; the lease stays then.
 *
 * @remarks
 * Age, a missing environment marker, a missing PID or a restart of Pages
 * prove nothing. A change of boot does: no process outlives it. So does the
 * journaled end of the one worker unit of a lease while no unit of it runs. A managed
 * owner that has not released the lease keeps it, since only its own
 * authorized closeout may end the session. A lease without identity that
 * recorded its worker unit is released once its units are proven inactive;
 * unreadable units keep it.
 */
export async function classifyLease(
  record: AcpResourceRecord,
  context: AcpLeaseEvidenceContext,
): Promise<AcpLeaseCheckReason> {
  if (context.isUnverifiedLocal) return "owner_unverified";
  const managed = inspectManagedLocalOwner(record.instanceId);
  if (managed === "owned") return "owner_managed";
  const namespace = await classifyNamespace(record, context);
  if (namespace !== null) return namespace;
  if (managed === "released") return "owner_released";
  if (hasRunningUnit(record, context.units)) return "unit_active";
  const unit = classifyWorkerUnit(record, context.units);
  if (unit !== null) return unit;
  const reason = classifyWithoutIdentity(
    record,
    await startedBeforeBoot(record.since),
  );
  return classifyByUnitHistory(record, context, reason);
}
