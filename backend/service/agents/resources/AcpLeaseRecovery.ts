import { settleManagedLocalOwner } from "@/backend/agents/local/LocalOwnerControl";
import { closeLease } from "./AcpLeaseProcesses";
import type { SchedulerDependencies } from "./AcpSchedulerDependencies";
import { logCaughtError } from "@/backend/logging/Logger";

import type {
  AcpResourceRecord,
  AcpResourceState,
} from "@/definition/AcpResource";

/** Restores a lease or reconciles its prior process before admitting new work. */
export async function recoverAcpLease(
  record: AcpResourceRecord,
  context: {
    readonly preserved: ReadonlySet<string>;
    readonly retained: ReadonlySet<string>;
    readonly adopted: ReadonlySet<string>;
  },
  actions: {
    transition: (id: string, state: AcpResourceState) => Promise<void>;
    cleanup: (
      record: AcpResourceRecord,
      since: string | null,
    ) => Promise<{ readonly remaining: number }>;
    finish: (id: string, confirmed: boolean) => Promise<boolean>;
  },
): Promise<void> {
  if (context.preserved.has(record.instanceId)) {
    if (record.state === "closing" || record.state === "cleanup_failed")
      await actions.transition(record.instanceId, "running");
    return;
  }
  if (context.retained.has(record.instanceId)) {
    await actions.transition(record.instanceId, "cleanup_failed");
    return;
  }
  try {
    const cleanup = await actions.cleanup(
      record,
      context.adopted.has(record.instanceId) ? null : record.since,
    );
    await actions.finish(record.instanceId, cleanup.remaining === 0);
  } catch (caughtError: unknown) {
    logCaughtError("AcpResourceScheduler", caughtError);

    await actions.transition(record.instanceId, "cleanup_failed");
  }
}

/** Confirms an unverified owner before attempting lease cleanup. */
export async function cleanupAcpLease(
  record: AcpResourceRecord,
  since: string | null,
  options: {
    unverified: Set<string>;
    cleanup: NonNullable<SchedulerDependencies["cleanup"]>;
    settleUnits: SchedulerDependencies["settleUnits"];
  },
): Promise<{ readonly remaining: number }> {
  if (options.unverified.has(record.instanceId)) {
    if ((await settleManagedLocalOwner(record.instanceId)) !== true)
      throw new Error(
        "Local native owner is unverified; no cleanup is authorized",
      );
    options.unverified.delete(record.instanceId);
  }
  return closeLease(record, since, options.cleanup, options.settleUnits);
}

/** Rechecks uncertain leases and counts those still held. */
export async function reconcileAcpLeases(
  records: readonly AcpResourceRecord[],
  actions: {
    cleanup: (
      record: AcpResourceRecord,
    ) => Promise<{ readonly remaining: number }>;
    finish: (id: string, confirmed: boolean) => Promise<boolean>;
  },
): Promise<number> {
  let remaining = 0;
  for (const record of records) {
    let confirmed = false;
    try {
      confirmed = (await actions.cleanup(record)).remaining === 0;
    } catch (error: unknown) {
      logCaughtError("AcpResourceScheduler", error);
    }
    if (!(await actions.finish(record.instanceId, confirmed))) remaining += 1;
  }
  return remaining;
}
