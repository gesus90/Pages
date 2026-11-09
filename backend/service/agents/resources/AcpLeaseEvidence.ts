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
 * prove nothing. A change of boot does: no process outlives it. A managed
 * owner that has not released the lease keeps it, since only its own
 * authorized closeout may end the session.
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
  return classifyWithoutIdentity(record, await startedBeforeBoot(record.since));
}
